import * as l10n from '@vscode/l10n';
import * as vscode from 'vscode';

import { HandlerContext } from '../types/handlerContext';
import { ScopeTarget } from '../types/scope';
import { Todo } from '../types';

export const UNDO_SNAPSHOT_TTL_MS = 10_000;

export async function clearScope(
	context: HandlerContext,
	scope: ScopeTarget,
	broadcastState: () => void
): Promise<void> {
	const todos = readTodos(context.repository, scope);
	if (todos.length === 0) {
		vscode.window.showInformationMessage(
			l10n.t('command.clear.empty', describeScope(scope))
		);
		return;
	}
	context.autoDelete.cancelScope(scope, todos);
	const confirmSetting = vscode.workspace
		.getConfiguration('todo')
		.get<boolean>('confirmDestructiveActions', true);
	if (confirmSetting && todos.length > 1) {
		const confirmAction = l10n.t('command.clear.confirmAction', 'Clear');
		const title = l10n.t('command.clear.confirmTitle', describeScope(scope));
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
	broadcastState();
	const undoAction = l10n.t('command.undo', 'Undo');
	const clearedMessage = l10n.t('command.clear.success', describeScope(scope));
	const undoSelection = await vscode.window.showInformationMessage(
		clearedMessage,
		undoAction
	);
	if (undoSelection === undoAction) {
		const snapshot = context.repository.consumeSnapshot(scopeKey);
		if (snapshot) {
			await persistTodos(context.repository, scope, snapshot);
			vscode.window.showInformationMessage(
				l10n.t('command.undo.success', describeScope(scope))
			);
			broadcastState();
		}
	} else {
		setTimeout(() => context.repository.consumeSnapshot(scopeKey), UNDO_SNAPSHOT_TTL_MS);
	}
}

export async function removeTodoWithUndo(
	context: HandlerContext,
	scope: ScopeTarget,
	todoId: string,
	broadcastState: () => void
): Promise<boolean> {
	const todos = readTodos(context.repository, scope);
	const todo = todos.find((item) => item.id === todoId);
	if (!todo) {
		return false;
	}
	context.autoDelete.cancel(scope, todoId);
	const scopeKey = context.repository.scopeKey(
		scope.scope,
		scope.scope === 'workspace' ? scope.workspaceFolder : undefined
	);
	context.repository.captureSnapshot(scopeKey, todos);

	const next = todos.filter((item) => item.id !== todoId);
	await persistTodos(context.repository, scope, next);
	broadcastState();

	const undoAction = l10n.t('command.undo', 'Undo');
	const removedMessage = l10n.t('command.remove.success', todo.title, describeScope(scope));
	const undoSelection = await vscode.window.showInformationMessage(removedMessage, undoAction);
	if (undoSelection === undoAction) {
		const snapshot = context.repository.consumeSnapshot(scopeKey);
		if (snapshot) {
			await persistTodos(context.repository, scope, snapshot);
			vscode.window.showInformationMessage(
				l10n.t('command.undo.todo.success', todo.title, describeScope(scope))
			);
			broadcastState();
		}
	} else {
		setTimeout(() => context.repository.consumeSnapshot(scopeKey), UNDO_SNAPSHOT_TTL_MS);
	}
	return true;
}

export async function removeTodoWithoutUndo(
	context: HandlerContext,
	scope: ScopeTarget,
	todoId: string,
	broadcastState: () => void
): Promise<boolean> {
	const todos = readTodos(context.repository, scope);
	const next = todos.filter((item) => item.id !== todoId);
	if (next.length === todos.length) {
		return false;
	}
	await persistTodos(context.repository, scope, next);
	broadcastState();
	return true;
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
	const normalized = [...todos]
		.sort((a, b) => a.position - b.position)
		.map((todo, index) => ({ ...todo, position: index + 1 }));
	if (scope.scope === 'global') {
		await repository.saveGlobalTodos(normalized);
	} else {
		await repository.saveWorkspaceTodos(scope.workspaceFolder, normalized);
	}
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
