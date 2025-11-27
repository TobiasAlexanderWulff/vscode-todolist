/** Webview runtime powering the TODO list views. */

declare const acquireVsCodeApi: <TState>() => VsCodeApi<TState>;

type ProviderMode = 'global' | 'projects';

type WebviewScope = { scope: 'global' } | { scope: 'workspace'; workspaceFolder: string };

type HostMessage =
	| { type: 'stateUpdate'; payload: WebviewStateSnapshot }
	| { type: 'startInlineCreate'; scope: WebviewScope }
	| { type: 'startInlineEdit'; scope: WebviewScope; todoId: string }
	| { type: 'autoDeleteCue'; scope: WebviewScope; todoId: string; durationMs: number };

type ExtensionMessage =
	| { type: 'webviewReady'; mode: ProviderMode }
	| { type: 'commitCreate'; scope: WebviewScope; title: string }
	| { type: 'commitEdit'; scope: WebviewScope; todoId: string; title: string }
	| { type: 'toggleComplete'; scope: WebviewScope; todoId: string }
	| { type: 'copyTodo'; scope: WebviewScope; todoId: string }
	| { type: 'removeTodo'; scope: WebviewScope; todoId: string }
	| { type: 'reorderTodos'; scope: WebviewScope; order: string[] }
	| { type: 'clearScope'; scope: WebviewScope };

interface VsCodeApi<TState> {
	postMessage(message: ExtensionMessage): void;
	setState(state: TState): void;
	getState(): TState | undefined;
}

interface WebviewStateSnapshot {
	generatedAt: string;
	global: WebviewScopeState;
	projects: WebviewProjectsState;
	strings: WebviewStrings;
}

interface WebviewScopeState {
	label: string;
	emptyLabel: string;
	todos: WebviewTodoState[];
}

interface WebviewProjectsState {
	label: string;
	emptyLabel: string;
	folders: WebviewWorkspaceState[];
}

interface WebviewWorkspaceState {
	key: string;
	label: string;
	description?: string;
	emptyLabel: string;
	todos: WebviewTodoState[];
}

interface WebviewTodoState {
	id: string;
	title: string;
	completed: boolean;
	position: number;
	scope: 'global' | 'workspace';
	workspaceFolder?: string;
	createdAt: string;
	updatedAt: string;
}

interface WebviewStrings {
	addPlaceholder: string;
	inlineCreateHint: string;
	completeLabel: string;
	copyLabel: string;
	removeLabel: string;
	addLabel: string;
	clearLabel: string;
}

/** Tracks inline creation/editing state per scope within the webview. */
interface InlineState {
	creating: boolean;
	editingId?: string;
}

/** Serialized inline state persisted via VS Code's webview state storage. */
interface StoredInlineState {
	global: InlineState;
	workspaces: Record<string, InlineState>;
}

const vscode = acquireVsCodeApi<StoredInlineState>();
const viewMode = (document.body.dataset.viewMode as ProviderMode) ?? 'global';
const root = document.getElementById('root') as HTMLElement;

let snapshot: WebviewStateSnapshot | undefined;
const inlineGlobal: InlineState = { creating: false, editingId: undefined };
const inlineWorkspaces = new Map<string, InlineState>();
const pendingFocusSelectors = new Set<string>();

restoreInlineState();
render();

window.addEventListener('message', (event) => {
	const message = event.data as HostMessage;
	switch (message.type) {
		case 'stateUpdate':
			handleStateUpdate(message.payload);
			break;
		case 'startInlineCreate':
			handleStartInlineCreate(message.scope);
			break;
		case 'startInlineEdit':
			handleStartInlineEdit(message.scope, message.todoId);
			break;
		case 'autoDeleteCue':
			handleAutoDeleteCue(message.scope, message.todoId, message.durationMs);
			break;
		default:
			break;
	}
});

vscode.postMessage({ type: 'webviewReady', mode: viewMode });

/**
 * Replaces the current snapshot with the latest state from the extension and re-renders the view.
 *
 * @param nextSnapshot - Serialized state update message.
 */
