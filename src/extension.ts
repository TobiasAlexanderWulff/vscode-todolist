import * as l10n from '@vscode/l10n';
import * as vscode from 'vscode';

import { TodoRepository } from './todoRepository';
import { Todo } from './types';
import {
	OutboundMessage,
	TodoWebviewHost,
	WebviewScope,
	ProviderMode,
	WebviewMessageEvent,
} from './todoWebviewHost';
import { buildWebviewStateSnapshot } from './webviewState';
import { normalizePositions, reorderTodosByOrder } from './domain/todo';
import { ScopeTarget, TodoTarget } from './types/scope';
import { AutoDeleteCoordinator } from './services/autoDeleteService';
import { HandlerContext } from './types/handlerContext';
import {
	clearScope as clearScopeService,
	removeTodoWithUndo as removeTodoWithUndoService,
	removeTodoWithoutUndo as removeTodoWithoutUndoService,
} from './services/todoOperations';

type HandlerAutoDelete = AutoDeleteCoordinator<HandlerContext>;

/**
 * Activation entry point: initializes localization, repositories, webviews, and commands.
 */
export async function activate(context: vscode.ExtensionContext): Promise<void> {
	await l10n.config({ fsPath: context.asAbsolutePath('l10n/bundle.l10n.json') });

	const repository = new TodoRepository(context);
	const webviewHost = new TodoWebviewHost(context);
	const autoDelete = new AutoDeleteCoordinator<HandlerContext>({
		removeTodo: (handlerContext, scope, todoId) =>
			removeTodoWithoutUndoService(
				handlerContext,
				scope,
				todoId,
				() => broadcastWebviewState(handlerContext.webviewHost, handlerContext.repository)
			),
		sendCue: (scope, todoId, durationMs) => {
			webviewHost.postMessage(scopeToProviderMode(scope), {
				type: 'autoDeleteCue',
				scope: scopeTargetToWebviewScope(scope),
				todoId,
				durationMs,
			});
		},
	});
	const webviewMessageDisposable = webviewHost.onDidReceiveMessage((event) =>
		handleWebviewMessage(event, repository, webviewHost, autoDelete)
	);

	context.subscriptions.push(webviewHost, webviewMessageDisposable, autoDelete);

	registerCommands({
		context,
		repository,
		webviewHost,
		autoDelete,
	});
	broadcastWebviewState(webviewHost, repository);

	console.log(l10n.t('extension.activatedLog', 'vscode-todolist extension activated.'));
}

export function deactivate(): void {
	// Nothing to clean up yet.
}

interface CommandContext {
	context: vscode.ExtensionContext;
	repository: TodoRepository;
	webviewHost: TodoWebviewHost;
	autoDelete: HandlerAutoDelete;
}

/**
 * Registers all extension commands so they can be invoked via palette, keybindings, or UI buttons.
 */
function registerCommands({ context, repository, webviewHost, autoDelete }: CommandContext): void {
	const handlerContext: HandlerContext = { repository, webviewHost, autoDelete };
	context.subscriptions.push(
		vscode.commands.registerCommand('todo.addTodo', () => addTodo(handlerContext)),
		vscode.commands.registerCommand('todo.editTodo', () => editTodo(handlerContext)),
		vscode.commands.registerCommand('todo.completeTodo', () => toggleTodoCompletion(handlerContext)),
		vscode.commands.registerCommand('todo.removeTodo', () => removeTodo(handlerContext)),
		vscode.commands.registerCommand('todo.clearTodos', () => clearTodos(handlerContext))
	);
}

/**
 * Focuses the TODO container and triggers inline creation in the webview for a chosen scope.
 */
export async function addTodo(context: HandlerContext): Promise<void> {
	const scope = await resolveScopeTarget();
	if (!scope) {
		return;
	}
	await focusTodoContainer();
	broadcastWebviewState(context.webviewHost, context.repository);
	dispatchInlineCreate(context.webviewHost, scope);
}

/**
 * Focuses the TODO container and triggers inline edit for a selected todo in the webview.
 */
export async function editTodo(context: HandlerContext): Promise<void> {
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
	broadcastWebviewState(context.webviewHost, context.repository);
	dispatchInlineEdit(context.webviewHost, target);
}

/**
 * Toggles completion of the chosen todo, persists it, and shows a brief status bar confirmation.
 */
