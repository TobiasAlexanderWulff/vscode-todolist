import * as l10n from '@vscode/l10n';
import * as vscode from 'vscode';

import { Todo } from './types';
import { TodoRepository } from './todoRepository';

export type TreeNode = GlobalRootNode | ProjectsRootNode | WorkspaceFolderNode | TodoNode;

export interface GlobalRootNode {
	kind: 'globalRoot';
}

export interface ProjectsRootNode {
	kind: 'projectsRoot';
}

export interface WorkspaceFolderNode {
	kind: 'workspace';
	folder: vscode.WorkspaceFolder;
}

export interface TodoNode {
	kind: 'todo';
	todo: Todo;
}

const TREE_ID = 'todoView';
const TREE_MIME = 'application/vnd.code.tree.todoview';

export class TodoTreeDataProvider implements vscode.TreeDataProvider<TreeNode>, vscode.Disposable {
	private readonly _onDidChangeTreeData = new vscode.EventEmitter<TreeNode | void>();
	private readonly workspaceDisposable: vscode.Disposable;
	private readonly dndController: TodoTreeDragAndDropController;

	constructor(private readonly repository: TodoRepository) {
		this.workspaceDisposable = vscode.workspace.onDidChangeWorkspaceFolders(() => this.refresh());
		this.dndController = new TodoTreeDragAndDropController(this.repository, this);
	}

	get onDidChangeTreeData(): vscode.Event<TreeNode | void> {
		return this._onDidChangeTreeData.event;
	}

	get dragAndDropController(): vscode.TreeDragAndDropController<TreeNode> {
		return this.dndController;
	}

	refresh(node?: TreeNode): void {
		this._onDidChangeTreeData.fire(node);
	}

	dispose(): void {
		this.workspaceDisposable.dispose();
		this._onDidChangeTreeData.dispose();
		this.dndController.dispose();
	}

	getTreeItem(element: TreeNode): vscode.TreeItem {
		switch (element.kind) {
			case 'globalRoot': {
				const item = new vscode.TreeItem(
					l10n.t('tree.global.label', 'Global'),
					vscode.TreeItemCollapsibleState.Expanded
				);
				item.contextValue = 'todo:globalRoot';
				const count = this.repository.getGlobalTodos().length;
				item.description = l10n.t('tree.todo.count', '{0} TODOs', count);
				return item;
			}
			case 'projectsRoot': {
				const item = new vscode.TreeItem(
					l10n.t('tree.projects.label', 'Projects'),
					vscode.TreeItemCollapsibleState.Expanded
				);
				item.contextValue = 'todo:projectsRoot';
				const folders = vscode.workspace.workspaceFolders ?? [];
				item.description =
					folders.length === 0
						? l10n.t('tree.projects.empty', 'Open a folder to track project TODOs')
						: l10n.t('tree.projects.count', '{0} folders', folders.length);
				return item;
			}
			case 'workspace': {
				const item = new vscode.TreeItem(
					element.folder.name,
					vscode.TreeItemCollapsibleState.Collapsed
				);
				item.contextValue = 'todo:workspaceFolder';
				const todos = this.repository.getWorkspaceTodos(element.folder.uri.toString());
				item.description = l10n.t('tree.todo.count', '{0} TODOs', todos.length);
				return item;
			}
			case 'todo': {
				const item = new vscode.TreeItem(element.todo.title, vscode.TreeItemCollapsibleState.None);
				item.contextValue =
					element.todo.scope === 'global' ? 'todo:globalItem' : 'todo:workspaceItem';
				item.tooltip = element.todo.completed
					? l10n.t('tree.todo.completedTooltip', 'Completed at {0}', element.todo.updatedAt)
					: undefined;
				item.iconPath = new vscode.ThemeIcon(
					element.todo.completed ? 'check' : 'circle-large-outline'
				);
				item.description = element.todo.completed
					? l10n.t('tree.todo.completedLabel', 'Completed')
					: undefined;
				item.id =
					element.todo.scope === 'global'
						? `global:${element.todo.id}`
						: `workspace:${element.todo.workspaceFolder}:${element.todo.id}`;
				return item;
			}
		}
	}

	getChildren(element?: TreeNode): TreeNode[] {
		if (!element) {
			return [{ kind: 'globalRoot' }, { kind: 'projectsRoot' }];
		}
		switch (element.kind) {
			case 'globalRoot':
				return this.repository
					.getGlobalTodos()
					.sort((a, b) => a.position - b.position)
					.map((todo) => ({ kind: 'todo', todo }));
			case 'projectsRoot':
				return (vscode.workspace.workspaceFolders ?? []).map((folder) => ({
					kind: 'workspace',
					folder,
				}));
			case 'workspace':
				return this.repository
					.getWorkspaceTodos(element.folder.uri.toString())
					.sort((a, b) => a.position - b.position)
					.map((todo) => ({ kind: 'todo', todo }));
			case 'todo':
				return [];
		}
	}