function handleStateUpdate(nextSnapshot: WebviewStateSnapshot): void {
	snapshot = nextSnapshot;
	pruneInlineState();
	render();
}

/**
 * Starts inline creation for a given scope and focuses the new input.
 *
 * @param scope - Scope in which the inline row should appear.
 */
function handleStartInlineCreate(scope: WebviewScope): void {
	if (!scopeAppliesToView(scope)) {
		return;
	}
	const inlineState = getInlineState(scope);
	inlineState.creating = true;
	inlineState.editingId = undefined;
	queueFocusSelector(`[data-inline-create="${getScopeKey(scope)}"]`);
	persistInlineState();
	render();
}

/**
 * Applies a fade-out class for todos scheduled for auto-delete.
 *
 * @param scope - Scope containing the todo.
 * @param todoId - Identifier of the todo being removed.
 * @param durationMs - Fade duration supplied by the extension.
 */
function handleAutoDeleteCue(scope: WebviewScope, todoId: string, durationMs: number): void {
	if (!scopeAppliesToView(scope)) {
		return;
	}
	const selector =
		scope.scope === 'global'
			? `.todo-item[data-todo-id="${todoId}"]`
			: `.workspace-section[data-workspace="${scope.workspaceFolder}"] .todo-item[data-todo-id="${todoId}"]`;
	const row = document.querySelector<HTMLElement>(selector);
	if (!row) {
		return;
	}
	row.style.setProperty('--todo-auto-delete-duration', `${durationMs}ms`);
	row.classList.add('auto-delete');
	requestAnimationFrame(() => row.classList.add('fade-out'));
}

/**
 * Begins inline edit mode for a todo within the current view.
 *
 * @param scope - Scope containing the todo.
 * @param todoId - Identifier of the todo being edited.
 */
function handleStartInlineEdit(scope: WebviewScope, todoId: string): void {
	if (!scopeAppliesToView(scope)) {
		return;
	}
	const inlineState = getInlineState(scope);
	inlineState.creating = false;
	inlineState.editingId = todoId;
	queueFocusSelector(`[data-inline-edit="${todoId}"]`);
	persistInlineState();
	render();
}

/**
 * Ensures incoming scope actions match the current provider mode.
 *
 * @param scope - Target scope.
 * @returns True when the scope is relevant to the current webview.
 */
function scopeAppliesToView(scope: WebviewScope): boolean {
	if (viewMode === 'global') {
		return scope.scope === 'global';
	}
	return scope.scope === 'workspace';
}

/** Restores persisted inline editing/creation state from VS Code. */
function restoreInlineState(): void {
	const stored = vscode.getState();
	if (!stored) {
		return;
	}
	Object.assign(inlineGlobal, stored.global ?? { creating: false });
	Object.entries(stored.workspaces ?? {}).forEach(([key, state]) => {
		inlineWorkspaces.set(key, { creating: state.creating, editingId: state.editingId });
	});
}

/** Persists inline editing/creation state to VS Code storage. */
function persistInlineState(): void {
	const serialized: StoredInlineState = {
		global: { ...inlineGlobal },
		workspaces: {},
	};
	inlineWorkspaces.forEach((state, key) => {
		serialized.workspaces[key] = { ...state };
	});
	vscode.setState(serialized);
}

/**
 * Retrieves inline state for a scope, initializing it when missing.
 *
 * @param scope - Target scope.
 */
function getInlineState(scope: WebviewScope): InlineState {
	if (scope.scope === 'global') {
		return inlineGlobal;
	}
	let state = inlineWorkspaces.get(scope.workspaceFolder);
	if (!state) {
		state = { creating: false };
		inlineWorkspaces.set(scope.workspaceFolder, state);
	}
	return state;
}

/**
 * Removes stale inline editing references when todos or workspaces disappear.
 */
