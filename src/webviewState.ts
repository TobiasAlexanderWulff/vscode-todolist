import * as l10n from '@vscode/l10n';
import * as vscode from 'vscode';

import { TodoRepository } from './todoRepository';
import { Todo } from './types';

export interface WebviewStateSnapshot {
	generatedAt: string;
	global: WebviewScopeState;
	projects: WebviewProjectsState;
	strings: WebviewStrings;
}

export interface WebviewScopeState {
	label: string;
	emptyLabel: string;
	todos: WebviewTodoState[];
}

export interface WebviewProjectsState {
	label: string;
	emptyLabel: string;
	folders: WebviewWorkspaceState[];
}

export interface WebviewWorkspaceState {
	key: string;
	label: string;
	description?: string;
	todos: WebviewTodoState[];
}

export interface WebviewTodoState {
	id: string;
	title: string;
	completed: boolean;
	position: number;
	scope: 'global' | 'workspace';
	workspaceFolder?: string;
	createdAt: string;
	updatedAt: string;
}

export interface WebviewStrings {
	addPlaceholder: string;
	inlineCreateHint: string;
	completeLabel: string;
	removeLabel: string;
	todoCountSingular: string;
	todoCountPlural: string;
	projectCountSingular: string;
	projectCountPlural: string;
}

/**
 * Collects localized strings and todos per scope so the webviews can render without touching VS
 * Code APIs directly. Sorting happens here to centralize ordering concerns.
 */
export function buildWebviewStateSnapshot(repository: TodoRepository): WebviewStateSnapshot {
	const globalTodos = repository
		.getGlobalTodos()
		.sort((a, b) => a.position - b.position)
		.map((todo) => toTodoState(todo));

	const workspaceFolders = (vscode.workspace.workspaceFolders ?? []).map((folder) => {
		const folderKey = folder.uri.toString();
		const todos = repository
			.getWorkspaceTodos(folderKey)
			.sort((a, b) => a.position - b.position)
			.map((todo) => toTodoState(todo));
		return {
			key: folderKey,
			label: folder.name,
			description: folder.uri.fsPath,
			todos,
		};
	});

	return {
		generatedAt: new Date().toISOString(),
		global: {
			label: l10n.t('scope.global.label', 'Global'),
			emptyLabel: l10n.t('webview.global.empty', 'No global TODOs yet'),
			todos: globalTodos,
		},
		projects: {
			label: l10n.t('view.todoProjects.label', 'Projects'),
			emptyLabel: l10n.t('webview.projects.empty', 'No project TODOs yet'),
			folders: workspaceFolders,
		},
		strings: {
			addPlaceholder: l10n.t('command.add.placeholder', 'Type a TODO'),
			inlineCreateHint: l10n.t(
				'webview.inlineCreate.hint',
				'Type and press Enter to save, Esc to cancel.'
			),
			completeLabel: l10n.t('command.todo.completeTodo.title', 'Complete TODO'),
			removeLabel: l10n.t('command.todo.removeTodo.title', 'Remove TODO'),
			todoCountSingular: l10n.t('webview.count.todo.singular', '{0} TODO'),
			todoCountPlural: l10n.t('webview.count.todo.plural', '{0} TODOs'),
			projectCountSingular: l10n.t('webview.count.project.singular', '{0} folder'),
			projectCountPlural: l10n.t('webview.count.project.plural', '{0} folders'),
		},
	};
}

/** Normalizes a repository todo into the slim shape consumed by the webview runtime. */
function toTodoState(todo: Todo): WebviewTodoState {
	return {
		id: todo.id,
		title: todo.title,
		completed: todo.completed,
		position: todo.position,
		scope: todo.scope,
		workspaceFolder: todo.workspaceFolder,
		createdAt: todo.createdAt,
		updatedAt: todo.updatedAt,
	};
}
