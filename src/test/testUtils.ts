/** Shared testing utilities and fakes for the todo extension. */

import * as vscode from 'vscode';

import * as config from '../adapters/config';
import { TodoWebviewHost } from '../todoWebviewHost';
import { OutboundMessage } from '../types/webviewMessages';

/** Minimal in-memory stand-in for VS Code's Memento used by the repository during tests. */
export class InMemoryMemento implements vscode.Memento {
	private readonly store = new Map<string, unknown>();
	private syncedKeys: readonly string[] = [];

	get<T>(key: string, defaultValue?: T): T | undefined {
		if (this.store.has(key)) {
			return this.store.get(key) as T;
		}
		return defaultValue;
	}

	update<T>(key: string, value: T): Thenable<void> {
		if (value === undefined) {
			this.store.delete(key);
		} else {
			this.store.set(key, value);
		}
		return Promise.resolve();
	}

	keys(): readonly string[] {
		return Array.from(this.store.keys());
	}

	setKeysForSync(keys: readonly string[]): void {
		this.syncedKeys = keys;
	}
}

const workspaceFoldersDescriptor = Object.getOwnPropertyDescriptor(
	vscode.workspace,
	'workspaceFolders'
);

/** Overrides VS Code workspace folders for the duration of a test. */
export function overrideWorkspaceFolders(folders: readonly vscode.WorkspaceFolder[]): void {
	Object.defineProperty(vscode.workspace, 'workspaceFolders', {
		get: () => folders,
		configurable: true,
	});
}

/** Restores the workspaceFolders descriptor after a test finishes. */
export function restoreWorkspaceFoldersDescriptor(): void {
	if (workspaceFoldersDescriptor) {
		Object.defineProperty(vscode.workspace, 'workspaceFolders', workspaceFoldersDescriptor);
		return;
	}
	Object.defineProperty(vscode.workspace, 'workspaceFolders', { get: () => undefined });
}

/** Temporarily overrides readConfig during a test. Restored by calling the returned disposer. */
export function stubReadConfig(next: config.TodoConfig): () => void {
	const original = config.readConfig;
	(config as unknown as { readConfig: typeof config.readConfig }).readConfig = () => next;
	return () => {
		(config as unknown as { readConfig: typeof config.readConfig }).readConfig = original;
	};
}

/** Lightweight stub of the webview host that records outbound messages for assertions. */
export class FakeWebviewHost implements Pick<TodoWebviewHost, 'postMessage' | 'broadcast'> {
	readonly postMessages: Array<{ mode: string; message: OutboundMessage }> = [];
	readonly broadcastMessages: OutboundMessage[] = [];

	// In tests, we don't need to simulate receiving messages, so we can stub this.
	// The full implementation uses an EventEmitter.
	// get onDidReceiveMessage(): vscode.Event<WebviewMessageEvent> {
	// 	return new vscode.EventEmitter<WebviewMessageEvent>().event;
	// }

	postMessage(mode: string, message: OutboundMessage): void {
		this.postMessages.push({ mode, message });
	}

	broadcast(message: OutboundMessage): void {
		this.broadcastMessages.push(message);
	}
}

/** No-op broadcaster to pass into command/router helpers in tests. */
export function noopBroadcast(): void {
	// intentional no-op
}