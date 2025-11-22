import * as l10n from '@vscode/l10n';
import * as vscode from 'vscode';

import { normalizePositions } from '../domain/todo';
import { HandlerContext } from '../types/handlerContext';
import { ScopeTarget, TodoTarget } from '../types/scope';
import {
	clearScope as clearScopeService,
	removeTodoWithUndo as removeTodoWithUndoService,
} from '../services/todoOperations';
import { Todo } from '../types';
import { TodoWebviewHost } from '../todoWebviewHost';
import { readConfig } from './config';
import {
	scopeTargetToWebviewScope,
	scopeToProviderMode,
} from './scopeMapping';

/** Dependencies required to register command handlers. */
interface CommandDependencies {
	context: vscode.ExtensionContext;
	handlerContext: HandlerContext;
	broadcastState: () => void;
}

/**
 * Registers command palette entries and wires them to their handlers.
 *
 * @param context - Extension context used for disposal.
 * @param handlerContext - Shared dependencies for the handlers.
 * @param broadcastState - Callback that refreshes webview state.
 */
export function registerCommands({
	context,
	handlerContext,
	broadcastState,
}: CommandDependencies): void {
	context.subscriptions.push(
		vscode.commands.registerCommand('todo.addTodo', () =>
			addTodo(handlerContext, broadcastState)
		),
		vscode.commands.registerCommand('todo.editTodo', () =>
			editTodo(handlerContext, broadcastState)
		),
		vscode.commands.registerCommand('todo.completeTodo', () =>
			toggleTodoCompletion(handlerContext, broadcastState)
		),
		vscode.commands.registerCommand('todo.removeTodo', () =>
			removeTodo(handlerContext, broadcastState)
		),
		vscode.commands.registerCommand('todo.clearTodos', () =>
			clearTodos(handlerContext, broadcastState)
		)
	);
}

/**
 * Adds a todo by prompting for scope and focusing the webview to start inline creation.
 *
 * @param context - Handler context with repository and webview host.
 * @param broadcastState - Callback to sync webview state.
 */
export async function addTodo(
	context: HandlerContext,
	broadcastState: () => void
): Promise<void> {
	const scope = await resolveScopeTarget();
	if (!scope) {
		return;
	}
	await focusTodoContainer();
	broadcastState();
	dispatchInlineCreate(context.webviewHost, scope);
}

/**
 * Begins inline edit for a todo chosen by the user.
 *
 * @param context - Handler context with repository and webview host.
 * @param broadcastState - Callback to sync webview state.
 */
export async function editTodo(
	context: HandlerContext,
	broadcastState: () => void
): Promise<void> {
	const target = await resolveTodoTarget(context);
	if (!target) {
		return;
	}
	const todos = readTodos(context.repository, target);
	const existing = todos.find((todo) => todo.id === target.todoId);
	if (!existing) {
		return;
	}
	await focusTodoContainer();
	broadcastState();
	dispatchInlineEdit(context.webviewHost, target);
}

/**
 * Toggles completion for a selected todo and schedules auto-delete when applicable.
 *
 * @param context - Handler context with repository and auto-delete coordinator.
 * @param broadcastState - Callback to sync webview state.
 */
async function toggleTodoCompletion(
	context: HandlerContext,
	broadcastState: () => void
): Promise<void> {
	const target = await resolveTodoTarget(context);
	if (!target) {
		return;
	}
	const scope = todoTargetToScopeTarget(target);
	if (!scope) {
		return;
	}
	const todos = readTodos(context.repository, scope);
	const todo = todos.find((item) => item.id === target.todoId);
	if (!todo) {
		return;
	}
	todo.completed = !todo.completed;
	todo.updatedAt = new Date().toISOString();
	await persistTodos(context.repository, scope, todos);
	if (todo.completed) {
		context.autoDelete.schedule(context, scope, todo.id, readConfig());
	} else {
		context.autoDelete.cancel(scope, todo.id);
	}
	const stateMessage = todo.completed
		? l10n.t('command.complete.completed', 'Marked TODO as completed')
		: l10n.t('command.complete.reopened', 'Marked TODO as active');
	vscode.window.setStatusBarMessage(stateMessage, 2000);
	broadcastState();
}

