import { randomUUID } from 'crypto';
import * as vscode from 'vscode';

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

export interface CreateTodoInput {
	title: string;
	scope: TodoScope;
	workspaceFolder?: string;
	position?: number;
}

export type RepositoryContext = Pick<vscode.ExtensionContext, 'globalState' | 'workspaceState'>;

export class TodoRepository {
	private undoSnapshots = new Map<ScopeKey, Todo[]>();

	constructor(private readonly context: RepositoryContext) {}

	getGlobalTodos(): Todo[] {
		const state = this.getGlobalState();
		return state.todos.map((entity) => this.toTodo('global', undefined, entity));
	}

	async saveGlobalTodos(todos: Todo[]): Promise<void> {
		const payload: PersistedGlobalState = {
			version: SCHEMA_VERSION,
			todos: todos.map((todo) => this.toEntity(todo)),
		};
		await this.context.globalState.update(GLOBAL_STATE_KEY, payload);
	}

	getWorkspaceTodos(workspaceFolder: string): Todo[] {
		const folderKey = this.ensureWorkspaceFolder(workspaceFolder);
		const state = this.getWorkspaceState();
		const todos = state.folders[folderKey] ?? [];
		return todos.map((entity) => this.toTodo('workspace', folderKey, entity));
	}

	async saveWorkspaceTodos(workspaceFolder: string, todos: Todo[]): Promise<void> {
		const folderKey = this.ensureWorkspaceFolder(workspaceFolder);
		const state = this.getWorkspaceState();
		state.folders[folderKey] = todos.map((todo) => this.toEntity(todo));
		await this.context.workspaceState.update(WORKSPACE_STATE_KEY, state);
	}

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

	scopeKey(scope: TodoScope, workspaceFolder?: string): ScopeKey {
		if (scope === 'global') {
			return 'global';
		}
		const folderKey = this.ensureWorkspaceFolder(workspaceFolder);
		return `workspace:${folderKey}`;
	}

	captureSnapshot(scope: ScopeKey, todos: Todo[]): void {
		this.undoSnapshots.set(scope, todos.map((todo) => ({ ...todo })));
	}

	consumeSnapshot(scope: ScopeKey): Todo[] | undefined {
		const snapshot = this.undoSnapshots.get(scope);
		this.undoSnapshots.delete(scope);
		return snapshot?.map((todo) => ({ ...todo }));
	}

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
		const { scope, workspaceFolder, ...rest } = todo;
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
