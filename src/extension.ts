import * as l10n from '@vscode/l10n';
import * as vscode from 'vscode';

import { TodoRepository } from './todoRepository';
import { TodoWebviewHost } from './todoWebviewHost';
import { buildWebviewStateSnapshot, EmptyStateHints, EmptyStateKind } from './webviewState';
import { AutoDeleteCoordinator } from './services/autoDeleteService';
import { HandlerContext } from './types/handlerContext';
import {
	removeTodoWithoutUndo as removeTodoWithoutUndoService,
} from './services/todoOperations';
import { handleWebviewMessage as routeWebviewMessage } from './adapters/webviewRouter';
import { registerCommands } from './adapters/commandRouter';
import { scopeTargetToWebviewScope, scopeToProviderMode } from './adapters/scopeMapping';
import { ScopeTarget } from './types/scope';

/**
 * Activation entry point: initializes localization, repositories, webviews, and commands.
 *
 * @param context - VS Code extension context for this activation.
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
				() =>
					broadcastWebviewState(
						handlerContext.webviewHost,
						handlerContext.repository,
						buildScopeHint(scope, 'afterCompletion')
					)
			),
		sendCue: (scope, todoId, durationMs) => {
			const webviewScope = scopeTargetToWebviewScope(scope);
			if (webviewScope) {
				webviewHost.postMessage(scopeToProviderMode(scope), {
					type: 'autoDeleteCue',
					scope: webviewScope,
					todoId,
					durationMs,
				});
			}
		},
	});
	const handlerContext: HandlerContext = { repository, webviewHost, autoDelete };
	const webviewMessageDisposable = webviewHost.onDidReceiveMessage((event) =>
		routeWebviewMessage(event, handlerContext)
	);

	context.subscriptions.push(webviewHost, webviewMessageDisposable, autoDelete);

	registerCommands({
		context,
		handlerContext,
		broadcastState: () => broadcastWebviewState(webviewHost, repository),
	});
	broadcastWebviewState(webviewHost, repository, buildInitEmptyStateHints());

	console.log(l10n.t('extension.activatedLog', 'vscode-todolist extension activated.'));
}

/** Clean-up hook triggered when the extension is deactivated by VS Code. */
export function deactivate(): void {
	// Nothing to clean up yet.
}

/**
 * Broadcasts the latest view state to any attached webviews so both panes stay in sync.
 *
 * @param host - Webview host that manages both providers.
 * @param repository - Todo repository to read data from.
 */
function broadcastWebviewState(
	host: TodoWebviewHost,
	repository: TodoRepository,
	emptyStateHints: EmptyStateHints = {}
): void {
	const snapshot = buildWebviewStateSnapshot(repository, emptyStateHints);
	host.broadcast({ type: 'stateUpdate', payload: snapshot });
}

function buildInitEmptyStateHints(): EmptyStateHints {
	const workspaces: Record<string, EmptyStateKind> = {};
	(vscode.workspace.workspaceFolders ?? []).forEach((folder) => {
		workspaces[folder.uri.toString()] = 'onInit';
	});
	return { global: 'onInit', workspaces };
}

function buildScopeHint(scope: ScopeTarget, kind: EmptyStateKind): EmptyStateHints {
	if (scope.scope === 'global') {
		return { global: kind };
	}
	return { workspaces: { [scope.workspaceFolder]: kind } };
}

/** Legacy export used by tests; prefer importing the router directly instead. */
export const handleWebviewMessage = routeWebviewMessage;
