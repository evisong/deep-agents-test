# deep-agents-test

A LangChain Deep Agents project in TypeScript — a personal assistant with planning, research, Google Calendar, and internet search capabilities.

## Prerequisites

- Node.js 18+
- An API key from a model provider (Anthropic, OpenAI, Google, etc.)
- A [Tavily](https://tavily.com/) API key for web search
- A Google Calendar service account JSON key for calendar operations (see [Google Cloud setup](#google-calendar-setup))

## Setup

```bash
npm install
cp .env.example .env
# Edit .env with your API keys
npm start
```

Open `http://localhost:3000/ui` in your browser.

## Architecture

### Agent Framework

Built on [deepagents](https://github.com/langchain-ai/deepagentsjs) (LangChain Deep Agents SDK). `createDeepAgent()` wires up the model, tools, middleware, and backend into a single agent instance.

### Model Provider

Uses **ZhipuAI GLM-5** via its OpenAI-compatible API. The `ChatOpenAI` adapter from `@langchain/openai` is configured with a custom `baseURL`. Since deepagents internal middleware (summarization, etc.) creates its own OpenAI client, the `OPENAI_API_KEY` and `OPENAI_API_BASE` env vars are mapped from `ZAI_API_KEY` at startup so all internal components use the same provider.

### Tools

- **`internet_search`** — Web search via Tavily
- **Google Calendar CRUD** — `list_events`, `create_event`, `update_event`, `delete_event` via `googleapis`
- **Built-in filesystem tools** — Provided by deepagents middleware for reading/writing files

### Backend: CompositeBackend

Two storage backends are composed via `CompositeBackend`:

| Route | Backend | Persistence | Purpose |
|---|---|---|---|
| `/memories/` | `FilesystemBackend` (virtualMode) | Disk (`memories/` dir) | Agent memory files |
| everything else | `StateBackend` | In-memory (per thread) | Working files, ephemeral data |

**Why virtualMode?** The `CompositeBackend` strips route prefixes before passing keys to the backend. For `/memories/AGENTS.md`, the backend receives `/AGENTS.md` — an absolute path. Without `virtualMode`, `FilesystemBackend` would try to read from the filesystem root. With `virtualMode: true`, all paths are treated as relative to `rootDir`.

### Memory System

Two types of memory coexist:

- **Memory files** (`/memories/AGENTS.md`, `/memories/preferences.md`) — Loaded by the memory middleware at session start and injected into the system prompt. The agent can update them via its filesystem tools. Files persist on disk across restarts.
- **Chat history** — Persisted via `MemorySaver` checkpointer. Each WebSocket connection gets a unique `threadId`; the checkpointer automatically saves/restores conversation state between invokes within the same session.

### Memory File Seeding

`src/memories/` contains template memory files (version-controlled). On first run, if `memories/` doesn't exist, the entire directory is copied from `src/memories/`. On subsequent runs, the existing `memories/` is used (preserving agent-written changes).

### Background Task Queue

A `BackgroundTaskQueue` runs queued tasks on a 30-second interval (1 second for the first tick). It:
- Starts on WebSocket connect, stops on disconnect
- Auto-stops after 10 minutes
- Shares the same `threadId` as the connection so task results appear in the same conversation history
- Events are forwarded to the browser via WebSocket

### WebSocket Server

- **Single client** — a new connection forcibly disconnects the previous one
- `/ui` — HTML page with chat panel and embedded Google Calendar iframe
- `/messages` — WebSocket endpoint; direct user messages invoke the agent immediately

### Google Calendar

Uses a **service account** for authentication. The `GOOGLE_CALENDAR_SERVICE_ACCOUNT_JSON` env var holds the full JSON key. The default calendar ID is configurable via `GOOGLE_CALENDAR_ID` env var.

## Environment Variables

| Variable | Required | Description |
|---|---|---|
| `ZAI_API_KEY` | Yes | ZhipuAI API key |
| `TAVILY_API_KEY` | Yes | Tavily search API key |
| `GOOGLE_CALENDAR_SERVICE_ACCOUNT_JSON` | Yes | Google Calendar service account JSON |
| `GOOGLE_CALENDAR_ID` | No | Calendar ID (default: `primary`) |

## Project Structure

```
src/
├── agent.ts              # Agent, model, backend, memory config
├── background_tasks.ts   # Background task queue with event system
├── index.ts              # Hono web server + WebSocket handler
├── memories/             # Template memory files (seeded to memories/ on first run)
│   ├── AGENTS.md         # Agent behavior & conventions
│   └── preferences.md   # User preferences
└── tools/
    └── google_calendar.ts  # Google Calendar CRUD tools
memories/                  # Runtime memory files (gitignored, persisted to disk)
public/
    └── ui.html            # Web UI with chat panel + calendar iframe
```

## Testing

```bash
# Unit tests (mocked Google Calendar API)
npm test

# Integration tests (live Google Calendar API)
npm run test:integration
```

## Learn More

- [Deep Agents Overview](https://docs.langchain.com/oss/javascript/deepagents/overview)
- [Deep Agents Quickstart](https://docs.langchain.com/oss/javascript/deepagents/quickstart)
- [deepagents on npm](https://www.npmjs.com/package/deepagents)
- [deepagentsjs on GitHub](https://github.com/langchain-ai/deepagentsjs)
