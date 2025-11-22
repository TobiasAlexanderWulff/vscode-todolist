import * as l10n from '@vscode/l10n';
import * as vscode from 'vscode';

import { TodoRepository } from './todoRepository';
import { TodoWebviewHost, ProviderMode } from './todoWebviewHost';
import { buildWebviewStateSnapshot } from './webviewState';
import { ScopeTarget } from './types/scope';
import { AutoDeleteCoordinator } from './services/autoDeleteService';
import { HandlerContext } from './types/handlerContext';
import {
	removeTodoWithoutUndo as removeTodoWithoutUndoService,
} from './services/todoOperations';
import { handleWebviewMessage as routeWebviewMessage } from './adapters/webviewRouter';
import { registerCommands } from './adapters/commandRouter';

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
	broadcastWebviewState(webviewHost, repository);

	console.log(l10n.t('extension.activatedLog', 'vscode-todolist extension activated.'));
}

export function deactivate(): void {
	// Nothing to clean up yet.
}

/**
 * Broadcasts the latest view state to any attached webviews so both panes stay in sync.
 */
function broadcastWebviewState(host: TodoWebviewHost, repository: TodoRepository): void {
	const snapshot = buildWebviewStateSnapshot(repository);
	host.broadcast({ type: 'stateUpdate', payload: snapshot });
}

// legacy export used by tests; consider updating tests to import router directly
export const handleWebviewMessage = routeWebviewMessage;

function scopeTargetToWebviewScope(scope: ScopeTarget) {
	return scope.scope === 'global'
		? { scope: 'global' as const }
		: { scope: 'workspace' as const, workspaceFolder: scope.workspaceFolder };
}

function scopeToProviderMode(scope: ScopeTarget): ProviderMode {
	return scope.scope === 'global' ? 'global' : 'projects';
}
