import * as l10n from '@vscode/l10n';
import * as vscode from 'vscode';

import { TodoRepository } from './todoRepository';
import { TreeNode, TodoTreeDataProvider, getWorkspaceFolderKey } from './todoTreeDataProvider';
import { Todo } from './types';

type ScopeTarget = { scope: 'global' } | { scope: 'workspace'; workspaceFolder: string };
type TodoTarget =
	| { todoId: string; scope: 'global' }
	| { todoId: string; scope: 'workspace'; workspaceFolder: string };

const TREE_VIEW_ID = 'todoView';

export async function activate(context: vscode.ExtensionContext): Promise<void> {
	await l10n.config({ fsPath: context.asAbsolutePath('l10n/bundle.l10n.json') });

	const repository = new TodoRepository(context);
	const treeProvider = new TodoTreeDataProvider(repository);
	const treeView = vscode.window.createTreeView<TreeNode>(TREE_VIEW_ID, {
		treeDataProvider: treeProvider,
		dragAndDropController: treeProvider.dragAndDropController,
		showCollapseAll: true,
	});

	let lastSelectedNode: TreeNode | undefined;
	treeView.onDidChangeSelection((event) => {
		lastSelectedNode = event.selection[0];
	});

	context.subscriptions.push(treeProvider, treeView);

	registerCommands({
		context,
		repository,
		treeProvider,
		getSelectedNode: () => lastSelectedNode,
	});

	console.log(l10n.t('extension.activatedLog', 'vscode-todo extension activated.'));
}

export function deactivate(): void {
	// Nothing to clean up yet.
}

interface CommandContext {
	context: vscode.ExtensionContext;
	repository: TodoRepository;
	treeProvider: TodoTreeDataProvider;
	getSelectedNode: () => TreeNode | undefined;
}

function registerCommands({
	context,
	repository,
	treeProvider,
	getSelectedNode,
}: CommandContext): void {
	context.subscriptions.push(
		vscode.commands.registerCommand('todo.addTodo', (node?: TreeNode) =>
			addTodo({ repository, treeProvider, getSelectedNode }, node)
		),
		vscode.commands.registerCommand('todo.editTodo', (node?: TreeNode) =>
			editTodo({ repository, treeProvider, getSelectedNode }, node)
		),
		vscode.commands.registerCommand('todo.completeTodo', (node?: TreeNode) =>
			toggleTodoCompletion({ repository, treeProvider, getSelectedNode }, node)
		),
		vscode.commands.registerCommand('todo.removeTodo', (node?: TreeNode) =>
			removeTodo({ repository, treeProvider, getSelectedNode }, node)
		),
		vscode.commands.registerCommand('todo.clearTodos', (node?: TreeNode) =>
			clearTodos({ repository, treeProvider, getSelectedNode }, node)
		)
	);
}

interface HandlerContext {
	repository: TodoRepository;
	treeProvider: TodoTreeDataProvider;
	getSelectedNode: () => TreeNode | undefined;
}

async function addTodo(
	context: HandlerContext,
	node?: TreeNode
): Promise<void> {
	const scope = await resolveScopeTarget(context, node);
	if (!scope) {
		return;
	}
	const title = await vscode.window.showInputBox({
		prompt: l10n.t('command.add.prompt', 'What needs to be done?'),
		placeHolder: l10n.t('command.add.placeholder', 'Type a TODO'),
		ignoreFocusOut: true,
		validateInput: (value) =>
			value.trim().length === 0 ? l10n.t('command.validate.title', 'Enter a title') : undefined,
	});
	if (!title) {
		return;
	}
	const todo = context.repository.createTodo({
		title: title.trim(),
		scope: scope.scope,
		workspaceFolder: scope.scope === 'workspace' ? scope.workspaceFolder : undefined,
	});
	const todos = readTodos(context.repository, scope);
	todos.push(todo);
	await persistTodos(context.repository, scope, todos);
	context.treeProvider.refresh();
}

async function editTodo(
	context: HandlerContext,
	node?: TreeNode
): Promise<void> {
	const target = await resolveTodoTarget(context, node);
	if (!target) {
		return;
	}
	const todos = readTodos(context.repository, target);
	const existing = todos.find((todo) => todo.id === target.todoId);
	if (!existing) {
		return;
	}
	const title = await vscode.window.showInputBox({
		prompt: l10n.t('command.edit.prompt', 'Update TODO'),
		value: existing.title,
		validateInput: (value) =>
			value.trim().length === 0 ? l10n.t('command.validate.title', 'Enter a title') : undefined,
	});
	if (!title) {
		return;
	}
	existing.title = title.trim();
	existing.updatedAt = new Date().toISOString();
	await persistTodos(context.repository, target, todos);
	context.treeProvider.refresh();
}

