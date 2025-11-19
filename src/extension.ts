import * as l10n from '@vscode/l10n';
import * as vscode from 'vscode';

import { TodoRepository } from './todoRepository';

const PLACEHOLDER_COMMANDS: Array<{ id: string; messageKey: string }> = [
	{ id: 'todo.addTodo', messageKey: 'command.todo.add.placeholder' },
	{ id: 'todo.editTodo', messageKey: 'command.todo.edit.placeholder' },
	{ id: 'todo.completeTodo', messageKey: 'command.todo.complete.placeholder' },
	{ id: 'todo.removeTodo', messageKey: 'command.todo.remove.placeholder' },
	{ id: 'todo.clearTodos', messageKey: 'command.todo.clear.placeholder' },
];

export async function activate(context: vscode.ExtensionContext): Promise<void> {
	await l10n.config({ fsPath: context.asAbsolutePath('l10n/bundle.l10n.json') });

	const repository = new TodoRepository(context);
	registerPlaceholderCommands(context, repository);

	console.log(l10n.t('extension.activatedLog', 'vscode-todo extension activated.'));
}

export function deactivate(): void {
	// Nothing to clean up yet.
}

function registerPlaceholderCommands(context: vscode.ExtensionContext, _repository: TodoRepository): void {
	PLACEHOLDER_COMMANDS.forEach(({ id, messageKey }) => {
		const disposable = vscode.commands.registerCommand(id, () => {
			const message = l10n.t(
				messageKey,
				'"{0}" will ship soon. Track the implementation status in docs/implementation-plan.md.',
				id
			);
			vscode.window.showInformationMessage(message);
		});
		context.subscriptions.push(disposable);
	});
}
