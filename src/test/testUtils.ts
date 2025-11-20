import * as vscode from 'vscode';

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

export function overrideWorkspaceFolders(folders: readonly vscode.WorkspaceFolder[]): void {
	Object.defineProperty(vscode.workspace, 'workspaceFolders', {
		get: () => folders,
		configurable: true,
	});
}

export function restoreWorkspaceFoldersDescriptor(): void {
	if (workspaceFoldersDescriptor) {
		Object.defineProperty(vscode.workspace, 'workspaceFolders', workspaceFoldersDescriptor);
		return;
	}
	Object.defineProperty(vscode.workspace, 'workspaceFolders', { get: () => undefined });
}