function pruneInlineState(): void {
	if (!snapshot) {
		return;
	}
	if (viewMode === 'global') {
		if (inlineGlobal.editingId && !snapshot.global.todos.some((todo) => todo.id === inlineGlobal.editingId)) {
			inlineGlobal.editingId = undefined;
		}
		return;
	}
	const folderKeys = new Set(snapshot.projects.folders.map((folder) => folder.key));
	Array.from(inlineWorkspaces.keys()).forEach((key) => {
		if (!folderKeys.has(key)) {
			inlineWorkspaces.delete(key);
		}
	});
	inlineWorkspaces.forEach((state, key) => {
		const folder = snapshot?.projects.folders.find((item) => item.key === key);
		if (!folder) {
			return;
		}
		if (state.editingId && !folder.todos.some((todo) => todo.id === state.editingId)) {
			state.editingId = undefined;
		}
	});
}

/** Renders the root container based on the latest snapshot and inline state. */
function render(): void {
	if (!snapshot) {
		root.innerHTML = '<p class="empty-state">Waiting for TODOs…</p>';
		return;
	}
	root.innerHTML = '';
	if (viewMode === 'global') {
		root.appendChild(renderScopeSection(snapshot.global, { scope: 'global' }));
	} else {
		root.appendChild(renderProjectsSection(snapshot.projects));
	}
	applyPendingFocus();
}

/**
 * Renders a single scope section (global or workspace) including inline rows.
 *
 * @param state - Snapshot for the scope.
 * @param scope - Target scope metadata.
 */
function renderScopeSection(state: WebviewScopeState, scope: WebviewScope): HTMLElement {
	const section = document.createElement('section');
	section.className = 'todo-section';

	const header = document.createElement('header');
	const title = document.createElement('h2');
	title.textContent = state.label;
	header.appendChild(title);
	header.appendChild(renderSectionActions(scope));
	section.appendChild(header);

	const list = document.createElement('div');
	list.className = 'todo-list';
	const inlineState = getInlineState(scope);

	if (inlineState.creating) {
		list.appendChild(renderInlineCreateRow(scope));
	}

	state.todos.forEach((todo) => {
		list.appendChild(renderTodoRow(scope, todo, inlineState));
	});

	if (state.todos.length === 0 && !inlineState.creating) {
		const empty = document.createElement('p');
		empty.className = 'empty-state';
		empty.textContent = state.emptyLabel;
		list.appendChild(empty);
	}

	attachDragHandlers(list, scope, inlineState);
	section.appendChild(list);
	return section;
}

/**
 * Renders the projects container with one subsection per workspace folder.
 *
 * @param projects - Snapshot of workspace folders.
 */
function renderProjectsSection(projects: WebviewProjectsState): HTMLElement {
	const container = document.createElement('section');
	container.className = 'todo-section';

	if (projects.folders.length === 0) {
		const empty = document.createElement('p');
		empty.className = 'empty-state';
		empty.textContent = projects.emptyLabel;
		container.appendChild(empty);
		return container;
	}

	projects.folders.forEach((folder) => {
		const scope: WebviewScope = { scope: 'workspace', workspaceFolder: folder.key };
		const inlineState = getInlineState(scope);

		const workspaceWrapper = document.createElement('div');
		workspaceWrapper.className = 'workspace-section';
		workspaceWrapper.dataset.workspace = folder.key;

		const workspaceTitle = document.createElement('div');
		workspaceTitle.className = 'workspace-title';
		workspaceTitle.textContent = folder.label;

		const titleRow = document.createElement('header');
		titleRow.appendChild(workspaceTitle);
		titleRow.appendChild(renderSectionActions(scope));

		workspaceWrapper.appendChild(titleRow);

		const list = document.createElement('div');
		list.className = 'todo-list';

		if (inlineState.creating) {
			list.appendChild(renderInlineCreateRow(scope));
		}

		folder.todos.forEach((todo) => {
			list.appendChild(renderTodoRow(scope, todo, inlineState));
		});

		if (folder.todos.length === 0 && !inlineState.creating) {
			const empty = document.createElement('p');
			empty.className = 'empty-state';
			empty.textContent = folder.emptyLabel;
			list.appendChild(empty);
		}

		attachDragHandlers(list, scope, inlineState);
		workspaceWrapper.appendChild(list);
		container.appendChild(workspaceWrapper);
	});

	return container;
}

