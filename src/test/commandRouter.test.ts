/** Tests command handlers and auto-delete interactions. */

import * as assert from 'assert';
import { afterEach } from 'mocha';
import * as vscode from 'vscode';

import { HandlerContext } from '../types/handlerContext';
import { addTodo, editTodo } from '../adapters/commandRouter';
import { TodoWebviewHost } from '../todoWebviewHost';
import { TodoRepository } from '../todoRepository';
import { AutoDeleteCoordinator } from '../services/autoDeleteService';
import { ScopeTarget } from '../types/scope';
import { handleWebviewMessage } from '../adapters/webviewRouter';
import { InboundMessage } from '../types/webviewMessages';
import {
	FakeWebviewHost,
	InMemoryMemento,
	overrideWorkspaceFolders,
	restoreWorkspaceFoldersDescriptor,
	stubReadConfig,
} from './testUtils';

interface RepositoryHarness {
	repository: TodoRepository;
	globalState: InMemoryMemento;
	workspaceState: InMemoryMemento;
}

function createRepositoryHarness(): RepositoryHarness {
	const globalState = new InMemoryMemento();
	const workspaceState = new InMemoryMemento();
	const repository = new TodoRepository({
		globalState,
		workspaceState,
	});
	return { repository, globalState, workspaceState };
}

