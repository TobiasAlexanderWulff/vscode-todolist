import { randomUUID } from 'crypto';
import * as vscode from 'vscode';

import { normalizePositions } from './domain/todo';
import { ScopeKey, Todo, TodoScope } from './types';

const GLOBAL_STATE_KEY = 'todo.globalState';
const WORKSPACE_STATE_KEY = 'todo.workspaceState';
const SCHEMA_VERSION = 1;

type PersistedTodo = Omit<Todo, 'scope' | 'workspaceFolder'>;

interface PersistedGlobalState {
	version: number;
	todos: PersistedTodo[];
}

interface PersistedWorkspaceState {
	version: number;
	folders: Record<string, PersistedTodo[]>;
}

const DEFAULT_GLOBAL_STATE: PersistedGlobalState = { version: SCHEMA_VERSION, todos: [] };
const DEFAULT_WORKSPACE_STATE: PersistedWorkspaceState = { version: SCHEMA_VERSION, folders: {} };

/** Input parameters used to create a new todo entity prior to persistence. */
export interface CreateTodoInput {
	title: string;
	scope: TodoScope;
	workspaceFolder?: string;
	position?: number;
}

/** Minimal slice of the extension context used by the repository. */
export type RepositoryContext = Pick<vscode.ExtensionContext, 'globalState' | 'workspaceState'>;

/**
 * Persists todos into VS Code's global/workspace mementos while handling scope-aware metadata
 * such as positions and workspace folders. It also manages undo snapshots for destructive actions.
 */
export class TodoRepository {
	private undoSnapshots = new Map<ScopeKey, Todo[]>();

	constructor(private readonly context: RepositoryContext) {}

	/**
	 * Reads all global-scope todos currently stored in the profile memento.
	 *
	 * @returns A deep copy of global todos sorted in persisted order.
	 */
	getGlobalTodos(): Todo[] {
		const state = this.getGlobalState();
		return state.todos.map((entity) => this.toTodo('global', undefined, entity));
	}

	/**
	 * Persists global todos, retaining only fields that belong in the serialized payload.
	 *
	 * @param todos - Todos to write to the global state memento.
	 */
	async saveGlobalTodos(todos: Todo[]): Promise<void> {
		const payload: PersistedGlobalState = {
			version: SCHEMA_VERSION,
			todos: todos.map((todo) => this.toEntity(todo)),
		};
		await this.context.globalState.update(GLOBAL_STATE_KEY, payload);
	}

	/**
	 * Reads todos scoped to a workspace folder. The folder key is normalized to avoid mixing IDs.
	 *
	 * @param workspaceFolder - Workspace folder key (URI string) to read.
	 * @returns A deep copy of workspace todos for the folder.
	 */
	getWorkspaceTodos(workspaceFolder: string): Todo[] {
		const folderKey = this.ensureWorkspaceFolder(workspaceFolder);
		const state = this.getWorkspaceState();
		const todos = state.folders[folderKey] ?? [];
		return todos.map((entity) => this.toTodo('workspace', folderKey, entity));
	}

	/**
	 * Persists todos for a workspace folder, overwriting any previous list.
	 *
	 * @param workspaceFolder - Workspace folder key (URI string) to write to.
	 * @param todos - Todos to store for the folder.
	 */
	async saveWorkspaceTodos(workspaceFolder: string, todos: Todo[]): Promise<void> {
		const folderKey = this.ensureWorkspaceFolder(workspaceFolder);
		const state = this.getWorkspaceState();
		state.folders[folderKey] = todos.map((todo) => this.toEntity(todo));
		await this.context.workspaceState.update(WORKSPACE_STATE_KEY, state);
	}

	/**
	 * Creates a new todo instance with metadata (ID, timestamps, position) but does not persist it.
	 *
	 * @param input - Todo details including scope and optional initial position.
	 * @returns A hydrated todo ready for insertion.
	 */
	createTodo(input: CreateTodoInput): Todo {
		if (input.scope === 'workspace' && !input.workspaceFolder) {
			throw new Error('workspaceFolder must be provided for workspace scoped todos.');
		}
		const now = new Date().toISOString();
		return {
			id: randomUUID(),
			title: input.title,
			completed: false,
			scope: input.scope,
			workspaceFolder: input.scope === 'workspace' ? input.workspaceFolder : undefined,
			position: input.position ?? this.nextPosition(input),
			createdAt: now,
			updatedAt: now,
		};
	}

