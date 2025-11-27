import * as vscode from 'vscode';
import * as l10n from '@vscode/l10n';

import { HandlerContext } from '../types/handlerContext';
import { ScopeTarget } from '../types/scope';
import { TodoRepository } from '../todoRepository';
import { TodoWebviewHost, ProviderMode } from '../todoWebviewHost';
import { reorderTodosByOrder } from '../domain/todo';
import {
	clearScope as clearScopeService,
	removeTodoWithUndo as removeTodoWithUndoService,
} from '../services/todoOperations';
import { Todo } from '../types';
import { readConfig } from './config';
import {
	InboundMessage,
	WebviewMessageEvent,
	WebviewScope,
} from '../types/webviewMessages';
import type { EmptyStateHints } from '../webviewState';

/** Result of processing a webview mutation message. */
interface MutationResult {
	mutated: boolean;
	broadcastHandled?: boolean;
}

/**
 * Routes incoming webview messages to repository operations and broadcasts state updates.
 *
 * @param event - Message event from a specific webview provider.
 * @param context - Handler context containing repository and coordination utilities.
 */
export async function handleWebviewMessage(
	event: { mode: ProviderMode; message: InboundMessage },
	context: HandlerContext
): Promise<void> {
	const { message } = event;
	const { repository, webviewHost } = context;
	const handlerContext: HandlerContext = context;
	if (message.type === 'webviewReady') {
		broadcastWebviewState(webviewHost, repository, buildInitEmptyStateHints());
		return;
	}
	if (message.type === 'clearScope') {
		const scope = scopeFromWebviewScope(message.scope);
		if (!scope) {
			return;
		}
		await clearScopeService(handlerContext, scope, () =>
			broadcastWebviewState(webviewHost, repository)
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

/**
 * Executes a mutation based on the inbound webview message.
 *
 * @param message - Message from the webview runtime.
 * @param context - Handler context for repository access.
 * @returns Whether a mutation occurred and if broadcasting has already happened.
 */
async function handleWebviewMutation(
	message: WebviewMessageEvent['message'],
	context: HandlerContext
): Promise<MutationResult> {
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
		case 'copyTodo':
			await handleWebviewCopy(context, message.scope, message.todoId);
			return { mutated: false, broadcastHandled: true };
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

/**
 * Handles creation of a todo originating from inline webview input.
 *
 * @param repository - Repository to persist the new todo into.
 * @param scope - Scope descriptor from the webview.
 * @param title - Title entered by the user.
 * @returns Whether a mutation occurred.
 */
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

/**
 * Handles inline edit commit from the webview.
 *
 * @param repository - Repository to persist changes into.
 * @param scope - Scope descriptor from the webview.
 * @param todoId - Todo identifier being edited.
 * @param title - Updated title.
 * @returns Whether a mutation occurred.
 */
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
		context.autoDelete.schedule(context, target, todo.id, readConfig());
	} else {
		context.autoDelete.cancel(target, todo.id);
	}
	return true;
}

async function handleWebviewCopy(
	context: HandlerContext,
	scope: WebviewScope,
	todoId: string
): Promise<void> {
	const target = scopeFromWebviewScope(scope);
	if (!target) {
		return;
	}
	const todos = readTodos(context.repository, target);
	const todo = todos.find((item) => item.id === todoId);
	if (!todo) {
		return;
	}
	const writeText = context.clipboardWriteText ?? vscode.env.clipboard.writeText;
	await writeText(todo.title);
	vscode.window.setStatusBarMessage(
		l10n.t('webview.todo.copy.success', 'Copied to clipboard'),
		2000
	);
}

/**
 * Removes a todo initiated from the webview with undo handling.
 *
 * @param context - Handler context with repository and webview host.
 * @param scope - Scope descriptor from the webview.
 * @param todoId - Todo identifier to remove.
 */
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

/**
 * Reorders todos based on drag-and-drop order supplied by the webview.
 *
 * @param repository - Repository to persist ordering into.
 * @param scope - Scope descriptor from the webview.
 * @param order - Ordered todo IDs from the webview DOM.
 * @returns Whether any positions were updated.
 */
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

/**
 * Broadcasts the latest state to both webview providers.
 *
 * @param host - Webview host responsible for dispatch.
 * @param repository - Repository supplying the state snapshot.
 */
function broadcastWebviewState(
	host: TodoWebviewHost,
	repository: TodoRepository,
	emptyStateHints: EmptyStateHints = {}
): void {
	// Lazy import to avoid circular dep on extension.ts
	const webviewStateModule = require('../webviewState') as typeof import('../webviewState');
	const snapshot = webviewStateModule.buildWebviewStateSnapshot(repository, emptyStateHints);
	host.broadcast({ type: 'stateUpdate', payload: snapshot });
}

function buildInitEmptyStateHints(): EmptyStateHints {
	const workspaces: EmptyStateHints['workspaces'] = {};
	(vscode.workspace.workspaceFolders ?? []).forEach((folder) => {
		if (workspaces) {
			workspaces[folder.uri.toString()] = 'onInit';
		}
	});
	return { global: 'onInit', workspaces };
}

/**
 * Converts a webview scope descriptor into the repository scope target.
 *
 * @param scope - Scope descriptor received from the webview.
 * @returns Scope target or undefined when workspace info is missing.
 */
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
 * Reads todos for a scope using the repository helper.
 *
 * @param repository - Repository to query.
 * @param scope - Scope target describing global or workspace storage.
 */
function readTodos(repository: TodoRepository, scope: ScopeTarget): Todo[] {
	return repository.readTodos(scope);
}

/**
 * Persists todos for a scope using the repository helper.
 *
 * @param repository - Repository to write to.
 * @param scope - Scope target describing global or workspace storage.
 * @param todos - Todos to persist.
 */
async function persistTodos(
	repository: TodoRepository,
	scope: ScopeTarget,
	todos: Todo[]
): Promise<void> {
	await repository.persistTodos(scope, todos);
}