	getParent(element: TreeNode): TreeNode | undefined {
		if (element.kind === 'todo') {
			if (element.todo.scope === 'global') {
				return { kind: 'globalRoot' };
			}
			const folder = this.getWorkspaceFolderByKey(element.todo.workspaceFolder);
			if (folder) {
				return { kind: 'workspace', folder };
			}
			return { kind: 'projectsRoot' };
		}
		if (element.kind === 'workspace') {
			return { kind: 'projectsRoot' };
		}
		return undefined;
	}

	getWorkspaceFolderByKey(key?: string): vscode.WorkspaceFolder | undefined {
		if (!key) {
			return undefined;
		}
		return (vscode.workspace.workspaceFolders ?? []).find(
			(folder) => folder.uri.toString() === key
		);
	}
}

interface DragPayload {
	id: string;
	scope: 'global' | 'workspace';
	workspaceFolder?: string;
}

class TodoTreeDragAndDropController
	implements vscode.TreeDragAndDropController<TreeNode>, vscode.Disposable
{
	readonly dropMimeTypes = [TREE_MIME];
	readonly dragMimeTypes = [TREE_MIME];

	constructor(
		private readonly repository: TodoRepository,
		private readonly provider: TodoTreeDataProvider
	) {}

	handleDrag(source: readonly TreeNode[], dataTransfer: vscode.DataTransfer): void {
		const payload: DragPayload[] = source
			.filter((node): node is TodoNode => node.kind === 'todo')
			.map((node) => ({
				id: node.todo.id,
				scope: node.todo.scope,
				workspaceFolder: node.todo.workspaceFolder,
			}));
		if (payload.length > 0) {
			dataTransfer.set(TREE_MIME, new vscode.DataTransferItem(payload));
		}
	}

	async handleDrop(target: TreeNode | undefined, dataTransfer: vscode.DataTransfer): Promise<void> {
		const transferItem = dataTransfer.get(TREE_MIME);
		if (!transferItem) {
			return;
		}
		const payload = transferItem.value as DragPayload[] | string;
		const [first] =
			Array.isArray(payload) && payload.length > 0
				? payload
				: JSON.parse(typeof payload === 'string' ? payload : '[]');
		if (!first) {
			return;
		}

		const scope = this.resolveScopeFromTarget(target);
		if (!scope || scope.scope !== first.scope || scope.workspaceFolder !== first.workspaceFolder) {
			return;
		}

		const todos =
			scope.scope === 'global'
				? this.repository.getGlobalTodos()
				: this.repository.getWorkspaceTodos(scope.workspaceFolder!);
		const draggedIndex = todos.findIndex((todo) => todo.id === first.id);
		if (draggedIndex < 0) {
			return;
		}
		const [dragged] = todos.splice(draggedIndex, 1);

		let insertIndex = todos.length;
		if (target && target.kind === 'todo') {
			insertIndex = todos.findIndex((todo) => todo.id === target.todo.id);
			if (insertIndex < 0) {
				insertIndex = todos.length;
			}
		}
		todos.splice(insertIndex, 0, dragged);
		const now = new Date().toISOString();
		todos.forEach((todo, index) => {
			todo.position = index + 1;
			if (todo.id === dragged.id) {
				todo.updatedAt = now;
			}
		});
		if (scope.scope === 'global') {
			await this.repository.saveGlobalTodos(todos);
		} else if (scope.workspaceFolder) {
			await this.repository.saveWorkspaceTodos(scope.workspaceFolder, todos);
		}
		this.provider.refresh();
	}

	private resolveScopeFromTarget(target?: TreeNode): { scope: 'global' | 'workspace'; workspaceFolder?: string } | undefined {
		if (!target) {
			return undefined;
		}
		if (target.kind === 'todo') {
			return { scope: target.todo.scope, workspaceFolder: target.todo.workspaceFolder };
		}
		if (target.kind === 'globalRoot') {
			return { scope: 'global' };
		}
		if (target.kind === 'workspace') {
			return { scope: 'workspace', workspaceFolder: target.folder.uri.toString() };
		}
		return undefined;
	}

	dispose(): void {
		// Nothing to dispose.
	}
}

export function getWorkspaceFolderKey(folder: vscode.WorkspaceFolder): string {
	return folder.uri.toString();
}