/**
 * Removes a selected todo with undo support.
 *
 * @param context - Handler context with repository and auto-delete coordinator.
 * @param broadcastState - Callback to sync webview state.
 */
async function removeTodo(
	context: HandlerContext,
	broadcastState: () => void
): Promise<void> {
	const target = await resolveTodoTarget(context);
	if (!target) {
		return;
	}
	const scope = todoTargetToScopeTarget(target);
	if (!scope) {
		return;
	}
	await removeTodoWithUndoService(context, scope, target.todoId, broadcastState);
}

/**
 * Clears all todos for a chosen scope, honoring confirmation settings.
 *
 * @param context - Handler context with repository and auto-delete coordinator.
 * @param broadcastState - Callback to sync webview state.
 */
async function clearTodos(context: HandlerContext, broadcastState: () => void): Promise<void> {
	const scope = await resolveScopeTarget();
	if (!scope) {
		return;
	}
	await clearScopeService(context, scope, broadcastState);
}

/** Resolves a target scope from a quick pick prompt. */
async function resolveScopeTarget(): Promise<ScopeTarget | undefined> {
	return promptForScope();
}

/** Prompts the user to pick between global and available workspace scopes. */
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

/**
 * Prompts the user to pick a specific todo across scopes to operate on.
 *
 * @param context - Handler context with repository access.
 */
async function resolveTodoTarget(context: HandlerContext): Promise<TodoTarget | undefined> {
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

/**
 * Builds quick-pick items from all todos across scopes.
 *
 * @param repository - Source repository to read todos from.
 * @returns Items for the quick pick UI.
 */
function buildTodoQuickPickItems(
	repository: HandlerContext['repository']
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

/**
 * Reads todos for a given scope.
 *
 * @param repository - Repository to read from.
 * @param scope - Scope target describing global or workspace.
 */
function readTodos(repository: HandlerContext['repository'], scope: ScopeTarget): Todo[] {
	if (scope.scope === 'global') {
		return repository.getGlobalTodos();
	}
	return repository.getWorkspaceTodos(scope.workspaceFolder);
}

/**
 * Persists todos for a target scope, normalizing positions beforehand.
 *
 * @param repository - Repository to save to.
 * @param scope - Scope target describing global or workspace.
 * @param todos - Todos to persist.
 */
async function persistTodos(
	repository: HandlerContext['repository'],
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

/**
 * Maps a todo target to a scope target for downstream repository operations.
 *
 * @param target - Todo target selected by the user.
 * @returns Scope target including workspace folder when required.
 */
function todoTargetToScopeTarget(target: TodoTarget): ScopeTarget | undefined {
	if (target.scope === 'global') {
		return { scope: 'global' };
	}
	if (!target.workspaceFolder) {
		return undefined;
	}
	return { scope: 'workspace', workspaceFolder: target.workspaceFolder };
}

/** Produces a stable string key for a workspace folder. */
function getWorkspaceFolderKey(folder: vscode.WorkspaceFolder): string {
	return folder.uri.toString();
}

/** Focuses the todo container view in the VS Code Activity Bar. */
async function focusTodoContainer(): Promise<void> {
	await vscode.commands.executeCommand('workbench.view.extension.todoContainer');
}

/**
 * Instructs the webview to insert an inline creation row for a scope.
 *
 * @param host - Webview host to deliver the message through.
 * @param scope - Target scope for the inline row.
 */
function dispatchInlineCreate(host: TodoWebviewHost, scope: ScopeTarget): void {
	host.postMessage(scopeToProviderMode(scope), {
		type: 'startInlineCreate',
		scope:
			scope.scope === 'global'
				? { scope: 'global' }
				: { scope: 'workspace', workspaceFolder: scope.workspaceFolder },
	});
}

/**
 * Instructs the webview to enter inline edit mode for a todo.
 *
 * @param host - Webview host to deliver the message through.
 * @param target - Scope-aware todo target to edit.
 */
function dispatchInlineEdit(host: TodoWebviewHost, target: TodoTarget): void {
	const scope = scopeTargetToWebviewScope(target);
	if (!scope) {
		return;
	}
	host.postMessage(target.scope === 'global' ? 'global' : 'projects', {
		type: 'startInlineEdit',
		scope,
		todoId: target.todoId,
	});
}