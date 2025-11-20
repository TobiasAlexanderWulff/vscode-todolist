declare const acquireVsCodeApi: <TState>() => VsCodeApi<TState>;

type ProviderMode = 'global' | 'projects';

type WebviewScope = { scope: 'global' } | { scope: 'workspace'; workspaceFolder: string };

type HostMessage =
	| { type: 'stateUpdate'; payload: WebviewStateSnapshot }
	| { type: 'startInlineCreate'; scope: WebviewScope }
	| { type: 'startInlineEdit'; scope: WebviewScope; todoId: string };

type ExtensionMessage =
	| { type: 'webviewReady'; mode: ProviderMode }
	| { type: 'commitCreate'; scope: WebviewScope; title: string }
	| { type: 'commitEdit'; scope: WebviewScope; todoId: string; title: string }
	| { type: 'toggleComplete'; scope: WebviewScope; todoId: string }
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
	removeLabel: string;
}

interface InlineState {
	creating: boolean;
	editingId?: string;
}

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
		default:
			break;
	}
});

vscode.postMessage({ type: 'webviewReady', mode: viewMode });

function handleStateUpdate(nextSnapshot: WebviewStateSnapshot): void {
	snapshot = nextSnapshot;
	pruneInlineState();
	render();
}

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

function scopeAppliesToView(scope: WebviewScope): boolean {
	if (viewMode === 'global') {
		return scope.scope === 'global';
	}
	return scope.scope === 'workspace';
}

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

function renderScopeSection(state: WebviewScopeState, scope: WebviewScope): HTMLElement {
	const section = document.createElement('section');
	section.className = 'todo-section';

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

	attachDragHandlers(list, scope);
	section.appendChild(list);
	return section;
}

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

		const workspaceTitle = document.createElement('div');
		workspaceTitle.className = 'workspace-title';
		workspaceTitle.textContent = folder.label;

		const workspaceActions = document.createElement('div');
		workspaceActions.className = 'section-actions';

		const addButton = document.createElement('button');
		addButton.className = 'button-link';
		addButton.innerHTML = '<span>Add</span>';
		addButton.addEventListener('click', () => startInlineCreate(scope));
		workspaceActions.appendChild(addButton);

		const clearButton = document.createElement('button');
		clearButton.className = 'button-link';
		clearButton.innerHTML = '<span>Clear</span>';
		clearButton.addEventListener('click', () => postMessage({ type: 'clearScope', scope }));
		workspaceActions.appendChild(clearButton);

		const titleRow = document.createElement('header');
		titleRow.appendChild(workspaceTitle);
		titleRow.appendChild(workspaceActions);

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
			empty.textContent = snapshot?.projects.emptyLabel ?? '';
			list.appendChild(empty);
		}

		attachDragHandlers(list, scope);
		workspaceWrapper.appendChild(list);
		container.appendChild(workspaceWrapper);
	});

	return container;
}

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

function renderTodoRow(scope: WebviewScope, todo: WebviewTodoState, inlineState: InlineState): HTMLElement {
	const row = document.createElement('div');
	row.className = 'todo-item';
	row.dataset.todoId = todo.id;
	row.draggable = true;

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
			if (input.value.trim().length === 0) {
				exitInlineEdit(scope);
			}
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

	const toggleButton = document.createElement('button');
	toggleButton.className = 'todo-action';
	toggleButton.title = snapshot?.strings.completeLabel ?? 'Toggle complete';
	toggleButton.innerHTML = todo.completed
		? '<svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor"><path d="M8 2C4.68629 2 2 4.68629 2 8C2 11.3137 4.68629 14 8 14C11.3137 14 14 11.3137 14 8" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/><path d="M14 8V4" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/><path d="M14 8H10" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg>'
		: '<svg width="16" height="16" viewBox="0 0 16 16" fill="none"><circle cx="8" cy="8" r="7" stroke="currentColor" stroke-width="1.5"/><path d="M5 8L7 10L11 6" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>';
	toggleButton.addEventListener('click', () => postMessage({
		type: 'toggleComplete',
		scope,
		todoId: todo.id,
	}));
	actions.appendChild(toggleButton);

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

function cancelInlineCreate(scope: WebviewScope): void {
	const state = getInlineState(scope);
	state.creating = false;
	persistInlineState();
	render();
}

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

function exitInlineEdit(scope: WebviewScope): void {
	const state = getInlineState(scope);
	state.editingId = undefined;
	persistInlineState();
	render();
}

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

function attachDragHandlers(list: HTMLElement, scope: WebviewScope): void {
	let draggedId: string | undefined;
	list.addEventListener('dragstart', (event) => {
		const item = (event.target as HTMLElement | null)?.closest<HTMLElement>('.todo-item');
		if (!item || !item.dataset.todoId) {
			return;
		}
		draggedId = item.dataset.todoId;
		event.dataTransfer?.setData('text/plain', draggedId);
	});
	list.addEventListener('dragover', (event) => {
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
		const target = (event.target as HTMLElement | null)?.closest<HTMLElement>('.todo-item');
		target?.classList.remove('drag-over');
	});
	list.addEventListener('drop', (event) => {
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

function queueFocusSelector(selector: string): void {
	pendingFocusSelectors.add(selector);
}

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

function getScopeKey(scope: WebviewScope): string {
	return scope.scope === 'global' ? 'global' : scope.workspaceFolder;
}

function postMessage(message: ExtensionMessage): void {
	vscode.postMessage(message);
}