/**
 * Renders the add/clear action buttons for a scope header.
 *
 * @param scope - Scope to act on.
 */
function renderSectionActions(scope: WebviewScope): HTMLElement {
	const actions = document.createElement('div');
	actions.className = 'section-actions';

	const addButton = document.createElement('button');
	addButton.className = 'button-link';
	addButton.innerHTML = `<span>${snapshot?.strings.addLabel ?? 'Add'}</span>`;
	addButton.addEventListener('click', () => startInlineCreate(scope));
	actions.appendChild(addButton);

	const clearButton = document.createElement('button');
	clearButton.className = 'button-link';
	clearButton.innerHTML = `<span>${snapshot?.strings.clearLabel ?? 'Clear'}</span>`;
	clearButton.addEventListener('click', () => postMessage({ type: 'clearScope', scope }));
	actions.appendChild(clearButton);

	return actions;
}

/**
 * Renders inline creation controls for a scope.
 *
 * @param scope - Scope to create a todo within.
 */
function renderInlineCreateRow(scope: WebviewScope): HTMLElement {
	const row = document.createElement('div');
	row.className = 'todo-item inline-create';
	const input = document.createElement('input');
	input.className = 'todo-input';
	input.placeholder = snapshot?.strings.addPlaceholder ?? 'Type a TODO';
	input.dataset.inlineCreate = getScopeKey(scope);
	input.addEventListener('keydown', (event) => {
		if (event.key === 'Enter') {
			event.preventDefault();
			commitInlineCreate(scope, input.value);
		}
		if (event.key === 'Escape') {
			event.preventDefault();
			cancelInlineCreate(scope);
		}
	});
	input.addEventListener('blur', () => {
		const value = input.value.trim();
		if (value.length === 0) {
			cancelInlineCreate(scope);
		}
	});
	row.appendChild(input);

	const hint = document.createElement('small');
	hint.className = 'inline-hint';
	hint.textContent = snapshot?.strings.inlineCreateHint ?? '';
	row.appendChild(hint);
	return row;
}

/**
 * Renders a todo row, switching between read and edit mode based on inline state.
 *
 * @param scope - Scope the todo belongs to.
 * @param todo - Todo data for the row.
 * @param inlineState - Inline editing state for the scope.
 */
