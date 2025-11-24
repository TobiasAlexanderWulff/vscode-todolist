/** Tests the webview state snapshot builder and localization. */

import * as assert from 'assert';
import { afterEach, beforeEach } from 'mocha';
import * as vscode from 'vscode';
import * as l10n from '@vscode/l10n';

import { TodoRepository } from '../todoRepository';
import { buildWebviewStateSnapshot } from '../webviewState';
import {
	InMemoryMemento,
	overrideWorkspaceFolders,
	restoreWorkspaceFoldersDescriptor,
} from './testUtils';

function createRepositoryHarness() {
	const globalState = new InMemoryMemento();
	const workspaceState = new InMemoryMemento();
	const repository = new TodoRepository({ globalState, workspaceState });
	return { repository, globalState, workspaceState };
}

suite('buildWebviewStateSnapshot', () => {
	let originalMathRandom: () => number;

	beforeEach(() => {
		originalMathRandom = Math.random;
		Math.random = () => 0;
	});

	afterEach(() => {
		Math.random = originalMathRandom;
		restoreWorkspaceFoldersDescriptor();
	});

	test('orders todos by position within each scope', async () => {
		const { repository } = createRepositoryHarness();
		const workspace = vscode.Uri.parse('file:///sorted');
		overrideWorkspaceFolders([{ uri: workspace, name: 'Sorted Workspace', index: 0 }]);

		const globalA = repository.createTodo({ title: 'Global A', scope: 'global' });
		const globalB = repository.createTodo({ title: 'Global B', scope: 'global' });
		globalA.position = 2;
		globalB.position = 1;
		await repository.saveGlobalTodos([globalA, globalB]);

		const workspaceA = repository.createTodo({
			title: 'Workspace First',
			scope: 'workspace',
			workspaceFolder: workspace.toString(),
		});
		const workspaceB = repository.createTodo({
			title: 'Workspace Second',
			scope: 'workspace',
			workspaceFolder: workspace.toString(),
		});
		workspaceA.position = 3;
		workspaceB.position = 1;
		await repository.saveWorkspaceTodos(workspace.toString(), [workspaceA, workspaceB]);

		const snapshot = buildWebviewStateSnapshot(repository);

		assert.ok(Date.parse(snapshot.generatedAt));
		assert.deepStrictEqual(
			snapshot.global.todos.map((todo) => todo.title),
			['Global B', 'Global A']
		);
		assert.strictEqual(snapshot.projects.folders.length, 1);
		assert.deepStrictEqual(
			snapshot.projects.folders[0].todos.map((todo) => todo.title),
			['Workspace Second', 'Workspace First']
		);
	});

	test('captures workspace metadata and localized labels across folders', async () => {
		const { repository } = createRepositoryHarness();
		const folderA = vscode.Uri.parse('file:///workspace-a');
		const folderB = vscode.Uri.parse('file:///workspace-b');
		overrideWorkspaceFolders([
			{ uri: folderA, name: 'Workspace A', index: 0 },
			{ uri: folderB, name: 'Workspace B', index: 1 },
		]);

		const todoB = repository.createTodo({
			title: 'Scoped to B',
			scope: 'workspace',
			workspaceFolder: folderB.toString(),
		});
		await repository.saveWorkspaceTodos(folderB.toString(), [todoB]);

		const snapshot = buildWebviewStateSnapshot(repository);
		const expectedGlobalLabel = l10n.t('scope.global.label', 'Global');
		const expectedProjectsLabel = l10n.t('view.todoProjects.label', 'Projects');
		const expectedPlaceholder = l10n.t('command.add.placeholder', 'Type a TODO');

		assert.strictEqual(snapshot.global.label, expectedGlobalLabel);
		assert.strictEqual(snapshot.projects.label, expectedProjectsLabel);
		assert.strictEqual(snapshot.strings.addPlaceholder, expectedPlaceholder);
		assert.strictEqual(snapshot.projects.folders.length, 2);
		const [firstFolder, secondFolder] = snapshot.projects.folders;
		assert.deepStrictEqual(firstFolder, {
			key: folderA.toString(),
			label: 'Workspace A',
			description: folderA.fsPath,
			emptyLabel: l10n.t('webview.projects.empty', 'No project TODOs yet'),
			todos: [],
		});
		assert.strictEqual(secondFolder.key, folderB.toString());
		assert.strictEqual(secondFolder.label, 'Workspace B');
		assert.strictEqual(secondFolder.description, folderB.fsPath);
		assert.deepStrictEqual(
			secondFolder.todos.map((todo) => ({ title: todo.title, scope: todo.scope })),
			[{ title: 'Scoped to B', scope: 'workspace' }]
		);
	});

	test('uses empty-state context hints per scope', async () => {
		const { repository } = createRepositoryHarness();
		const folder = vscode.Uri.parse('file:///context');
		overrideWorkspaceFolders([{ uri: folder, name: 'Context Workspace', index: 0 }]);

		const snapshot = buildWebviewStateSnapshot(repository, {
			global: 'onInit',
			workspaces: { [folder.toString()]: 'afterCompletion' },
		});

		assert.strictEqual(
			snapshot.global.emptyLabel,
			l10n.t(
				'webview.global.emptyMessages.onInit.follow',
				'No global todos. Add something that follows you everywhere.'
			)
		);
		assert.strictEqual(
			snapshot.projects.folders[0]?.emptyLabel,
			l10n.t(
				'webview.projects.emptyMessages.afterCompletion.ship',
				'All project todos done. Celebrate and ship!'
			)
		);
	});
});
