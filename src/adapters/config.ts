import * as vscode from 'vscode';

/** Public configuration surface read from VS Code settings. */
export interface TodoConfig {
	confirmDestructiveActions: boolean;
	autoDeleteCompleted: boolean;
	autoDeleteDelayMs: number;
	autoDeleteFadeMs: number;
}

/**
 * Reads the todo configuration section from VS Code workspace settings.
 *
 * @returns Normalized configuration object with defaults applied.
 */
export function readConfig(): TodoConfig {
	const configuration = vscode.workspace.getConfiguration('todo');
	return {
		confirmDestructiveActions: configuration.get<boolean>('confirmDestructiveActions', true),
		autoDeleteCompleted: configuration.get<boolean>('autoDeleteCompleted', true),
		autoDeleteDelayMs: configuration.get<number>('autoDeleteDelayMs', 1500),
		autoDeleteFadeMs: configuration.get<number>('autoDeleteFadeMs', 750),
	};
}