function renderTodoRow(scope: WebviewScope, todo: WebviewTodoState, inlineState: InlineState): HTMLElement {
	const row = document.createElement('div');
	row.className = 'todo-item';
	row.dataset.todoId = todo.id;
	row.draggable = !inlineState.editingId;

	const toggleButton = document.createElement('button');
	toggleButton.className = 'todo-action todo-toggle';
	toggleButton.title = snapshot?.strings.completeLabel ?? 'Toggle complete';
	toggleButton.innerHTML = todo.completed
		? '<svg width="16" height="16" viewBox="0 0 16 16" fill="none"><circle cx="8" cy="8" r="7" stroke="currentColor" stroke-width="1.5"/><path d="M4.5 8.5L7 11L11.5 5.5" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>'
		: '<svg width="16" height="16" viewBox="0 0 16 16" fill="none"><circle cx="8" cy="8" r="7" stroke="currentColor" stroke-width="1.5"/></svg>';
	toggleButton.addEventListener('click', () =>
		postMessage({
			type: 'toggleComplete',
			scope,
			todoId: todo.id,
		}),
	);
	row.appendChild(toggleButton);

	if (inlineState.editingId === todo.id) {
		const input = document.createElement('input');
		input.className = 'todo-input';
		input.value = todo.title;
		input.dataset.inlineEdit = todo.id;
		input.addEventListener('keydown', (event) => {
			if (event.key === 'Enter') {
				event.preventDefault();
				commitInlineEdit(scope, todo.id, input.value);
			}
			if (event.key === 'Escape') {
				event.preventDefault();
				exitInlineEdit(scope);
			}
		});
		input.addEventListener('blur', () => {
			const trimmed = input.value.trim();
			if (trimmed.length === 0) {
				exitInlineEdit(scope);
				return;
			}
			if (trimmed === todo.title) {
				exitInlineEdit(scope);
				return;
			}
			commitInlineEdit(scope, todo.id, trimmed);
		});
		row.appendChild(input);
	} else {
		const title = document.createElement('span');
		title.className = `todo-title${todo.completed ? ' completed' : ''}`;
		title.textContent = todo.title;
		title.addEventListener('dblclick', () => startInlineEdit(scope, todo.id));
		row.appendChild(title);
	}

	const actions = document.createElement('div');
	actions.className = 'todo-actions';

	const copyButton = document.createElement('button');
	copyButton.className = 'todo-action';
	copyButton.innerHTML =
		//'<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="feather feather-copy"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path></svg>';
		'<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2"></path><rect x="8" y="2" width="8" height="4" rx="1" ry="1"></rect></svg>'
		copyButton.title = snapshot?.strings.copyLabel ?? 'Copy';
	copyButton.addEventListener('click', () =>
		postMessage({
			type: 'copyTodo',
			scope,
			todoId: todo.id,
		}),
	);
	actions.appendChild(copyButton);

	const editButton = document.createElement('button');
	editButton.className = 'todo-action';
	editButton.innerHTML = '<svg width="16" height="16" viewBox="0 0 16 16" fill="none"><path transform="translate(0, 2)" d="M12.5 3.5L10 1L3 8V10.5H5.5L12.5 3.5Z" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>';
	editButton.title = 'Edit';
	editButton.addEventListener('click', () => startInlineEdit(scope, todo.id));
	actions.appendChild(editButton);

	const removeButton = document.createElement('button');
	removeButton.className = 'todo-action';
	removeButton.innerHTML = '<svg width="16" height="16" viewBox="0 0 16 16" fill="none"><path d="M4 4L12 12M12 4L4 12" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg>';
	removeButton.title = snapshot?.strings.removeLabel ?? 'Remove';
	removeButton.addEventListener('click', () => postMessage({
		type: 'removeTodo',
		scope,
		todoId: todo.id,
	}));
	actions.appendChild(removeButton);

	row.appendChild(actions);
	return row;
}

/** Starts inline creation for the provided scope and persists inline state. */
function startInlineCreate(scope: WebviewScope): void {
	if (!scopeAppliesToView(scope)) {
		return;
	}
	const state = getInlineState(scope);
	state.creating = true;
	state.editingId = undefined;
	queueFocusSelector(`[data-inline-create="${getScopeKey(scope)}"]`);
	persistInlineState();
	render();
}

/** Cancels inline creation and re-renders the view. */
function cancelInlineCreate(scope: WebviewScope): void {
	const state = getInlineState(scope);
	state.creating = false;
	persistInlineState();
	render();
}

/**
 * Commits inline creation input, ignoring empty values.
 *
 * @param scope - Scope to create a todo in.
 * @param value - User-entered title.
 */
function commitInlineCreate(scope: WebviewScope, value: string): void {
	const trimmed = value.trim();
	if (trimmed.length === 0) {
		cancelInlineCreate(scope);
		return;
	}
	postMessage({ type: 'commitCreate', scope, title: trimmed });
	const state = getInlineState(scope);
	state.creating = false;
	persistInlineState();
}

/** Starts inline edit mode for a todo and persists inline state. */
function startInlineEdit(scope: WebviewScope, todoId: string): void {
	if (!scopeAppliesToView(scope)) {
		return;
	}
	const state = getInlineState(scope);
	state.creating = false;
	state.editingId = todoId;
	queueFocusSelector(`[data-inline-edit="${todoId}"]`);
	persistInlineState();
	render();
}

/** Exits inline edit mode without saving changes. */
function exitInlineEdit(scope: WebviewScope): void {
	const state = getInlineState(scope);
	state.editingId = undefined;
	persistInlineState();
	render();
}

/**
 * Commits inline edits for a todo when the input is valid.
 *
 * @param scope - Scope containing the todo.
 * @param todoId - Identifier of the todo being edited.
 * @param value - Updated title text.
 */
