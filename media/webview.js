"use strict";
(() => {
  // src/webview/main.ts
  var vscode = acquireVsCodeApi();
  var _a;
  var viewMode = (_a = document.body.dataset.viewMode) != null ? _a : "global";
  var root = document.getElementById("root");
  var snapshot;
  var inlineGlobal = { creating: false, editingId: void 0 };
  var inlineWorkspaces = /* @__PURE__ */ new Map();
  var pendingFocusSelectors = /* @__PURE__ */ new Set();
  restoreInlineState();
  render();
  window.addEventListener("message", (event) => {
    const message = event.data;
    switch (message.type) {
      case "stateUpdate":
        handleStateUpdate(message.payload);
        break;
      case "startInlineCreate":
        handleStartInlineCreate(message.scope);
        break;
      case "startInlineEdit":
        handleStartInlineEdit(message.scope, message.todoId);
        break;
      default:
        break;
    }
  });
  vscode.postMessage({ type: "webviewReady", mode: viewMode });
  function handleStateUpdate(nextSnapshot) {
    snapshot = nextSnapshot;
    pruneInlineState();
    render();
  }
  function handleStartInlineCreate(scope) {
    if (!scopeAppliesToView(scope)) {
      return;
    }
    const inlineState = getInlineState(scope);
    inlineState.creating = true;
    inlineState.editingId = void 0;
    queueFocusSelector(`[data-inline-create="${getScopeKey(scope)}"]`);
    persistInlineState();
    render();
  }
  function handleStartInlineEdit(scope, todoId) {
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
  function scopeAppliesToView(scope) {
    if (viewMode === "global") {
      return scope.scope === "global";
    }
    return scope.scope === "workspace";
  }
  function restoreInlineState() {
    var _a2, _b;
    const stored = vscode.getState();
    if (!stored) {
      return;
    }
    Object.assign(inlineGlobal, (_a2 = stored.global) != null ? _a2 : { creating: false });
    Object.entries((_b = stored.workspaces) != null ? _b : {}).forEach(([key, state]) => {
      inlineWorkspaces.set(key, { creating: state.creating, editingId: state.editingId });
    });
  }
  function persistInlineState() {
    const serialized = {
      global: { ...inlineGlobal },
      workspaces: {}
    };
    inlineWorkspaces.forEach((state, key) => {
      serialized.workspaces[key] = { ...state };
    });
    vscode.setState(serialized);
  }
  function getInlineState(scope) {
    if (scope.scope === "global") {
      return inlineGlobal;
    }
    let state = inlineWorkspaces.get(scope.workspaceFolder);
    if (!state) {
      state = { creating: false };
      inlineWorkspaces.set(scope.workspaceFolder, state);
    }
    return state;
  }
  function pruneInlineState() {
    if (!snapshot) {
      return;
    }
    if (viewMode === "global") {
      if (inlineGlobal.editingId && !snapshot.global.todos.some((todo) => todo.id === inlineGlobal.editingId)) {
        inlineGlobal.editingId = void 0;
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
      const folder = snapshot == null ? void 0 : snapshot.projects.folders.find((item) => item.key === key);
      if (!folder) {
        return;
      }
      if (state.editingId && !folder.todos.some((todo) => todo.id === state.editingId)) {
        state.editingId = void 0;
      }
    });
  }
  function render() {
    if (!snapshot) {
      root.innerHTML = '<p class="empty-state">Waiting for TODOs\u2026</p>';
      return;
    }
    root.innerHTML = "";
    if (viewMode === "global") {
      root.appendChild(renderScopeSection(snapshot.global, { scope: "global" }));
    } else {
      root.appendChild(renderProjectsSection(snapshot.projects));
    }
    applyPendingFocus();
  }
  function renderScopeSection(state, scope) {
    const section = document.createElement("section");
    section.className = "todo-section";
    const list = document.createElement("div");
    list.className = "todo-list";
    const inlineState = getInlineState(scope);
    if (inlineState.creating) {
      list.appendChild(renderInlineCreateRow(scope));
    }
    state.todos.forEach((todo) => {
      list.appendChild(renderTodoRow(scope, todo, inlineState));
    });
    if (state.todos.length === 0 && !inlineState.creating) {
      const empty = document.createElement("p");
      empty.className = "empty-state";
      empty.textContent = state.emptyLabel;
      list.appendChild(empty);
    }
    attachDragHandlers(list, scope);
    section.appendChild(list);
    return section;
  }
  function renderProjectsSection(projects) {
    const container = document.createElement("section");
    container.className = "todo-section";
    if (projects.folders.length === 0) {
      const empty = document.createElement("p");
      empty.className = "empty-state";
      empty.textContent = projects.emptyLabel;
      container.appendChild(empty);
      return container;
    }
    projects.folders.forEach((folder) => {
      var _a2;
      const scope = { scope: "workspace", workspaceFolder: folder.key };
      const inlineState = getInlineState(scope);
      const workspaceWrapper = document.createElement("div");
      workspaceWrapper.className = "workspace-section";
      const workspaceTitle = document.createElement("div");
      workspaceTitle.className = "workspace-title";
      workspaceTitle.textContent = folder.label;
      const workspaceActions = document.createElement("div");
      workspaceActions.className = "section-actions";
      const addButton = document.createElement("button");
      addButton.className = "button-link";
      addButton.innerHTML = "<span>Add</span>";
      addButton.addEventListener("click", () => startInlineCreate(scope));
      workspaceActions.appendChild(addButton);
      const clearButton = document.createElement("button");
      clearButton.className = "button-link";
      clearButton.innerHTML = "<span>Clear</span>";
      clearButton.addEventListener("click", () => postMessage({ type: "clearScope", scope }));
      workspaceActions.appendChild(clearButton);
      const titleRow = document.createElement("div");
      titleRow.style.display = "flex";
      titleRow.style.justifyContent = "space-between";
      titleRow.style.alignItems = "center";
      titleRow.appendChild(workspaceTitle);
      titleRow.appendChild(workspaceActions);
      workspaceWrapper.appendChild(titleRow);
      const list = document.createElement("div");
      list.className = "todo-list";
      if (inlineState.creating) {
        list.appendChild(renderInlineCreateRow(scope));
      }
      folder.todos.forEach((todo) => {
        list.appendChild(renderTodoRow(scope, todo, inlineState));
      });
      if (folder.todos.length === 0 && !inlineState.creating) {
        const empty = document.createElement("p");
        empty.className = "empty-state";
        empty.textContent = (_a2 = snapshot == null ? void 0 : snapshot.projects.emptyLabel) != null ? _a2 : "";
        list.appendChild(empty);
      }
      attachDragHandlers(list, scope);
      workspaceWrapper.appendChild(list);
      container.appendChild(workspaceWrapper);
    });
    return container;
  }
  function renderInlineCreateRow(scope) {
    var _a2, _b;
    const row = document.createElement("div");
    row.className = "todo-item inline-create";
    const input = document.createElement("input");
    input.className = "todo-input";
    input.placeholder = (_a2 = snapshot == null ? void 0 : snapshot.strings.addPlaceholder) != null ? _a2 : "Type a TODO";
    input.dataset.inlineCreate = getScopeKey(scope);
    input.addEventListener("keydown", (event) => {
      if (event.key === "Enter") {
        event.preventDefault();
        commitInlineCreate(scope, input.value);
      }
      if (event.key === "Escape") {
        event.preventDefault();
        cancelInlineCreate(scope);
      }
    });
    input.addEventListener("blur", () => {
      const value = input.value.trim();
      if (value.length === 0) {
        cancelInlineCreate(scope);
      }
    });
    row.appendChild(input);
    const hint = document.createElement("small");
    hint.className = "inline-hint";
    hint.textContent = (_b = snapshot == null ? void 0 : snapshot.strings.inlineCreateHint) != null ? _b : "";
    row.appendChild(hint);
    return row;
  }
  function renderTodoRow(scope, todo, inlineState) {
    var _a2, _b;
    const row = document.createElement("div");
    row.className = "todo-item";
    row.dataset.todoId = todo.id;
    row.draggable = true;
    if (inlineState.editingId === todo.id) {
      const input = document.createElement("input");
      input.className = "todo-input";
      input.value = todo.title;
      input.dataset.inlineEdit = todo.id;
      input.addEventListener("keydown", (event) => {
        if (event.key === "Enter") {
          event.preventDefault();
          commitInlineEdit(scope, todo.id, input.value);
        }
        if (event.key === "Escape") {
          event.preventDefault();
          exitInlineEdit(scope);
        }
      });
      input.addEventListener("blur", () => {
        if (input.value.trim().length === 0) {
          exitInlineEdit(scope);
        }
      });
      row.appendChild(input);
    } else {
      const title = document.createElement("span");
      title.className = `todo-title${todo.completed ? " completed" : ""}`;
      title.textContent = todo.title;
      title.addEventListener("dblclick", () => startInlineEdit(scope, todo.id));
      row.appendChild(title);
    }
    const actions = document.createElement("div");
    actions.className = "todo-actions";
    const toggleButton = document.createElement("button");
    toggleButton.className = "todo-action";
    toggleButton.title = (_a2 = snapshot == null ? void 0 : snapshot.strings.completeLabel) != null ? _a2 : "Toggle complete";
    toggleButton.innerHTML = todo.completed ? '<svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor"><path d="M8 2C4.68629 2 2 4.68629 2 8C2 11.3137 4.68629 14 8 14C11.3137 14 14 11.3137 14 8" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/><path d="M14 8V4" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/><path d="M14 8H10" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg>' : '<svg width="16" height="16" viewBox="0 0 16 16" fill="none"><circle cx="8" cy="8" r="7" stroke="currentColor" stroke-width="1.5"/><path d="M5 8L7 10L11 6" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>';
    toggleButton.addEventListener("click", () => postMessage({
      type: "toggleComplete",
      scope,
      todoId: todo.id
    }));
    actions.appendChild(toggleButton);
    const editButton = document.createElement("button");
    editButton.className = "todo-action";
    editButton.innerHTML = '<svg width="16" height="16" viewBox="0 0 16 16" fill="none"><path transform="translate(0, 2)" d="M12.5 3.5L10 1L3 8V10.5H5.5L12.5 3.5Z" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>';
    editButton.title = "Edit";
    editButton.addEventListener("click", () => startInlineEdit(scope, todo.id));
    actions.appendChild(editButton);
    const removeButton = document.createElement("button");
    removeButton.className = "todo-action";
    removeButton.innerHTML = '<svg width="16" height="16" viewBox="0 0 16 16" fill="none"><path d="M4 4L12 12M12 4L4 12" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg>';
    removeButton.title = (_b = snapshot == null ? void 0 : snapshot.strings.removeLabel) != null ? _b : "Remove";
    removeButton.addEventListener("click", () => postMessage({
      type: "removeTodo",
      scope,
      todoId: todo.id
    }));
    actions.appendChild(removeButton);
    row.appendChild(actions);
    return row;
  }
  function startInlineCreate(scope) {
    if (!scopeAppliesToView(scope)) {
      return;
    }
    const state = getInlineState(scope);
    state.creating = true;
    state.editingId = void 0;
    queueFocusSelector(`[data-inline-create="${getScopeKey(scope)}"]`);
    persistInlineState();
    render();
  }
  function cancelInlineCreate(scope) {
    const state = getInlineState(scope);
    state.creating = false;
    persistInlineState();
    render();
  }
  function commitInlineCreate(scope, value) {
    const trimmed = value.trim();
    if (trimmed.length === 0) {
      cancelInlineCreate(scope);
      return;
    }
    postMessage({ type: "commitCreate", scope, title: trimmed });
    const state = getInlineState(scope);
    state.creating = false;
    persistInlineState();
  }
  function startInlineEdit(scope, todoId) {
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
  function exitInlineEdit(scope) {
    const state = getInlineState(scope);
    state.editingId = void 0;
    persistInlineState();
    render();
  }
  function commitInlineEdit(scope, todoId, value) {
    const trimmed = value.trim();
    if (trimmed.length === 0) {
      exitInlineEdit(scope);
      return;
    }
    postMessage({ type: "commitEdit", scope, todoId, title: trimmed });
    const state = getInlineState(scope);
    state.editingId = void 0;
    persistInlineState();
  }
  function attachDragHandlers(list, scope) {
    let draggedId;
    list.addEventListener("dragstart", (event) => {
      var _a2, _b;
      const item = (_a2 = event.target) == null ? void 0 : _a2.closest(".todo-item");
      if (!item || !item.dataset.todoId) {
        return;
      }
      draggedId = item.dataset.todoId;
      (_b = event.dataTransfer) == null ? void 0 : _b.setData("text/plain", draggedId);
    });
    list.addEventListener("dragover", (event) => {
      var _a2;
      if (!draggedId) {
        return;
      }
      const target = (_a2 = event.target) == null ? void 0 : _a2.closest(".todo-item");
      if (!target || !target.dataset.todoId || target.dataset.todoId === draggedId) {
        return;
      }
      event.preventDefault();
      target.classList.add("drag-over");
    });
    list.addEventListener("dragleave", (event) => {
      var _a2;
      const target = (_a2 = event.target) == null ? void 0 : _a2.closest(".todo-item");
      target == null ? void 0 : target.classList.remove("drag-over");
    });
    list.addEventListener("drop", (event) => {
      var _a2;
      event.preventDefault();
      const target = (_a2 = event.target) == null ? void 0 : _a2.closest(".todo-item");
      if (!target || !target.dataset.todoId || !draggedId || target.dataset.todoId === draggedId) {
        resetDragState(list);
        return;
      }
      const draggedNode = list.querySelector(`.todo-item[data-todo-id="${draggedId}"]`);
      if (!draggedNode) {
        resetDragState(list);
        return;
      }
      const targetRect = target.getBoundingClientRect();
      const before = event.clientY < targetRect.top + targetRect.height / 2;
      list.insertBefore(draggedNode, before ? target : target.nextElementSibling);
      const order = Array.from(list.querySelectorAll(".todo-item")).map((node) => node.dataset.todoId).filter((id) => Boolean(id));
      postMessage({ type: "reorderTodos", scope, order });
      resetDragState(list);
    });
    list.addEventListener("dragend", () => {
      resetDragState(list);
    });
    function resetDragState(container) {
      draggedId = void 0;
      container.querySelectorAll(".drag-over").forEach((el) => el.classList.remove("drag-over"));
    }
  }
  function queueFocusSelector(selector) {
    pendingFocusSelectors.add(selector);
  }
  function applyPendingFocus() {
    if (pendingFocusSelectors.size === 0) {
      return;
    }
    const selectors = Array.from(pendingFocusSelectors.values());
    pendingFocusSelectors.clear();
    requestAnimationFrame(() => {
      selectors.forEach((selector) => {
        const element = document.querySelector(selector);
        if (element) {
          element.focus();
          element.setSelectionRange(element.value.length, element.value.length);
        }
      });
    });
  }
  function getScopeKey(scope) {
    return scope.scope === "global" ? "global" : scope.workspaceFolder;
  }
  function postMessage(message) {
    vscode.postMessage(message);
  }
})();
//# sourceMappingURL=webview.js.map
