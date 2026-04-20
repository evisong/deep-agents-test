import { tool, createMiddleware } from "langchain";
import { TavilySearch } from "@langchain/tavily";
import { ChatOpenAI } from "@langchain/openai";
import { z } from "zod";
import {
  createDeepAgent,
  CompositeBackend,
  StateBackend,
  FilesystemBackend,
} from "deepagents";
import { MemorySaver } from "@langchain/langgraph";
import { listEvents, createEvent, updateEvent, deleteEvent } from "./tools/google_calendar.js";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { cpSync } from "node:fs";

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

// --- Model ---

export const model = new ChatOpenAI({
  model: "glm-5",
  apiKey: process.env.ZAI_API_KEY,
  configuration: {
    baseURL: "https://open.bigmodel.cn/api/paas/v4/",
  },
});

// --- Agent ---

const systemPrompt = `You are a helpful assistant with research and calendar management capabilities.

Current date and time: ${new Date().toLocaleString("zh-CN", { timeZone: "Asia/Shanghai" })}
Timezone: Asia/Shanghai

## \`internet_search\`

Use this to run an internet search for a given query. You can specify the max number of results to return, the topic, and whether raw content should be included.

## Google Calendar Tools

You can manage Google Calendar events using the following tools:
- \`list_events\` — List events from a calendar within an optional time range.
- \`create_event\` — Create a new event (requires summary, start, and end).
- \`update_event\` — Update an existing event by its ID. Only provided fields are changed.
- \`delete_event\` — Delete an event by its ID. This cannot be undone.
All datetime values should be in ISO 8601 format (e.g. "2026-04-20T09:00:00Z"). Use the event ID returned by list_events or create_event when updating or deleting.

Keep your responses concise, avoid using markdown formatting.`;

// --- Memory: persist to filesystem ---

export const checkpointer = new MemorySaver();

const memoryDir = join(__dirname, "..", "memories");
const srcMemoriesDir = join(__dirname, "memories");

cpSync(srcMemoriesDir, memoryDir, { recursive: true, force: true });

const backend = new CompositeBackend(new StateBackend(), {
  "/memories/": new FilesystemBackend({ rootDir: join(__dirname, "..", "memories"), virtualMode: true }),
});

// --- Proactive Planner Agent (lightweight, no queue) ---

const proactivePlannerPrompt = `You are a proactive planner. When invoked, you should:

1. Read /memories/preferences.md to understand the user's current preferences.
2. Read /memories/proactive_tasks.md to see what proactive tasks already exist.
3. Compare: are there new preferences in preferences.md that don't have corresponding proactive tasks?
  - If yes, think whether you can make any proactive tasks to meet the new preferences?
    - If yes, append a new section to /memories/proactive_tasks.md, use the preference text as heading and list the proactive tasks needed.
4. If any section in proactive_tasks.md is no longer relevant to the current preferences, remove it.
5. If all preferences are already covered, do nothing.

Keep task descriptions concise and actionable. The tasks will be executed by a background agent with calendar access.`;

const proactivePlanner = createDeepAgent({
  model,
  systemPrompt: proactivePlannerPrompt,
  backend,
  memory: ["/memories/SOUL.md", "/memories/AGENTS.md", "/memories/preferences.md"],
});

// --- Proactive trigger middleware ---

const proactiveTriggerMiddleware = createMiddleware({
  name: "ProactiveTriggerMiddleware",
  wrapToolCall: async (request, handler) => {
    const result = await handler(request);
    const { name, args } = request.toolCall;
    if (
      (name === "write_file" || name === "edit_file") &&
      String(args.file_path).includes("preferences.md")
    ) {
      // Fire-and-forget: don't block the main agent's response
      proactivePlanner.invoke({
        messages: [{ role: "user", content: "Check for new preferences and update proactive tasks." }],
      }).catch(() => {});
    }
    return result;
  },
});

export const agent = createDeepAgent({
  model,
  tools: [internetSearch, listEvents, createEvent, updateEvent, deleteEvent],
  systemPrompt,
  checkpointer,
  backend,
  middleware: [proactiveTriggerMiddleware],
  memory: ["/memories/SOUL.md", "/memories/AGENTS.md", "/memories/preferences.md"],
});

// --- Background Task Agent (no search, different system prompt) ---

const backgroundSystemPrompt = `You are a proactive background assistant. You handle scheduled and queued tasks autonomously.
You have access to Google Calendar tools. Use them to manage events as instructed.

Current date and time: ${new Date().toLocaleString("zh-CN", { timeZone: "Asia/Shanghai" })}
Timezone: Asia/Shanghai

Keep your responses concise, keep it in one paragraph, avoid using markdown formatting.
When you perform an action (e.g. create/update/delete an event), briefly confirm what you did.
When you don't perform any action, and nothing special to report, return a single word "PASS".`;

export const backgroundAgent = createDeepAgent({
  model,
  tools: [listEvents, createEvent, updateEvent, deleteEvent],
  systemPrompt: backgroundSystemPrompt,
  checkpointer,
  backend,
  memory: ["/memories/SOUL.md", "/memories/AGENTS.md", "/memories/preferences.md", "/memories/proactive_tasks.md"],
});
