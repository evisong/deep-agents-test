import { tool } from "langchain";
import { TavilySearch } from "@langchain/tavily";
import { ChatOpenAI } from "@langchain/openai";
import { z } from "zod";
import { createDeepAgent } from "deepagents";
import { Hono } from "hono";
import { serve } from "@hono/node-server";
import { createNodeWebSocket } from "@hono/node-ws";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));

// ZhipuAI uses an OpenAI-compatible API — map env vars so that
// internal deepagents middleware (e.g. summarization) also uses ZhipuAI.
if (process.env.ZAI_API_KEY && !process.env.OPENAI_API_KEY) {
  process.env.OPENAI_API_KEY = process.env.ZAI_API_KEY;
  process.env.OPENAI_API_BASE = "https://open.bigmodel.cn/api/paas/v4/";
}

// --- Search Tool ---

const internetSearch = tool(
  async ({
    query,
    maxResults = 5,
    topic = "general",
    includeRawContent = false,
  }: {
    query: string;
    maxResults?: number;
    topic?: "general" | "news" | "finance";
    includeRawContent?: boolean;
  }) => {
    const tavilySearch = new TavilySearch({
      maxResults,
      tavilyApiKey: process.env.TAVILY_API_KEY,
      includeRawContent,
      topic,
    });
    return await tavilySearch._call({ query });
  },
  {
    name: "internet_search",
    description: "Run a web search",
    schema: z.object({
      query: z.string().describe("The search query"),
      maxResults: z
        .number()
        .optional()
        .default(5)
        .describe("Maximum number of results to return"),
      topic: z
        .enum(["general", "news", "finance"])
        .optional()
        .default("general")
        .describe("Search topic category"),
      includeRawContent: z
        .boolean()
        .optional()
        .default(false)
        .describe("Whether to include raw content"),
    }),
  },
);

// --- Agent ---

const researchInstructions = `You are an expert researcher. Your job is to conduct thorough research and then write a polished report.

You have access to an internet search tool as your primary means of gathering information.

## \`internet_search\`

Use this to run an internet search for a given query. You can specify the max number of results to return, the topic, and whether raw content should be included.`;

const model = new ChatOpenAI({
  model: "glm-5",
  apiKey: process.env.ZAI_API_KEY,
  configuration: {
    baseURL: "https://open.bigmodel.cn/api/paas/v4/",
  },
});

const agent = createDeepAgent({
  model,
  tools: [internetSearch],
  systemPrompt: researchInstructions,
});

// --- Web Server ---

const app = new Hono();

app.get("/ui", async (c) => {
  const html = await readFile(join(__dirname, "..", "public", "ui.html"), "utf-8");
  return c.html(html);
});

const { injectWebSocket, upgradeWebSocket } = createNodeWebSocket({ app });

app.get(
  "/messages",
  upgradeWebSocket((c) => ({
    onOpen(event, ws) {
      ws.send(JSON.stringify({ type: "status", text: "Connected. Send a query to begin." }));
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

      ws.send(
        JSON.stringify({
          type: "status",
          text: "Researching: " + data,
          cls: "",
        }),
      );

      agent
        .invoke({ messages: [{ role: "user", content: data }] })
        .then((result) => {
          const last =
            result.messages[result.messages.length - 1];
          const content =
            typeof last.content === "string"
              ? last.content
              : JSON.stringify(last.content, null, 2);
          ws.send(
            JSON.stringify({ type: "result", text: content }),
          );
        })
        .catch((err) => {
          ws.send(
            JSON.stringify({
              type: "error",
              text: String(err.message || err),
            }),
          );
        });
    },
    onClose() {
      // connection closed
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
