import { AutoDeleteCoordinator } from '../services/autoDeleteService';
import { TodoRepository } from '../todoRepository';
import { TodoWebviewHost } from '../todoWebviewHost';

/**
 * Shared dependencies injected into command and webview handlers to avoid direct VS Code access
 * in lower layers.
 */
export interface HandlerContext {
	/** Repository wrapper for persisted todos. */
	repository: TodoRepository;
	/** Host that bridges extension-side events to the webview panes. */
	webviewHost: TodoWebviewHost;
	/** Coordinator that manages auto-delete timers and cue callbacks. */
	autoDelete: AutoDeleteCoordinator<HandlerContext>;
	/** Optional clipboard writer used for tests or host integration. */
	clipboardWriteText?: (value: string) => Thenable<void>;
}
