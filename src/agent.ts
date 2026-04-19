import { tool } from "langchain";
import { TavilySearch } from "@langchain/tavily";
import { ChatOpenAI } from "@langchain/openai";
import { z } from "zod";
import { createDeepAgent } from "deepagents";
import { listEvents, createEvent, updateEvent, deleteEvent } from "./tools/google_calendar.js";

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

Current date and time: ${new Date().toISOString()}
Timezone: ${Intl.DateTimeFormat().resolvedOptions().timeZone}

## \`internet_search\`

Use this to run an internet search for a given query. You can specify the max number of results to return, the topic, and whether raw content should be included.

## Google Calendar Tools

You can manage Google Calendar events using the following tools:

- \`list_events\` — List events from a calendar within an optional time range.
- \`create_event\` — Create a new event (requires summary, start, and end).
- \`update_event\` — Update an existing event by its ID. Only provided fields are changed.
- \`delete_event\` — Delete an event by its ID. This cannot be undone.

All datetime values should be in ISO 8601 format (e.g. "2026-04-20T09:00:00Z"). Use the event ID returned by list_events or create_event when updating or deleting.`;

export const agent = createDeepAgent({
  model,
  tools: [internetSearch, listEvents, createEvent, updateEvent, deleteEvent],
  systemPrompt,
});