async function toggleTodoCompletion(context: HandlerContext): Promise<void> {
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
		context.autoDelete.schedule(context, scope, todo.id);
	} else {
		context.autoDelete.cancel(scope, todo.id);
	}
	const stateMessage = todo.completed
		? l10n.t('command.complete.completed', 'Marked TODO as completed')
		: l10n.t('command.complete.reopened', 'Marked TODO as active');
	vscode.window.setStatusBarMessage(stateMessage, 2000);
	broadcastWebviewState(context.webviewHost, context.repository);
}

async function removeTodo(context: HandlerContext): Promise<void> {
	const target = await resolveTodoTarget(context);
	if (!target) {
		return;
	}
	const scope = todoTargetToScopeTarget(target);
	if (!scope) {
		return;
	}
	await removeTodoWithUndoService(
		context,
		scope,
		target.todoId,
		() => broadcastWebviewState(context.webviewHost, context.repository)
	);
}

/**
 * Clears todos for the selected scope, deferring to scope picking when necessary.
 */
async function clearTodos(context: HandlerContext): Promise<void> {
	const scope = await resolveScopeTarget();
	if (!scope) {
		return;
	}
	await clearScopeService(
		context,
		scope,
		() => broadcastWebviewState(context.webviewHost, context.repository)
	);
}

/**
 * Clears todos for a scope with confirmations and an undo grace period backed by snapshots.
 */
