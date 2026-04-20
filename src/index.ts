import { Hono } from "hono";
import { serve } from "@hono/node-server";
import { createNodeWebSocket } from "@hono/node-ws";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { agent, backgroundAgent } from "./agent.js";
import { ProactiveCron } from "./proactive_cron.js";
import { randomUUID } from "node:crypto";

const __dirname = dirname(fileURLToPath(import.meta.url));

// --- Web Server ---

const app = new Hono();

app.get("/ui", async (c) => {
  const html = await readFile(join(__dirname, "..", "public", "ui.html"), "utf-8");
  return c.html(html);
});

const { injectWebSocket, upgradeWebSocket } = createNodeWebSocket({ app });

// --- Proactive cron job ---
export const proactiveCron = new ProactiveCron(backgroundAgent);

// Console logger (always active)
proactiveCron.onEvent(({ type, result, error }) => {
  switch (type) {
    case "running":
      console.log("▶ Proactive cron: checking tasks...");
      break;
    case "done":
      console.log(`✔ Proactive cron: ${result}`);
      break;
    case "error":
      console.error(`✘ Proactive cron error: ${error}`);
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
        proactiveCron.stop();
      }
      currentWs = ws as unknown as typeof currentWs;
      currentThreadId = randomUUID();
      const send = (obj: Record<string, unknown>) => ws.send(JSON.stringify(obj));
      send({ type: "status", text: "Connected. Send a query to begin." });

      // Forward cron events to this client
      const unsub = proactiveCron.onEvent(({ type, result, error }) => {
        if (type === "running") {
          send({ type: "status", text: "▶ Checking proactive tasks..." });
        } else if (type === "done") {
          if (result === "Cron auto-stopped after timeout") {
            send({ type: "status", text: "⏱ Proactive cron auto-stopped" });
          } else {
            if (result && result.trim() !== "PASS") {
              send({ type: "result", query: "Proactive Tasks", text: result ?? "" });
            }
            send({ type: "status", text: "✔ Proactive tasks completed" });
          }
        } else if (type === "error") {
          send({ type: "error", query: "Proactive Tasks", text: error ?? "Unknown error" });
        }
      });

      // Start cron, auto-stop after 3 minutes
      proactiveCron.setConfigurable({ thread_id: currentThreadId });
      proactiveCron.start(20_000, 3 * 60 * 1_000);

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
        proactiveCron.stop();
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
