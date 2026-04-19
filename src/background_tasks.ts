export interface Task {
  id: number;
  query: string;
  status: "queued" | "running" | "done";
}

export type TaskEventHandler = (event: {
  type: "queued" | "running" | "done" | "error";
  task: Task;
  result?: string;
  error?: string;
}) => void;

export class BackgroundTaskQueue {
  private queue: Task[] = [];
  private running = false;
  private nextId = 1;
  private timer: ReturnType<typeof setInterval> | null = null;
  private autoStopTimer: ReturnType<typeof setTimeout> | null = null;
  private handlers: TaskEventHandler[] = [];

  constructor(private agent: { invoke(args: { messages: Array<{ role: string; content: string }> }): Promise<{ messages: Array<{ content: unknown }> }> }) {}

  add(query: string): Task {
    const task: Task = { id: this.nextId++, query, status: "queued" };
    this.queue.push(task);
    const pos = this.queue.filter((t) => t.status === "queued").length;
    this.emit({ type: "queued", task, result: `Queued (${pos})` });
    return task;
  }

  private emit(event: Parameters<TaskEventHandler>[0]) {
    for (const h of this.handlers) h(event);
  }

  /** Add an event handler. Returns an unsubscribe function. */
  onEvent(handler: TaskEventHandler): () => void {
    this.handlers.push(handler);
    return () => {
      this.handlers = this.handlers.filter((h) => h !== handler);
    };
  }

  private async runTask(task: Task) {
    this.running = true;
    task.status = "running";
    this.emit({ type: "running", task });

    try {
      const result = await this.agent.invoke({
        messages: [{ role: "user", content: task.query }],
      });
      const last = result.messages[result.messages.length - 1];
      const content =
        typeof last.content === "string"
          ? last.content
          : JSON.stringify(last.content, null, 2);
      this.emit({ type: "done", task, result: content });
    } catch (err) {
      this.emit({
        type: "error",
        task,
        error: String((err as Error).message || err),
      });
    } finally {
      task.status = "done";
      this.queue.splice(this.queue.indexOf(task), 1);
      this.running = false;
    }
  }

  private tick() {
    if (this.running) return;
    const task = this.queue.find((t) => t.status === "queued");
    if (!task) return;
    this.runTask(task);
  }

  start(intervalMs = 30_000, autoStopMs?: number) {
    this.stop();
    this.timer = setInterval(() => this.tick(), intervalMs);
    if (autoStopMs) {
      this.autoStopTimer = setTimeout(() => {
        this.stop();
        this.emit({ type: "done", task: { id: 0, query: "", status: "done" }, result: "Queue auto-stopped after timeout" });
      }, autoStopMs);
    }
  }

  stop() {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
    if (this.autoStopTimer) {
      clearTimeout(this.autoStopTimer);
      this.autoStopTimer = null;
    }
    this.queue = [];
    this.running = false;
  }
}
