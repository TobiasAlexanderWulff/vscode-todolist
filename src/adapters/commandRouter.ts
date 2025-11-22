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

interface CommandDependencies {
	context: vscode.ExtensionContext;
	handlerContext: HandlerContext;
	broadcastState: () => void;
}

export function registerCommands({
	context,
	handlerContext,
	broadcastState,
}: CommandDependencies): void {
	context.subscriptions.push(
		vscode.commands.registerCommand('todo.addTodo', () => addTodo(handlerContext, broadcastState)),
		vscode.commands.registerCommand('todo.editTodo', () => editTodo(handlerContext, broadcastState)),
		vscode.commands.registerCommand('todo.completeTodo', () =>
			toggleTodoCompletion(handlerContext, broadcastState)
		),
		vscode.commands.registerCommand('todo.removeTodo', () => removeTodo(handlerContext, broadcastState)),
		vscode.commands.registerCommand('todo.clearTodos', () => clearTodos(handlerContext, broadcastState))
	);
}

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

async function clearTodos(context: HandlerContext, broadcastState: () => void): Promise<void> {
	const scope = await resolveScopeTarget();
	if (!scope) {
		return;
	}
	await clearScopeService(context, scope, broadcastState);
}

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

function readTodos(repository: HandlerContext['repository'], scope: ScopeTarget): Todo[] {
	if (scope.scope === 'global') {
		return repository.getGlobalTodos();
	}
	return repository.getWorkspaceTodos(scope.workspaceFolder);
}

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

function todoTargetToScopeTarget(target: TodoTarget): ScopeTarget | undefined {
	if (target.scope === 'global') {
		return { scope: 'global' };
	}
	if (!target.workspaceFolder) {
		return undefined;
	}
	return { scope: 'workspace', workspaceFolder: target.workspaceFolder };
}

function getWorkspaceFolderKey(folder: vscode.WorkspaceFolder): string {
	return folder.uri.toString();
}

async function focusTodoContainer(): Promise<void> {
	await vscode.commands.executeCommand('workbench.view.extension.todoContainer');
}

function dispatchInlineCreate(host: TodoWebviewHost, scope: ScopeTarget): void {
	host.postMessage(scopeToProviderMode(scope), {
		type: 'startInlineCreate',
		scope: scope.scope === 'global' ? { scope: 'global' } : { scope: 'workspace', workspaceFolder: scope.workspaceFolder },
	});
}

function dispatchInlineEdit(host: TodoWebviewHost, target: TodoTarget): void {
	const scope = todoTargetToWebviewScope(target);
	if (!scope) {
		return;
	}
	host.postMessage(target.scope === 'global' ? 'global' : 'projects', {
		type: 'startInlineEdit',
		scope,
		todoId: target.todoId,
	});
}

function todoTargetToWebviewScope(target: TodoTarget) {
	if (target.scope === 'global') {
		return { scope: 'global' as const };
	}
	if (!target.workspaceFolder) {
		return undefined;
	}
	return { scope: 'workspace' as const, workspaceFolder: target.workspaceFolder };
}

function scopeToProviderMode(scope: ScopeTarget): 'global' | 'projects' {
	return scope.scope === 'global' ? 'global' : 'projects';
}