suite('Command handlers', () => {
	const originalShowQuickPick = vscode.window.showQuickPick;
	const originalExecuteCommand = vscode.commands.executeCommand;
	const originalShowWarningMessage = vscode.window.showWarningMessage;
	const originalShowInformationMessage = vscode.window.showInformationMessage;
	const originalGetConfiguration = vscode.workspace.getConfiguration;
	const activeAutoDeleteCoordinators: AutoDeleteCoordinator<HandlerContext>[] = [];
	let restoreReadConfig: (() => void) | undefined;

	function createAutoDelete(host?: FakeWebviewHost): AutoDeleteCoordinator<HandlerContext> {
		const instance = new AutoDeleteCoordinator<HandlerContext>({
			removeTodo: async (context, scope, todoId) =>
				removeTodoWithoutUndo(context.repository, scope, todoId),
			sendCue: host
				? (scope, todoId, durationMs) =>
						host.postMessage(scopeToProviderMode(scope), {
							type: 'autoDeleteCue',
							scope: scope.scope === 'global'
								? { scope: 'global' }
								: { scope: 'workspace', workspaceFolder: scope.workspaceFolder },
							todoId,
							durationMs,
						})
				: undefined,
		});
		activeAutoDeleteCoordinators.push(instance);
		return instance;
	}

	function toHandlerContext(
		repository: TodoRepository,
		webviewHost: Pick<TodoWebviewHost, 'postMessage' | 'broadcast'>,
		autoDelete: AutoDeleteCoordinator<HandlerContext>
	): HandlerContext {
		return { repository, webviewHost: webviewHost as TodoWebviewHost, autoDelete };
	}

	async function removeTodoWithoutUndo(
		repository: TodoRepository,
		scope: ScopeTarget,
		todoId: string
	): Promise<boolean> {
		const todos =
			scope.scope === 'global'
				? repository.getGlobalTodos()
				: repository.getWorkspaceTodos(scope.workspaceFolder);
		const next = todos.filter((item) => item.id !== todoId);
		if (next.length === todos.length) {
			return false;
		}
		if (scope.scope === 'global') {
			await repository.saveGlobalTodos(next);
		} else {
			await repository.saveWorkspaceTodos(scope.workspaceFolder, next);
		}
		return true;
	}

	function scopeToProviderMode(scope: ScopeTarget): string {
		return scope.scope === 'global' ? 'global' : 'projects';
	}

	afterEach(() => {
		(vscode.window as unknown as { showQuickPick: typeof vscode.window.showQuickPick }).showQuickPick =
			originalShowQuickPick;
		(vscode.commands as unknown as { executeCommand: typeof vscode.commands.executeCommand }).executeCommand =
			originalExecuteCommand;
		(vscode.window as unknown as { showWarningMessage: typeof vscode.window.showWarningMessage }).showWarningMessage =
			originalShowWarningMessage;
		(vscode.window as unknown as { showInformationMessage: typeof vscode.window.showInformationMessage }).showInformationMessage =
			originalShowInformationMessage;
		(vscode.workspace as unknown as { getConfiguration: typeof vscode.workspace.getConfiguration }).getConfiguration =
			originalGetConfiguration;
		restoreReadConfig?.();
		restoreReadConfig = undefined;
		activeAutoDeleteCoordinators.forEach((instance) => instance.dispose());
		activeAutoDeleteCoordinators.length = 0;
		restoreWorkspaceFoldersDescriptor();
	});

	test('addTodo dispatches inline create after focusing container', async () => {
		const { repository } = createRepositoryHarness();
		const host = new FakeWebviewHost();
		const autoDelete = createAutoDelete(host);
		const executedCommands: string[] = [];
		const executeCommandStub: typeof vscode.commands.executeCommand = async (command: string) => {
			executedCommands.push(command);
			return undefined as unknown as never;
		};
		(vscode.commands as unknown as { executeCommand: typeof vscode.commands.executeCommand }).executeCommand =
			executeCommandStub;
		const showQuickPickStub: typeof vscode.window.showQuickPick = async (items: any) =>
			(items as readonly vscode.QuickPickItem[])[0] as any;
		(vscode.window as unknown as { showQuickPick: typeof vscode.window.showQuickPick }).showQuickPick =
			showQuickPickStub;

		await addTodo(toHandlerContext(repository, host, autoDelete), () =>
			host.broadcast({ type: 'stateUpdate', payload: null })
		);

		assert.deepStrictEqual(executedCommands, ['workbench.view.extension.todoContainer']);
		assert.ok(
			host.broadcastMessages.some(
				(message) => (message as { type: string }).type === 'stateUpdate'
			)
		);
		assert.deepStrictEqual(host.postMessages[0], {
			mode: 'global',
			message: { type: 'startInlineCreate', scope: { scope: 'global' } },
		});
	});

	test('addTodo targets selected workspace in multi-root quick pick', async () => {
		const folderA = vscode.Uri.parse('file:///workspace-a');
		const folderB = vscode.Uri.parse('file:///workspace-b');
		overrideWorkspaceFolders([
			{ uri: folderA, name: 'Workspace A', index: 0 },
			{ uri: folderB, name: 'Workspace B', index: 1 },
		]);
		const { repository } = createRepositoryHarness();
		const host = new FakeWebviewHost();
		const autoDelete = createAutoDelete(host);
		const executedCommands: string[] = [];
	const executeCommandStub: typeof vscode.commands.executeCommand = async (command: string) => {
		executedCommands.push(command);
		return undefined as unknown as never;
	};
	(vscode.commands as unknown as { executeCommand: typeof vscode.commands.executeCommand }).executeCommand =
		executeCommandStub;
	const showQuickPickStub: typeof vscode.window.showQuickPick = async (items: any) => {
		const pick = (items as readonly vscode.QuickPickItem[]).find(
			(item) => item.label === 'Workspace B'
		);
		return pick as any;
	};
	(vscode.window as unknown as { showQuickPick: typeof vscode.window.showQuickPick }).showQuickPick =
		showQuickPickStub;

		await addTodo(toHandlerContext(repository, host, autoDelete), () =>
			host.broadcast({ type: 'stateUpdate', payload: null })
		);

		assert.deepStrictEqual(executedCommands, ['workbench.view.extension.todoContainer']);
		assert.ok(
			host.broadcastMessages.some(
				(message) => (message as { type: string }).type === 'stateUpdate'
			)
		);
		assert.deepStrictEqual(host.postMessages[0], {
			mode: 'projects',
			message: {
				type: 'startInlineCreate',
				scope: { scope: 'workspace', workspaceFolder: folderB.toString() },
			},
		});
	});

	test('editTodo dispatches inline edit for selected todo', async () => {
		const { repository } = createRepositoryHarness();
		const todo = repository.createTodo({ title: 'Edit me', scope: 'global' });
		await repository.saveGlobalTodos([todo]);

		const host = new FakeWebviewHost();
		const autoDelete = createAutoDelete(host);
		const executedCommands: string[] = [];
		const executeCommandStub: typeof vscode.commands.executeCommand = async (command: string) => {
			executedCommands.push(command);
			return undefined as unknown as never;
		};
		(vscode.commands as unknown as { executeCommand: typeof vscode.commands.executeCommand }).executeCommand =
			executeCommandStub;
		const showQuickPickStub: typeof vscode.window.showQuickPick = async (items: any) =>
			(items as readonly vscode.QuickPickItem[])[0] as any;
		(vscode.window as unknown as { showQuickPick: typeof vscode.window.showQuickPick }).showQuickPick =
			showQuickPickStub;

		await editTodo(toHandlerContext(repository, host, autoDelete), () =>
			host.broadcast({ type: 'stateUpdate', payload: null })
		);

		assert.deepStrictEqual(executedCommands, ['workbench.view.extension.todoContainer']);
		assert.ok(
			host.broadcastMessages.some(
				(message) => (message as { type: string }).type === 'stateUpdate'
			)
		);
		assert.deepStrictEqual(host.postMessages[0], {
			mode: 'global',
			message: { type: 'startInlineEdit', scope: { scope: 'global' }, todoId: todo.id },
		});
	});

	test('editTodo respects workspace selection in multi-root quick pick', async () => {
		const folderA = vscode.Uri.parse('file:///folder-a');
		const folderB = vscode.Uri.parse('file:///folder-b');
		overrideWorkspaceFolders([
			{ uri: folderA, name: 'Workspace A', index: 0 },
			{ uri: folderB, name: 'Workspace B', index: 1 },
		]);
	const { repository } = createRepositoryHarness();
	const workspaceTodo = repository.createTodo({
		title: 'Workspace edit',
		scope: 'workspace',
		workspaceFolder: folderB.toString(),
	});
	await repository.saveWorkspaceTodos(folderB.toString(), [workspaceTodo]);

	const host = new FakeWebviewHost();
	const autoDelete = createAutoDelete(host);
	const executedCommands: string[] = [];
	const executeCommandStub: typeof vscode.commands.executeCommand = async (command: string) => {
		executedCommands.push(command);
		return undefined as unknown as never;
	};
	(vscode.commands as unknown as { executeCommand: typeof vscode.commands.executeCommand }).executeCommand =
		executeCommandStub;
	const showQuickPickStub: typeof vscode.window.showQuickPick = async (items: any) => {
		const pick = (items as readonly vscode.QuickPickItem[]).find(
			(item) => item.label === workspaceTodo.title
		);
		return pick as any;
	};
	(vscode.window as unknown as { showQuickPick: typeof vscode.window.showQuickPick }).showQuickPick =
		showQuickPickStub;

	await editTodo(toHandlerContext(repository, host, autoDelete), () =>
		host.broadcast({ type: 'stateUpdate', payload: null })
	);

	assert.deepStrictEqual(executedCommands, ['workbench.view.extension.todoContainer']);
	assert.ok(
		host.broadcastMessages.some(
			(message) => (message as { type: string }).type === 'stateUpdate'
		)
	);
	assert.deepStrictEqual(host.postMessages[0], {
		mode: 'projects',
		message: {
			type: 'startInlineEdit',
			scope: { scope: 'workspace', workspaceFolder: folderB.toString() },
			todoId: workspaceTodo.id,
		},
	});
});

	test('reorders workspace todos via webview message', async () => {
		const folder = vscode.Uri.parse('file:///project');
		overrideWorkspaceFolders([{ uri: folder, name: 'project', index: 0 }]);
		const { repository } = createRepositoryHarness();
		const todoA = repository.createTodo({
			title: 'First',
			scope: 'workspace',
			workspaceFolder: folder.toString(),
		});
		const todoB = repository.createTodo({
			title: 'Second',
			scope: 'workspace',
			workspaceFolder: folder.toString(),
		});
		await repository.saveWorkspaceTodos(folder.toString(), [todoA, todoB]);

		const host = new FakeWebviewHost();
		const autoDelete = createAutoDelete(host);
		const message: InboundMessage = {
			type: 'reorderTodos',
			scope: { scope: 'workspace', workspaceFolder: folder.toString() },
			order: [todoB.id, todoA.id],
		};
		await handleWebviewMessage(
			{ mode: 'projects', message },
			toHandlerContext(repository, host, autoDelete)
		);

		const todos = repository.getWorkspaceTodos(folder.toString());
		assert.strictEqual(todos[0].id, todoB.id);
		assert.strictEqual(todos[0].position, 1);
		assert.strictEqual(todos[1].id, todoA.id);
		assert.ok(
			host.broadcastMessages.some(
				(message) => (message as { type: string }).type === 'stateUpdate'
			)
		);
	});

	test('clears and restores workspace todos via undo from webview', async () => {
		const folder = vscode.Uri.parse('file:///workspace');
		overrideWorkspaceFolders([{ uri: folder, name: 'workspace', index: 0 }]);
		const { repository } = createRepositoryHarness();
		const todoA = repository.createTodo({
			title: 'A',
			scope: 'workspace',
			workspaceFolder: folder.toString(),
		});
		const todoB = repository.createTodo({
			title: 'B',
			scope: 'workspace',
			workspaceFolder: folder.toString(),
		});
		await repository.saveWorkspaceTodos(folder.toString(), [todoA, todoB]);

		const host = new FakeWebviewHost();
		const autoDelete = createAutoDelete(host);
		(vscode.window as unknown as { showWarningMessage: typeof vscode.window.showWarningMessage }).showWarningMessage =
			async (...args: any[]) => args[2];
		let infoCall = 0;
		const infoMessages: any[] = [];
		(vscode.window as unknown as { showInformationMessage: typeof vscode.window.showInformationMessage }).showInformationMessage =
			async (...args: any[]) => {
				infoMessages.push(args);
				if (infoCall === 0 && args.length > 1) {
					infoCall += 1;
					return args[1];
				}
				infoCall += 1;
				return undefined;
			};

		const message: InboundMessage = {
			type: 'clearScope',
			scope: { scope: 'workspace', workspaceFolder: folder.toString() },
		};
		await handleWebviewMessage(
			{ mode: 'projects', message },
			toHandlerContext(repository, host, autoDelete)
		);

		const restored = repository.getWorkspaceTodos(folder.toString());
		assert.strictEqual(restored.length, 2);
		assert.strictEqual(restored[0].title, 'A');
		assert.strictEqual(restored[1].title, 'B');
		assert.ok(infoMessages.length >= 2);
		assert.ok(
			host.broadcastMessages.filter(
				(message) => (message as { type: string }).type === 'stateUpdate'
			).length >= 2
		);
	});

	test('removes a todo via webview with undo support', async () => {
		const { repository } = createRepositoryHarness();
		const todo = repository.createTodo({ title: 'Remove me', scope: 'global' });
		await repository.saveGlobalTodos([todo]);

		const host = new FakeWebviewHost();
		const autoDelete = createAutoDelete();
		let infoCall = 0;
		const infoMessages: any[] = [];
		(vscode.window as unknown as { showInformationMessage: typeof vscode.window.showInformationMessage }).showInformationMessage =
			async (...args: any[]) => {
				infoMessages.push(args);
				if (infoCall === 0 && args.length > 1) {
					infoCall += 1;
					return args[1];
				}
				infoCall += 1;
				return undefined;
			};

		const message: InboundMessage = {
			type: 'removeTodo',
			scope: { scope: 'global' },
			todoId: todo.id,
		};
		await handleWebviewMessage(
			{ mode: 'global', message },
			toHandlerContext(repository, host, autoDelete)
		);

		const restored = repository.getGlobalTodos();
		assert.strictEqual(restored.length, 1);
		assert.strictEqual(restored[0].title, 'Remove me');
		assert.ok(infoMessages.length >= 2);
		const removedMessages = ['Removed "Remove me" from Global', 'command.remove.success'];
		const restoredMessages = ['Restored "Remove me" to Global', 'command.undo.todo.success'];
		assert.ok(removedMessages.includes(infoMessages[0][0]));
		assert.ok(restoredMessages.includes(infoMessages[1][0]));
		assert.ok(
			host.broadcastMessages.filter(
				(message) => (message as { type: string }).type === 'stateUpdate'
			).length >= 2
		);
	});

	test('auto-deletes completed todos after the configured delay', async () => {
		const { repository } = createRepositoryHarness();
		const todo = repository.createTodo({ title: 'Auto remove', scope: 'global' });
		await repository.saveGlobalTodos([todo]);

		const host = new FakeWebviewHost();
		const autoDelete = createAutoDelete();
		const infoMessages: any[] = [];
		(vscode.window as unknown as { showInformationMessage: typeof vscode.window.showInformationMessage }).showInformationMessage =
			async (...args: any[]) => {
				infoMessages.push(args);
				return undefined;
			};
		restoreReadConfig = stubReadConfig({
			autoDeleteCompleted: true,
			autoDeleteDelayMs: 5,
			autoDeleteFadeMs: 10,
			confirmDestructiveActions: true,
		});

		const message: InboundMessage = {
			type: 'toggleComplete',
			scope: { scope: 'global' },
			todoId: todo.id,
		};
		await handleWebviewMessage(
			{ mode: 'global', message },
			toHandlerContext(repository, host, autoDelete)
		);

		await new Promise((resolve) => setTimeout(resolve, 75));

		assert.strictEqual(repository.getGlobalTodos().length, 0);
		assert.strictEqual(infoMessages.length, 0);
	});

	test('respects the auto-delete enablement setting', async () => {
		const { repository } = createRepositoryHarness();
		const todo = repository.createTodo({ title: 'Keep me', scope: 'global' });
		await repository.saveGlobalTodos([todo]);

		const host = new FakeWebviewHost();
		const autoDelete = createAutoDelete();
		restoreReadConfig = stubReadConfig({
			autoDeleteCompleted: false,
			autoDeleteDelayMs: 5,
			autoDeleteFadeMs: 10,
			confirmDestructiveActions: true,
		});

		const message: InboundMessage = {
			type: 'toggleComplete',
			scope: { scope: 'global' },
			todoId: todo.id,
		};
		await handleWebviewMessage(
			{ mode: 'global', message },
			toHandlerContext(repository, host, autoDelete)
		);

		await new Promise((resolve) => setTimeout(resolve, 25));

		const todos = repository.getGlobalTodos();
		assert.strictEqual(todos.length, 1);
		assert.strictEqual(todos[0].completed, true);
		const autoDeleteMessages = host.postMessages.filter(
			(entry) => (entry.message as { type?: string }).type === 'autoDeleteCue'
		);
		assert.strictEqual(autoDeleteMessages.length, 0);
	});

	test('clears and restores global todos via undo from webview', async () => {
		const { repository } = createRepositoryHarness();
		const todoA = repository.createTodo({ title: 'Global A', scope: 'global' });
		const todoB = repository.createTodo({ title: 'Global B', scope: 'global' });
		await repository.saveGlobalTodos([todoA, todoB]);

		const host = new FakeWebviewHost();
		const autoDelete = createAutoDelete();
		(vscode.window as unknown as { showWarningMessage: typeof vscode.window.showWarningMessage }).showWarningMessage =
			async (...args: any[]) => args[2];
		let infoCall = 0;
		const infoMessages: any[] = [];
		(vscode.window as unknown as { showInformationMessage: typeof vscode.window.showInformationMessage }).showInformationMessage =
			async (...args: any[]) => {
				infoMessages.push(args);
				if (infoCall === 0 && args.length > 1) {
					infoCall += 1;
					return args[1];
				}
				infoCall += 1;
				return undefined;
			};

		const message: InboundMessage = {
			type: 'clearScope',
			scope: { scope: 'global' },
		};
		await handleWebviewMessage(
			{ mode: 'global', message },
			toHandlerContext(repository, host, autoDelete)
		);

		const restored = repository.getGlobalTodos();
		assert.strictEqual(restored.length, 2);
		assert.strictEqual(restored[0].title, 'Global A');
		assert.strictEqual(restored[1].title, 'Global B');
		assert.ok(infoMessages.length >= 2);
		assert.ok(
			host.broadcastMessages.filter(
				(message) => (message as { type: string }).type === 'stateUpdate'
			).length >= 2
		);
	});
});