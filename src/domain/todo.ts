import { Todo } from '../types';

/**
 * Normalizes todo positions to be sequential starting at 1 while preserving order.
 *
 * @param todos - List of todos to normalize.
 * @returns A new array with stable ordering and compact positions.
 */
export function normalizePositions(todos: Todo[]): Todo[] {
	return [...todos]
		.sort((a, b) => a.position - b.position)
		.map((todo, index) => ({
			...todo,
			position: index + 1,
		}));
}

/**
 * Reorders todos in place based on a provided ID order. Unmapped items are appended.
 * Returns whether any positions changed.
 *
 * @param todos - Todos to reorder (mutated in place).
 * @param order - Ordered list of todo IDs from the drag-and-drop source.
 * @returns True if positions were changed, false otherwise.
 */
export function reorderTodosByOrder(todos: Todo[], order: string[]): boolean {
	const lookup = new Map<string, Todo>();
	todos.forEach((todo) => lookup.set(todo.id, todo));

	const newOrder: Todo[] = [];
	order.forEach((id) => {
		const todo = lookup.get(id);
		if (todo) {
			newOrder.push(todo);
			lookup.delete(id);
		}
	});
	lookup.forEach((todo) => newOrder.push(todo));

	let changed = false;
	const now = new Date().toISOString();
	newOrder.forEach((todo, index) => {
		const nextPosition = index + 1;
		if (todo.position !== nextPosition) {
			todo.position = nextPosition;
			todo.updatedAt = now;
			changed = true;
		}
	});

	// mutate original array order to match new order
	todos.splice(0, todos.length, ...newOrder);
	return changed;
}