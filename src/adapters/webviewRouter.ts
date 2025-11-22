import { HandlerContext } from '../types/handlerContext';
import { ScopeTarget } from '../types/scope';
import { TodoRepository } from '../todoRepository';
import { TodoWebviewHost, ProviderMode } from '../todoWebviewHost';
import { normalizePositions, reorderTodosByOrder } from '../domain/todo';
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

interface MutationResult {
	mutated: boolean;
	broadcastHandled?: boolean;
}

export async function handleWebviewMessage(
	event: { mode: ProviderMode; message: InboundMessage },
	context: HandlerContext
): Promise<void> {
	const { message } = event;
	const { repository, webviewHost } = context;
	const handlerContext: HandlerContext = context;
	if (message.type === 'webviewReady') {
		broadcastWebviewState(webviewHost, repository);
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
		context.autoDelete.schedule(context, target, todo.id, readConfig());
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

function broadcastWebviewState(host: TodoWebviewHost, repository: TodoRepository): void {
	// Lazy import to avoid circular dep on extension.ts
	const { buildWebviewStateSnapshot } = require('../webviewState') as typeof import('../webviewState');
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