	/**
	 * Returns the serialized scope key used for snapshot lookup and undo operations.
	 *
	 * @param scope - Target scope for todos.
	 * @param workspaceFolder - Workspace folder key when scope is `workspace`.
	 */
	scopeKey(scope: TodoScope, workspaceFolder?: string): ScopeKey {
		if (scope === 'global') {
			return 'global';
		}
		const folderKey = this.ensureWorkspaceFolder(workspaceFolder);
		return `workspace:${folderKey}`;
	}

	/**
	 * Captures a deep copy of todos for a scope so destructive actions can be undone temporarily.
	 *
	 * @param scope - Scope key used for the undo cache.
	 * @param todos - Todos to snapshot.
	 */
	captureSnapshot(scope: ScopeKey, todos: Todo[]): void {
		this.undoSnapshots.set(scope, todos.map((todo) => ({ ...todo })));
	}

	/**
	 * Retrieves and clears a previously captured snapshot. Returns a cloned copy to avoid mutation.
	 *
	 * @param scope - Scope key used for the undo cache.
	 * @returns Snapshot todos or undefined if none exists.
	 */
	consumeSnapshot(scope: ScopeKey): Todo[] | undefined {
		const snapshot = this.undoSnapshots.get(scope);
		this.undoSnapshots.delete(scope);
		return snapshot?.map((todo) => ({ ...todo }));
	}

	/**
	 * Reads todos based on a scope target, abstracting away the getGlobal/getWorkspace call.
	 *
	 * @param scope - Target scope descriptor.
	 * @returns Todos for the target.
	 */
	readTodos(scope: { scope: 'global' } | { scope: 'workspace'; workspaceFolder: string }): Todo[] {
		if (scope.scope === 'global') {
			return this.getGlobalTodos();
		}
		return this.getWorkspaceTodos(scope.workspaceFolder);
	}

	/**
	 * Persists todos based on a scope target, abstracting away the saveGlobal/saveWorkspace call.
	 *
	 * @param scope - Target scope descriptor.
	 * @param todos - Todos to write for the scope.
	 */
	async persistTodos(
		scope: { scope: 'global' } | { scope: 'workspace'; workspaceFolder: string },
		todos: Todo[]
	): Promise<void> {
		const normalized = normalizePositions(todos);
		if (scope.scope === 'global') {
			await this.saveGlobalTodos(normalized);
		} else {
			await this.saveWorkspaceTodos(scope.workspaceFolder, normalized);
		}
	}

	/** Calculates the next position within a scope to keep manual ordering stable. */
	private nextPosition(input: CreateTodoInput): number {
		const siblings =
			input.scope === 'global'
				? this.getGlobalTodos()
				: this.getWorkspaceTodos(this.ensureWorkspaceFolder(input.workspaceFolder));
		if (siblings.length === 0) {
			return 1;
		}
		return Math.max(...siblings.map((todo) => todo.position)) + 1;
	}

	private getGlobalState(): PersistedGlobalState {
		const stored = this.context.globalState.get<PersistedGlobalState>(GLOBAL_STATE_KEY);
		if (!stored || stored.version !== SCHEMA_VERSION) {
			return { ...DEFAULT_GLOBAL_STATE, todos: [] };
		}
		return {
			version: SCHEMA_VERSION,
			todos: stored.todos.map((todo) => ({ ...todo })),
		};
	}

	private getWorkspaceState(): PersistedWorkspaceState {
		const stored = this.context.workspaceState.get<PersistedWorkspaceState>(WORKSPACE_STATE_KEY);
		if (!stored || stored.version !== SCHEMA_VERSION) {
			return { ...DEFAULT_WORKSPACE_STATE, folders: {} };
		}
		const folders: Record<string, PersistedTodo[]> = {};
		Object.keys(stored.folders).forEach((folderKey) => {
			folders[folderKey] = stored.folders[folderKey].map((todo) => ({ ...todo }));
		});
		return { version: SCHEMA_VERSION, folders };
	}

	private toEntity(todo: Todo): PersistedTodo {
		const { scope: _scope, workspaceFolder: _workspaceFolder, ...rest } = todo;
		return { ...rest };
	}

	private toTodo(scope: TodoScope, workspaceFolder: string | undefined, entity: PersistedTodo): Todo {
		return {
			...entity,
			scope,
			workspaceFolder,
		};
	}

	private ensureWorkspaceFolder(workspaceFolder?: string): string {
		if (!workspaceFolder) {
			throw new Error('workspaceFolder must be provided for workspace scoped data.');
		}
		return workspaceFolder;
	}
}