function commitInlineEdit(scope: WebviewScope, todoId: string, value: string): void {
	const trimmed = value.trim();
	if (trimmed.length === 0) {
		exitInlineEdit(scope);
		return;
	}
	postMessage({ type: 'commitEdit', scope, todoId, title: trimmed });
	const state = getInlineState(scope);
	state.editingId = undefined;
	persistInlineState();
}

/**
 * Attaches drag-and-drop handlers for reordering todos within a list.
 *
 * @param list - Container element holding todo rows.
 * @param scope - Scope containing the todos.
 * @param inlineState - Inline edit state used to guard against drag while editing.
 */
function attachDragHandlers(list: HTMLElement, scope: WebviewScope, inlineState: InlineState): void {
	let draggedId: string | undefined;
	list.addEventListener('dragstart', (event) => {
		if (inlineState.editingId) {
			return;
		}
		const item = (event.target as HTMLElement | null)?.closest<HTMLElement>('.todo-item');
		if (!item || !item.dataset.todoId) {
			return;
		}
		draggedId = item.dataset.todoId;
		event.dataTransfer?.setData('text/plain', draggedId);
	});
	list.addEventListener('dragover', (event) => {
		if (inlineState.editingId) {
			return;
		}
		if (!draggedId) {
			return;
		}
		const target = (event.target as HTMLElement | null)?.closest<HTMLElement>('.todo-item');
		if (!target || !target.dataset.todoId || target.dataset.todoId === draggedId) {
			return;
		}
		event.preventDefault();
		target.classList.add('drag-over');
	});
	list.addEventListener('dragleave', (event) => {
		if (inlineState.editingId) {
			return;
		}
		const target = (event.target as HTMLElement | null)?.closest<HTMLElement>('.todo-item');
		target?.classList.remove('drag-over');
	});
	list.addEventListener('drop', (event) => {
		if (inlineState.editingId) {
			return;
		}
		event.preventDefault();
		const target = (event.target as HTMLElement | null)?.closest<HTMLElement>('.todo-item');
		if (!target || !target.dataset.todoId || !draggedId || target.dataset.todoId === draggedId) {
			resetDragState(list);
			return;
		}
		const draggedNode = list.querySelector<HTMLElement>(`.todo-item[data-todo-id="${draggedId}"]`);
		if (!draggedNode) {
			resetDragState(list);
			return;
		}
		const targetRect = target.getBoundingClientRect();
		const before = event.clientY < targetRect.top + targetRect.height / 2;
		list.insertBefore(draggedNode, before ? target : target.nextElementSibling);
		const order = Array.from(list.querySelectorAll<HTMLElement>('.todo-item'))
			.map((node) => node.dataset.todoId)
			.filter((id): id is string => Boolean(id));
		postMessage({ type: 'reorderTodos', scope, order });
		resetDragState(list);
	});
	list.addEventListener('dragend', () => {
		resetDragState(list);
	});

	function resetDragState(container: HTMLElement): void {
		draggedId = undefined;
		container.querySelectorAll('.drag-over').forEach((el) => el.classList.remove('drag-over'));
	}
}

/** Queues a selector to be focused after the next render. */
function queueFocusSelector(selector: string): void {
	pendingFocusSelectors.add(selector);
}

/** Focuses any queued selectors once the DOM has been updated. */
function applyPendingFocus(): void {
	if (pendingFocusSelectors.size === 0) {
		return;
	}
	const selectors = Array.from(pendingFocusSelectors.values());
	pendingFocusSelectors.clear();
	requestAnimationFrame(() => {
		selectors.forEach((selector) => {
			const element = document.querySelector<HTMLInputElement>(selector);
			if (element) {
				element.focus();
				element.setSelectionRange(element.value.length, element.value.length);
			}
		});
	});
}

/** Returns the serialization key for a scope used by DOM data attributes. */
function getScopeKey(scope: WebviewScope): string {
	return scope.scope === 'global' ? 'global' : scope.workspaceFolder;
}

/** Sends a message from the webview to the extension host. */
function postMessage(message: ExtensionMessage): void {
	vscode.postMessage(message);
}
