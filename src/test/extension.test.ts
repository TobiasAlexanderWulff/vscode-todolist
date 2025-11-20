import * as assert from 'assert';
import { afterEach } from 'mocha';
import * as vscode from 'vscode';

import { addTodo, editTodo } from '../extension';
import { TodoRepository } from '../todoRepository';
import { Todo } from '../types';

class InMemoryMemento implements vscode.Memento {
	private readonly store = new Map<string, unknown>();
	private syncedKeys: readonly string[] = [];

	get<T>(key: string, defaultValue?: T): T | undefined {
		if (this.store.has(key)) {
			return this.store.get(key) as T;
		}
		return defaultValue;
	}

	update<T>(key: string, value: T): Thenable<void> {
		if (value === undefined) {
			this.store.delete(key);
		} else {
			this.store.set(key, value);
		}
		return Promise.resolve();
	}

	keys(): readonly string[] {
		return Array.from(this.store.keys());
	}

	setKeysForSync(keys: readonly string[]): void {
		this.syncedKeys = keys;
	}
}

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

suite('TodoRepository', () => {
	test('creates scoped todos with metadata', () => {
		const { repository } = createRepositoryHarness();

		const globalTodo = repository.createTodo({ title: 'Review tests', scope: 'global' });
		assert.strictEqual(globalTodo.scope, 'global');
		assert.ok(globalTodo.id.length > 0);
		assert.strictEqual(globalTodo.workspaceFolder, undefined);

		const workspaceTodo = repository.createTodo({
			title: 'Wire TreeView',
			scope: 'workspace',
			workspaceFolder: 'file:///test',
		});
		assert.strictEqual(workspaceTodo.scope, 'workspace');
		assert.strictEqual(workspaceTodo.workspaceFolder, 'file:///test');
		assert.ok(workspaceTodo.position >= 1);
	});

	test('persists global todos via the global state memento', async () => {
		const harness = createRepositoryHarness();
		const todo = harness.repository.createTodo({ title: 'Write docs', scope: 'global' });
		await harness.repository.saveGlobalTodos([todo]);

		const secondRepository = new TodoRepository({
			globalState: harness.globalState,
			workspaceState: harness.workspaceState,
		});
		const todos = secondRepository.getGlobalTodos();
		assert.strictEqual(todos.length, 1);
		assert.strictEqual(todos[0].title, 'Write docs');
	});

	test('captures and restores snapshots per scope', () => {
		const { repository } = createRepositoryHarness();
		const workspaceFolder = 'file:///restore';
		const todo = repository.createTodo({
			title: 'Snapshot me',
			scope: 'workspace',
			workspaceFolder,
		});
		const scopeKey = repository.scopeKey('workspace', workspaceFolder);

		repository.captureSnapshot(scopeKey, [todo]);
		const restored = repository.consumeSnapshot(scopeKey) as Todo[];
		assert.strictEqual(restored.length, 1);
		assert.strictEqual(restored[0].title, 'Snapshot me');
		assert.strictEqual(repository.consumeSnapshot(scopeKey), undefined);
	});
});

suite('Command handlers', () => {
	const originalShowQuickPick = vscode.window.showQuickPick;
	const originalExecuteCommand = vscode.commands.executeCommand;

	class FakeWebviewHost {
		readonly postMessages: Array<{ mode: string; message: unknown }> = [];
		readonly broadcastMessages: unknown[] = [];

		postMessage(mode: string, message: unknown): void {
			this.postMessages.push({ mode, message });
		}

		broadcast(message: unknown): void {
			this.broadcastMessages.push(message);
		}
	}

	afterEach(() => {
		(vscode.window as unknown as { showQuickPick: typeof vscode.window.showQuickPick }).showQuickPick =
			originalShowQuickPick;
		(vscode.commands as unknown as { executeCommand: typeof vscode.commands.executeCommand }).executeCommand =
			originalExecuteCommand;
	});

test('addTodo dispatches inline create after focusing container', async () => {
		const { repository } = createRepositoryHarness();
		const host = new FakeWebviewHost();
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

		await addTodo({ repository, webviewHost: host } as any);

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

	test('editTodo dispatches inline edit for selected todo', async () => {
		const { repository } = createRepositoryHarness();
		const todo = repository.createTodo({ title: 'Edit me', scope: 'global' });
		await repository.saveGlobalTodos([todo]);

		const host = new FakeWebviewHost();
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

		await editTodo({ repository, webviewHost: host } as any);

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
});