async function toggleTodoCompletion(
	context: HandlerContext,
	node?: TreeNode
): Promise<void> {
	const target = await resolveTodoTarget(context, node);
	if (!target) {
		return;
	}
	const todos = readTodos(context.repository, target);
	const todo = todos.find((item) => item.id === target.todoId);
	if (!todo) {
		return;
	}
	todo.completed = !todo.completed;
	todo.updatedAt = new Date().toISOString();
	await persistTodos(context.repository, target, todos);
	const stateMessage = todo.completed
		? l10n.t('command.complete.completed', 'Marked TODO as completed')
		: l10n.t('command.complete.reopened', 'Marked TODO as active');
	vscode.window.setStatusBarMessage(stateMessage, 2000);
	context.treeProvider.refresh();
}

async function removeTodo(
	context: HandlerContext,
	node?: TreeNode
): Promise<void> {
	const target = await resolveTodoTarget(context, node);
	if (!target) {
		return;
	}
	const todos = readTodos(context.repository, target);
	const next = todos.filter((todo) => todo.id !== target.todoId);
	if (next.length === todos.length) {
		return;
	}
	await persistTodos(context.repository, target, next);
	context.treeProvider.refresh();
}

async function clearTodos(
	context: HandlerContext,
	node?: TreeNode
): Promise<void> {
	const scope = await resolveScopeTarget(context, node);
	if (!scope) {
		return;
	}
	const todos = readTodos(context.repository, scope);
	if (todos.length === 0) {
		vscode.window.showInformationMessage(
			l10n.t('command.clear.empty', 'No TODOs to clear for {0}', describeScope(scope))
		);
		return;
	}
	const confirmSetting = vscode.workspace
		.getConfiguration('todo')
		.get<boolean>('confirmDestructiveActions', true);
	if (confirmSetting && todos.length > 1) {
		const confirmAction = l10n.t('command.clear.confirmAction', 'Clear');
		const title = l10n.t(
			'command.clear.confirmTitle',
			'Clear all TODOs for {0}?',
			describeScope(scope)
		);
		const selection = await vscode.window.showWarningMessage(
			title,
			{ modal: true },
			confirmAction
		);
		if (selection !== confirmAction) {
			return;
		}
	}
	const scopeKey = context.repository.scopeKey(
		scope.scope,
		scope.scope === 'workspace' ? scope.workspaceFolder : undefined
	);
	context.repository.captureSnapshot(scopeKey, todos);
	await persistTodos(context.repository, scope, []);
	context.treeProvider.refresh();
	const undoAction = l10n.t('command.undo', 'Undo');
	const clearedMessage = l10n.t(
		'command.clear.success',
		'Cleared TODOs for {0}',
		describeScope(scope)
	);
	const undoSelection = await vscode.window.showInformationMessage(
		clearedMessage,
		undoAction
	);
	if (undoSelection === undoAction) {
		const snapshot = context.repository.consumeSnapshot(scopeKey);
		if (snapshot) {
			await persistTodos(context.repository, scope, snapshot);
			context.treeProvider.refresh();
			vscode.window.showInformationMessage(
				l10n.t('command.undo.success', 'Restored TODOs for {0}', describeScope(scope))
			);
		}
	} else {
		// Expire snapshot after a short delay.
		setTimeout(() => context.repository.consumeSnapshot(scopeKey), 10_000);
	}
}

async function resolveScopeTarget(
	context: HandlerContext,
	node?: TreeNode
): Promise<ScopeTarget | undefined> {
	const fromNode = scopeFromNode(node ?? context.getSelectedNode());
	if (fromNode) {
		return fromNode;
	}
	return promptForScope();
}

function scopeFromNode(node?: TreeNode): ScopeTarget | undefined {
	if (!node) {
		return undefined;
	}
	if (node.kind === 'globalRoot') {
		return { scope: 'global' };
	}
	if (node.kind === 'workspace') {
		return { scope: 'workspace', workspaceFolder: getWorkspaceFolderKey(node.folder) };
	}
	if (node.kind === 'todo') {
		if (node.todo.scope === 'global') {
			return { scope: 'global' };
		}
		if (node.todo.workspaceFolder) {
			return { scope: 'workspace', workspaceFolder: node.todo.workspaceFolder };
		}
	}
	return undefined;
}

