import { Hono } from "hono";
import { serve } from "@hono/node-server";
import { createNodeWebSocket } from "@hono/node-ws";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { agent } from "./agent.js";
import { BackgroundTaskQueue } from "./background_tasks.js";
import { randomUUID } from "node:crypto";

const __dirname = dirname(fileURLToPath(import.meta.url));

// --- Web Server ---

const app = new Hono();

app.get("/ui", async (c) => {
  const html = await readFile(join(__dirname, "..", "public", "ui.html"), "utf-8");
  return c.html(html);
});

const { injectWebSocket, upgradeWebSocket } = createNodeWebSocket({ app });

// --- Background task queue (for programmatic use) ---
export const taskQueue = new BackgroundTaskQueue(agent);

// Console logger (always active)
taskQueue.onEvent(({ type, task, error }) => {
  switch (type) {
    case "queued":
      console.log(`+ Queued: "${task.query}"`);
      break;
    case "running":
      console.log(`▶ Running: "${task.query}"`);
      break;
    case "done":
      console.log(`✔ Done: "${task.query}"`);
      break;
    case "error":
      console.error(`✘ Error: "${task.query}" — ${error}`);
      break;
  }
});

// --- WebSocket (single client only) ---
let currentWs: { close(): void } | null = null;
let currentThreadId: string | null = null;

app.get(
  "/messages",
  upgradeWebSocket((c) => ({
    onOpen(event, ws) {
      // Kick previous client
      if (currentWs) {
        try { currentWs.close(); } catch {}
        taskQueue.stop();
      }
      currentWs = ws as unknown as typeof currentWs;
      currentThreadId = randomUUID();
      const send = (obj: Record<string, unknown>) => ws.send(JSON.stringify(obj));
      send({ type: "status", text: "Connected. Send a query to begin." });

      // Forward queue events to this client
      const unsub = taskQueue.onEvent(({ type, task, result, error }) => {
        if (type === "queued") {
          send({ type: "status", text: `+ ${result}: "${task.query}"` });
        } else if (type === "running") {
          send({ type: "status", text: `▶ Running: "${task.query}"` });
        } else if (type === "done") {
          if (task.id === 0) {
            send({ type: "status", text: `⏱ Queue auto-stopped` });
          } else {
            send({ type: "result", query: task.query, text: result ?? "" });
            send({ type: "status", text: `✔ Done: "${task.query}"` });
          }
        } else if (type === "error") {
          send({ type: "error", query: task.query, text: error ?? "Unknown error" });
        }
      });

      // Start queue, auto-stop after 10 minutes
      taskQueue.setConfigurable({ thread_id: currentThreadId });
      taskQueue.start(30_000, 10 * 60 * 1_000);

      // Add a test task
      taskQueue.add("Hello");

      // Store unsub for cleanup
      (ws as unknown as Record<string, unknown>).__unsub = unsub;
    },
    onMessage(event, ws) {
      let data: string;
      try {
        const parsed = JSON.parse(event.data as string);
        data = String(parsed.query);
      } catch {
        ws.send(JSON.stringify({ type: "error", text: "Invalid message format." }));
        return;
      }

      if (!data.trim()) {
        ws.send(JSON.stringify({ type: "error", text: "Empty query." }));
        return;
      }

      const q = data.trim();
      ws.send(JSON.stringify({ type: "status", text: `Processing: "${q}"` }));

      agent
        .invoke(
          { messages: [{ role: "user", content: q }] },
          { configurable: { thread_id: currentThreadId } },
        )
        .then((result) => {
          const last = result.messages[result.messages.length - 1];
          const content = typeof last.content === "string" ? last.content : JSON.stringify(last.content, null, 2);
          ws.send(JSON.stringify({ type: "result", query: q, text: content }));
        })
        .catch((err) => {
          ws.send(JSON.stringify({ type: "error", query: q, text: String(err.message || err) }));
        })
        .finally(() => {
          ws.send(JSON.stringify({ type: "status", text: `✔ Done: "${q}"` }));
        });
    },
    onClose(_evt, ws) {
      if (currentWs === (ws as unknown as typeof currentWs)) {
        currentWs = null;
        currentThreadId = null;
        ((ws as unknown as Record<string, unknown>).__unsub as (() => void) | undefined)?.();
        taskQueue.stop();
      }
    },
    onError(event) {
      console.error("WebSocket error:", event);
    },
  })),
);

const server = serve({ fetch: app.fetch, port: 3000 });
injectWebSocket(server);

console.log("Server running at http://localhost:3000");
console.log("UI: http://localhost:3000/ui");
