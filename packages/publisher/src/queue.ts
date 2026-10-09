import type { PublishTask } from '@zemingengine/shared';

/**
 * In-memory publish queue for tracking active publishing tasks.
 * Works alongside the DB-backed publish_tasks table for persistence.
 */
export class PublishQueue {
  private tasks: Map<string, PublishTask> = new Map();
  private processing: Set<string> = new Set();

  enqueue(task: PublishTask): void {
    this.tasks.set(task.id, task);
  }

  dequeue(): PublishTask | undefined {
    const pending = this.getPending();
    if (pending.length === 0) return undefined;
    const task = pending[0];
    this.processing.add(task.id);
    return task;
  }

  getPending(): PublishTask[] {
    return Array.from(this.tasks.values()).filter(
      (t) => (t.status === 'pending' || t.status === 'retrying') && !this.processing.has(t.id),
    );
  }

  getTask(taskId: string): PublishTask | undefined {
    return this.tasks.get(taskId);
  }

  updateTask(taskId: string, updates: Partial<PublishTask>): void {
    const task = this.tasks.get(taskId);
    if (task) {
      this.tasks.set(taskId, { ...task, ...updates, updatedAt: new Date().toISOString() });
    }
  }

  remove(taskId: string): void {
    this.tasks.delete(taskId);
    this.processing.delete(taskId);
  }

  /** Mark a task as being actively processed. */
  markProcessing(taskId: string): void {
    this.processing.add(taskId);
  }

  /** Mark a task as done processing (success or failure). */
  markDone(taskId: string): void {
    this.processing.delete(taskId);
  }

  get size(): number {
    return this.tasks.size;
  }
}
