import { readFile } from "node:fs/promises";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const proactiveTasksPath = join(__dirname, "..", "memories", "proactive_tasks.md");

export type CronEventHandler = (event: {
  type: "running" | "done" | "error";
  result?: string;
  error?: string;
}) => void;

export class ProactiveCron {
  private timer: ReturnType<typeof setInterval> | null = null;
  private autoStopTimer: ReturnType<typeof setTimeout> | null = null;
  private running = false;
  private handlers: CronEventHandler[] = [];
  private configurable: Record<string, string> = {};

  constructor(
    private agent: {
      invoke(
        args: { messages: Array<{ role: string; content: string }> },
        options?: { configurable?: Record<string, string> },
      ): Promise<{ messages: Array<{ content: unknown }> }>;
    },
  ) {}

  setConfigurable(configurable: Record<string, string>) {
    this.configurable = configurable;
  }

  onEvent(handler: CronEventHandler): () => void {
    this.handlers.push(handler);
    return () => {
      this.handlers = this.handlers.filter((h) => h !== handler);
    };
  }

  private emit(event: Parameters<CronEventHandler>[0]) {
    for (const h of this.handlers) h(event);
  }

  private async tick() {
    if (this.running) return;

    try {
      const content = await readFile(proactiveTasksPath, "utf-8");
      // Strip the top-level heading and whitespace to check if there's actual content
      const body = content.replace(/^#\s+.*$/m, "").trim();
      if (!body) return;
    } catch {
      return; // File doesn't exist
    }

    this.running = true;
    this.emit({ type: "running" });

    try {
      const result = await this.agent.invoke(
        { messages: [{ role: "user", content: "Proceed with proactive tasks from /memories/proactive_tasks.md." }] },
        { configurable: this.configurable },
      );
      const last = result.messages[result.messages.length - 1];
      const text = typeof last.content === "string" ? last.content : JSON.stringify(last.content, null, 2);
      this.emit({ type: "done", result: text });
    } catch (err) {
      this.emit({ type: "error", error: String((err as Error).message || err) });
    } finally {
      this.running = false;
    }
  }

  start(intervalMs = 30_000, autoStopMs?: number) {
    this.stop();
    this.timer = setInterval(() => this.tick(), intervalMs);
    setTimeout(() => this.tick(), 1_000);
    if (autoStopMs) {
      this.autoStopTimer = setTimeout(() => {
        this.stop();
        this.emit({ type: "done", result: "Cron auto-stopped after timeout" });
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
    this.running = false;
  }
}
