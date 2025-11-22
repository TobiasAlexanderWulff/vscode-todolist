/** Tests repository persistence and normalization utilities. */

import * as assert from 'assert';

import { TodoRepository } from '../todoRepository';
import { Todo } from '../types';
import { InMemoryMemento } from './testUtils';

interface RepositoryHarness {
	repository: TodoRepository;
	globalState: InMemoryMemento;
	workspaceState: InMemoryMemento;
}

function createRepositoryHarness(): RepositoryHarness {
	const globalState = new InMemoryMemento();
	const workspaceState = new InMemoryMemento();
	const repository = new TodoRepository({
		globalState,
		workspaceState,
	});
	return { repository, globalState, workspaceState };
}

suite('TodoRepository', () => {
	test('creates scoped todos with metadata', () => {
		const { repository } = createRepositoryHarness();

		const globalTodo = repository.createTodo({ title: 'Review tests', scope: 'global' });
		assert.strictEqual(globalTodo.scope, 'global');
		assert.ok(globalTodo.id.length > 0);
		assert.strictEqual(globalTodo.workspaceFolder, undefined);

		const workspaceTodo = repository.createTodo({
			title: 'Wire TreeView',
			scope: 'workspace',
			workspaceFolder: 'file:///test',
		});
		assert.strictEqual(workspaceTodo.scope, 'workspace');
		assert.strictEqual(workspaceTodo.workspaceFolder, 'file:///test');
		assert.ok(workspaceTodo.position >= 1);
	});

	test('persists global todos via the global state memento', async () => {
		const harness = createRepositoryHarness();
		const todo = harness.repository.createTodo({ title: 'Write docs', scope: 'global' });
		await harness.repository.saveGlobalTodos([todo]);

		const secondRepository = new TodoRepository({
			globalState: harness.globalState,
			workspaceState: harness.workspaceState,
		});
		const todos = secondRepository.getGlobalTodos();
		assert.strictEqual(todos.length, 1);
		assert.strictEqual(todos[0].title, 'Write docs');
	});

	test('captures and restores snapshots per scope', () => {
		const { repository } = createRepositoryHarness();
		const workspaceFolder = 'file:///restore';
		const todo = repository.createTodo({
			title: 'Snapshot me',
			scope: 'workspace',
			workspaceFolder,
		});
		const scopeKey = repository.scopeKey('workspace', workspaceFolder);

		repository.captureSnapshot(scopeKey, [todo]);
		const restored = repository.consumeSnapshot(scopeKey) as Todo[];
		assert.strictEqual(restored.length, 1);
		assert.strictEqual(restored[0].title, 'Snapshot me');
		assert.strictEqual(repository.consumeSnapshot(scopeKey), undefined);
	});
});