import * as vscode from 'vscode';

export interface TodoConfig {
	confirmDestructiveActions: boolean;
	autoDeleteCompleted: boolean;
	autoDeleteDelayMs: number;
	autoDeleteFadeMs: number;
}

export function readConfig(): TodoConfig {
	const configuration = vscode.workspace.getConfiguration('todo');
	return {
		confirmDestructiveActions: configuration.get<boolean>('confirmDestructiveActions', true),
		autoDeleteCompleted: configuration.get<boolean>('autoDeleteCompleted', true),
		autoDeleteDelayMs: configuration.get<number>('autoDeleteDelayMs', 1500),
		autoDeleteFadeMs: configuration.get<number>('autoDeleteFadeMs', 750),
	};
}
