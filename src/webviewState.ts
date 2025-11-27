import * as l10n from '@vscode/l10n';
import * as vscode from 'vscode';

import { TodoRepository } from './todoRepository';
import { Todo } from './types';

/** Serialized snapshot the webview consumes to render both scopes. */
export interface WebviewStateSnapshot {
	generatedAt: string;
	global: WebviewScopeState;
	projects: WebviewProjectsState;
	strings: WebviewStrings;
}

/** Representation of a single scope section within the webview UI. */
export interface WebviewScopeState {
	label: string;
	emptyLabel: string;
	todos: WebviewTodoState[];
}

/** Container of all project/workspace sections. */
export interface WebviewProjectsState {
	label: string;
	emptyLabel: string;
	folders: WebviewWorkspaceState[];
}

/** State for a single workspace folder pane. */
export interface WebviewWorkspaceState {
	key: string;
	label: string;
	description?: string;
	emptyLabel: string;
	todos: WebviewTodoState[];
}

/** Minimal todo shape consumed by the webview runtime. */
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

/** Bundle of localized strings used in the UI. */
export interface WebviewStrings {
	addPlaceholder: string;
	inlineCreateHint: string;
	completeLabel: string;
	copyLabel: string;
	removeLabel: string;
	addLabel: string;
	clearLabel: string;
}

/** Context that influences which empty-state copy should be used. */
export type EmptyStateKind = 'general' | 'onInit' | 'afterCompletion';

/** Optional hints to select an empty-state context per scope. */
export interface EmptyStateHints {
	global?: EmptyStateKind;
	workspaces?: Record<string, EmptyStateKind>;
}

/**
 * Collects localized strings and todos per scope so the webviews can render without touching VS
 * Code APIs directly. Sorting happens here to centralize ordering concerns.
 *
 * @param repository - Todo repository supplying data for both scopes.
 * @param emptyStateHints - Optional hints to choose empty-state copy per scope.
 * @returns A snapshot ready to send to the webview.
 */
export function buildWebviewStateSnapshot(
	repository: TodoRepository,
	emptyStateHints: EmptyStateHints = {}
): WebviewStateSnapshot {
	const defaultGlobalEmpty = l10n.t('webview.global.empty', 'No global TODOs yet');
	const defaultWorkspaceEmpty = l10n.t('webview.projects.empty', 'No project TODOs yet');

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
		const emptyKind = emptyStateHints.workspaces?.[folderKey] ?? 'general';
		return {
			key: folderKey,
			label: folder.name,
			description: folder.uri.fsPath,
			emptyLabel: pickEmptyLabel('workspace', emptyKind, defaultWorkspaceEmpty),
			todos,
		};
	});

	const globalEmptyKind = emptyStateHints.global ?? 'general';

	return {
		generatedAt: new Date().toISOString(),
		global: {
			label: l10n.t('scope.global.label', 'Global'),
			emptyLabel: pickEmptyLabel('global', globalEmptyKind, defaultGlobalEmpty),
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
			copyLabel: l10n.t('webview.todo.copy', 'Copy to clipboard'),
			removeLabel: l10n.t('command.todo.removeTodo.title', 'Remove TODO'),
			addLabel: l10n.t('webview.section.add', 'Add'),
			clearLabel: l10n.t('webview.section.clear', 'Clear'),
		},
	};
}

/**
 * Normalizes a repository todo into the slim shape consumed by the webview runtime.
 *
 * @param todo - Todo entity persisted in the repository.
 * @returns Minimal webview-facing todo state.
 */
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

function pickEmptyLabel(
	scope: 'global' | 'workspace',
	kind: EmptyStateKind,
	fallback: string
): string {
	const pools = emptyMessagePools(scope);
	const candidates = pools[kind] ?? [];
	const pool = candidates.length > 0 ? candidates : pools.general ?? [];
	if (pool.length === 0) {
		return fallback;
	}
	const index = Math.floor(Math.random() * pool.length);
	return pool[index] ?? fallback;
}

function emptyMessagePools(
	scope: 'global' | 'workspace'
): Record<EmptyStateKind, string[]> {
	if (scope === 'global') {
		return {
			general: [
				l10n.t('webview.global.empty', 'No global TODOs yet'),
				l10n.t(
					'webview.global.emptyMessages.general.calm',
					'Your global list is clear—enjoy the calm.'
				),
				l10n.t(
					'webview.global.emptyMessages.general.capture',
					'Global list is clean—perfect time to capture a thought.'
				),
				l10n.t(
					'webview.global.emptyMessages.general.cruise',
					'No global todos right now. Keep cruising.'
				),
			],
			onInit: [
				l10n.t(
					'webview.global.emptyMessages.onInit.follow',
					'No global todos. Add something that follows you everywhere.'
				),
				l10n.t(
					'webview.global.emptyMessages.onInit.travel',
					'Start a global todo that travels with you.'
				),
				l10n.t(
					'webview.global.emptyMessages.onInit.everywhere',
					'Nothing global yet—add something you’ll need everywhere.'
				),
			],
			afterCompletion: [
				l10n.t(
					'webview.global.emptyMessages.afterCompletion.coffee',
					'All done! Time for a coffee ☕'
				),
				l10n.t(
					'webview.global.emptyMessages.afterCompletion.win',
					'Crushed it. Add the next win.'
				),
				l10n.t(
					'webview.global.emptyMessages.afterCompletion.treat',
					'Global queue is clear. Treat yourself.'
				),
			],
		};
	}
	return {
		general: [
			l10n.t('webview.projects.empty', 'No project TODOs yet'),
			l10n.t(
				'webview.projects.emptyMessages.general.inbox',
				'Project inbox is empty. Add the next task for this folder.'
			),
			l10n.t(
				'webview.projects.emptyMessages.general.lineUp',
				'Project list is calm—line up the next task.'
			),
			l10n.t(
				'webview.projects.emptyMessages.general.shipping',
				'No project todos right now. Keep shipping.'
			),
		],
		onInit: [
			l10n.t(
				'webview.projects.emptyMessages.onInit.first',
				'Nothing here yet—drop your first project todo.'
			),
			l10n.t(
				'webview.projects.emptyMessages.onInit.setFirst',
				'Set the first task for this folder.'
			),
			l10n.t(
				'webview.projects.emptyMessages.onInit.kickoff',
				'Kick off the project with a todo.'
			),
		],
		afterCompletion: [
			l10n.t(
				'webview.projects.emptyMessages.afterCompletion.ship',
				'All project todos done. Celebrate and ship!'
			),
			l10n.t(
				'webview.projects.emptyMessages.afterCompletion.highFive',
				'All project tasks done. High five.'
			),
			l10n.t(
				'webview.projects.emptyMessages.afterCompletion.deploy',
				'Board is empty—deploy and celebrate.'
			),
		],
	};
}