async function resolveScopeTarget(): Promise<ScopeTarget | undefined> {
	return promptForScope();
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

function getWorkspaceFolderKey(folder: vscode.WorkspaceFolder): string {
	return folder.uri.toString();
}

function dispatchInlineCreate(host: TodoWebviewHost, scope: ScopeTarget): void {
	const message = {
		type: 'startInlineCreate',
		scope: scopeTargetToWebviewScope(scope),
	} as OutboundMessage;
	host.postMessage(scopeToProviderMode(scope), message);
}

function dispatchInlineEdit(host: TodoWebviewHost, target: TodoTarget): void {
	const scope = todoTargetToWebviewScope(target);
	if (!scope) {
		return;
	}
	const message = {
		type: 'startInlineEdit',
		scope,
		todoId: target.todoId,
	} as OutboundMessage;
	host.postMessage(target.scope === 'global' ? 'global' : 'projects', message);
}

function scopeTargetToWebviewScope(scope: ScopeTarget): WebviewScope {
	if (scope.scope === 'global') {
		return { scope: 'global' };
	}
	return { scope: 'workspace', workspaceFolder: scope.workspaceFolder };
}

function todoTargetToWebviewScope(target: TodoTarget): WebviewScope | undefined {
	if (target.scope === 'global') {
		return { scope: 'global' };
	}
	if (!target.workspaceFolder) {
		return undefined;
	}
	return { scope: 'workspace', workspaceFolder: target.workspaceFolder };
}

function todoTargetToScopeTarget(target: TodoTarget): ScopeTarget | undefined {
	if (target.scope === 'global') {
		return { scope: 'global' };
	}
	if (!target.workspaceFolder) {
		return undefined;
	}
	return { scope: 'workspace', workspaceFolder: target.workspaceFolder };
}

function scopeToProviderMode(scope: ScopeTarget): ProviderMode {
	return scope.scope === 'global' ? 'global' : 'projects';
}

async function focusTodoContainer(): Promise<void> {
	await vscode.commands.executeCommand('workbench.view.extension.todoContainer');
}

/**
 * Broadcasts the latest view state to any attached webviews so both panes stay in sync.
 */
function broadcastWebviewState(host: TodoWebviewHost, repository: TodoRepository): void {
	const snapshot = buildWebviewStateSnapshot(repository);
	host.broadcast({ type: 'stateUpdate', payload: snapshot });
}

function scopeFromWebviewScope(scope: WebviewScope): ScopeTarget | undefined {
	if (scope.scope === 'global') {
		return { scope: 'global' };
	}
	if (!scope.workspaceFolder) {
		return undefined;
	}
	return { scope: 'workspace', workspaceFolder: scope.workspaceFolder };
}

/**
 * Reorders todos in place based on IDs received from the webview, filling gaps by keeping any
 * unmapped items at the end. Returns whether positions actually changed.
 */
/**
 * Routes inbound webview messages, performing mutations and broadcasting updated state.
 */
export async function handleWebviewMessage(
	event: WebviewMessageEvent,
	repository: TodoRepository,
	webviewHost: TodoWebviewHost,
	autoDelete: HandlerAutoDelete
): Promise<void> {
	const { message } = event;
	const handlerContext: HandlerContext = { repository, webviewHost, autoDelete };
	if (message.type === 'webviewReady') {
		broadcastWebviewState(webviewHost, repository);
		return;
	}
	if (message.type === 'clearScope') {
		const scope = scopeFromWebviewScope(message.scope);
		if (!scope) {
			return;
		}
		await clearScopeService(
			handlerContext,
			scope,
			() => broadcastWebviewState(webviewHost, repository)
		);
		return;
	}
	const mutationResult = await handleWebviewMutation(message, handlerContext);
	if (!mutationResult.mutated) {
		return;
	}
	if (!mutationResult.broadcastHandled) {
		broadcastWebviewState(webviewHost, repository);
	}
}

interface MutationResult {
	mutated: boolean;
	broadcastHandled?: boolean;
}

async function handleWebviewMutation(
	message: WebviewMessageEvent['message'],
	context: HandlerContext
): Promise<MutationResult> {
	// Return mutation details so callers can decide whether to broadcast state.
	switch (message.type) {
		case 'commitCreate':
			return {
				mutated: await handleWebviewCreate(context.repository, message.scope, message.title),
			};
		case 'commitEdit':
			return {
				mutated: await handleWebviewEdit(
					context.repository,
					message.scope,
					message.todoId,
					message.title
				),
			};
		case 'toggleComplete':
			return {
				mutated: await handleWebviewToggle(context, message.scope, message.todoId),
			};
		case 'removeTodo':
			return handleWebviewRemoveWithUndo(context, message.scope, message.todoId);
		case 'reorderTodos':
			return {
				mutated: await handleWebviewReorder(
					context.repository,
					message.scope,
					message.order
				),
			};
		default:
			return { mutated: false };
	}
}

async function handleWebviewCreate(
	repository: TodoRepository,
	scope: WebviewScope,
	title: string
): Promise<boolean> {
	const target = scopeFromWebviewScope(scope);
	const trimmed = title.trim();
	if (!target || trimmed.length === 0) {
		return false;
	}
	const todo = repository.createTodo({
		title: trimmed,
		scope: target.scope,
		workspaceFolder: target.scope === 'workspace' ? target.workspaceFolder : undefined,
	});
	const todos = readTodos(repository, target);
	todos.push(todo);
	await persistTodos(repository, target, todos);
	return true;
}

async function handleWebviewEdit(
	repository: TodoRepository,
	scope: WebviewScope,
	todoId: string,
	title: string
): Promise<boolean> {
	const target = scopeFromWebviewScope(scope);
	if (!target) {
		return false;
	}
	const trimmed = title.trim();
	if (trimmed.length === 0) {
		return false;
	}
	const todos = readTodos(repository, target);
	const todo = todos.find((item) => item.id === todoId);
	if (!todo) {
		return false;
	}
	todo.title = trimmed;
	todo.updatedAt = new Date().toISOString();
	await persistTodos(repository, target, todos);
	return true;
}

async function handleWebviewToggle(
	context: HandlerContext,
	scope: WebviewScope,
	todoId: string
): Promise<boolean> {
	const target = scopeFromWebviewScope(scope);
	if (!target) {
		return false;
	}
	const todos = readTodos(context.repository, target);
	const todo = todos.find((item) => item.id === todoId);
	if (!todo) {
		return false;
	}
	todo.completed = !todo.completed;
	todo.updatedAt = new Date().toISOString();
	await persistTodos(context.repository, target, todos);
	if (todo.completed) {
		context.autoDelete.schedule(context, target, todo.id);
	} else {
		context.autoDelete.cancel(target, todo.id);
	}
	return true;
}

async function handleWebviewRemoveWithUndo(
	context: HandlerContext,
	scope: WebviewScope,
	todoId: string
): Promise<MutationResult> {
	const target = scopeFromWebviewScope(scope);
	if (!target) {
		return { mutated: false };
	}
	const removed = await removeTodoWithUndoService(
		context,
		target,
		todoId,
		() => broadcastWebviewState(context.webviewHost, context.repository)
	);
	return { mutated: removed, broadcastHandled: removed };
}

async function handleWebviewReorder(
	repository: TodoRepository,
	scope: WebviewScope,
	order: string[]
): Promise<boolean> {
	const target = scopeFromWebviewScope(scope);
	if (!target) {
		return false;
	}
	const todos = readTodos(repository, target);
	if (todos.length <= 1) {
		return false;
	}
	const reordered = reorderTodosByOrder(todos, order);
	if (!reordered) {
		return false;
	}
	await persistTodos(repository, target, todos);
	return true;
}