async function promptForScope(): Promise<ScopeTarget | undefined> {
	const items: Array<vscode.QuickPickItem & { scope: ScopeTarget }> = [
		{
			label: l10n.t('scope.global.label', 'Global'),
			detail: l10n.t('scope.global.detail', 'Profile-wide list'),
			scope: { scope: 'global' },
		},
	];
	(vscode.workspace.workspaceFolders ?? []).forEach((folder) => {
		items.push({
			label: folder.name,
			description: folder.uri.fsPath,
			scope: { scope: 'workspace', workspaceFolder: getWorkspaceFolderKey(folder) },
		});
	});
	const selection = await vscode.window.showQuickPick(items, {
		title: l10n.t('scope.pick.title', 'Where should the TODO live?'),
	});
	return selection?.scope;
}

async function resolveTodoTarget(
	context: HandlerContext,
	node?: TreeNode
): Promise<TodoTarget | undefined> {
	const fromNode = node ?? context.getSelectedNode();
	if (fromNode && fromNode.kind === 'todo') {
		if (fromNode.todo.scope === 'global') {
			return { todoId: fromNode.todo.id, scope: 'global' };
		}
		if (fromNode.todo.workspaceFolder) {
			return {
				todoId: fromNode.todo.id,
				scope: 'workspace',
				workspaceFolder: fromNode.todo.workspaceFolder,
			};
		}
	}
	const picks = buildTodoQuickPickItems(context.repository);
	if (picks.length === 0) {
		vscode.window.showInformationMessage(
			l10n.t('command.noTodos', 'Create a TODO first, then try again.')
		);
		return undefined;
	}
	const selection = await vscode.window.showQuickPick(picks, {
		title: l10n.t('command.pickTodo', 'Select a TODO'),
	});
	return selection?.target;
}

function buildTodoQuickPickItems(
	repository: TodoRepository
): Array<vscode.QuickPickItem & { target: TodoTarget }> {
	const items: Array<vscode.QuickPickItem & { target: TodoTarget }> = [];
	repository
		.getGlobalTodos()
		.sort((a, b) => a.position - b.position)
		.forEach((todo) => {
			items.push({
				label: todo.title,
				description: l10n.t('scope.global.label', 'Global'),
				target: { todoId: todo.id, scope: 'global' },
			});
		});
	(vscode.workspace.workspaceFolders ?? []).forEach((folder) => {
		const folderKey = getWorkspaceFolderKey(folder);
		repository
			.getWorkspaceTodos(folderKey)
			.sort((a, b) => a.position - b.position)
			.forEach((todo) => {
				items.push({
					label: todo.title,
					description: folder.name,
					target: { todoId: todo.id, scope: 'workspace', workspaceFolder: folderKey },
				});
			});
	});
	return items;
}

function readTodos(repository: TodoRepository, scope: ScopeTarget): Todo[] {
	if (scope.scope === 'global') {
		return repository.getGlobalTodos();
	}
	return repository.getWorkspaceTodos(scope.workspaceFolder);
}

async function persistTodos(
	repository: TodoRepository,
	scope: ScopeTarget,
	todos: Todo[]
): Promise<void> {
	const normalized = normalizePositions(todos);
	if (scope.scope === 'global') {
		await repository.saveGlobalTodos(normalized);
	} else {
		await repository.saveWorkspaceTodos(scope.workspaceFolder, normalized);
	}
}

function normalizePositions(todos: Todo[]): Todo[] {
	return [...todos]
		.sort((a, b) => a.position - b.position)
		.map((todo, index) => ({
			...todo,
			position: index + 1,
		}));
}

function describeScope(scope: ScopeTarget): string {
	if (scope.scope === 'global') {
		return l10n.t('scope.global.label', 'Global');
	}
	const folder = findWorkspaceFolder(scope.workspaceFolder);
	return folder?.name ?? l10n.t('scope.workspace.unknown', 'Project');
}

function findWorkspaceFolder(key?: string): vscode.WorkspaceFolder | undefined {
	return (vscode.workspace.workspaceFolders ?? []).find(
		(folder) => folder.uri.toString() === key
	);
}
