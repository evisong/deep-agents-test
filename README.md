# deep-agents-test

A LangChain Deep Agents project in TypeScript — a personal assistant with planning, research, Google Calendar, and proactive task capabilities.

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

### Three-Agent Architecture

The system uses three specialized agents:

| Agent | Tools | Purpose |
|---|---|---|
| **Main agent** | internet_search, Google Calendar CRUD | Handles user conversations, research, and calendar management |
| **Proactive planner** | None (filesystem only) | Triggered by middleware when preferences change; plans proactive tasks |
| **Background agent** | Google Calendar CRUD | Executes proactive tasks on a cron schedule |

#### Main Agent

The primary agent users interact with via WebSocket. Has full tool access and a `ProactiveTriggerMiddleware` that detects writes to `preferences.md`.

#### Proactive Planner

A lightweight agent with no external tools. Invoked fire-and-forget by the middleware when the main agent writes to `preferences.md`. It:
1. Reads `preferences.md` and `proactive_tasks.md`
2. Checks if new preferences need corresponding proactive tasks
3. Appends to `proactive_tasks.md` if needed, or removes stale sections

#### Background Agent

Executes tasks listed in `proactive_tasks.md`. Has calendar CRUD tools but no internet search. Returns "PASS" when there are no tasks to execute.

### Proactive Task Flow

```
User tells agent a preference
  → Main agent writes to /memories/preferences.md
  → ProactiveTriggerMiddleware (wrapToolCall) detects the write
  → Fire-and-forget invoke to proactive planner
  → Proactive planner updates /memories/proactive_tasks.md
  → ProactiveCron reads proactive_tasks.md every 20s
  → If non-empty, invokes background agent to execute tasks
```

### Tools

- **`internet_search`** — Web search via Tavily
- **Google Calendar CRUD** — `list_events`, `create_event`, `update_event`, `delete_event` via `googleapis`. Uses `events.patch` (not `update`) to avoid accidental field loss.
- **Built-in filesystem tools** — Provided by deepagents middleware for reading/writing files

### Middleware

Custom middleware via `createMiddleware`:

- **`ProactiveTriggerMiddleware`** — Uses `wrapToolCall` to intercept `write_file`/`edit_file` calls. When the target is `preferences.md`, it fire-and-forget invokes the proactive planner agent.

### Backend: CompositeBackend

Two storage backends are composed via `CompositeBackend`:

| Route | Backend | Persistence | Purpose |
|---|---|---|---|
| `/memories/` | `FilesystemBackend` (virtualMode) | Disk (`memories/` dir) | Agent memory files |
| everything else | `StateBackend` | In-memory (per thread) | Working files, ephemeral data |

**Why virtualMode?** The `CompositeBackend` strips route prefixes before passing keys to the backend. For `/memories/AGENTS.md`, the backend receives `/AGENTS.md` — an absolute path. Without `virtualMode`, `FilesystemBackend` would try to read from the filesystem root. With `virtualMode: true`, all paths are treated as relative to `rootDir`.

### Memory System

Two types of memory coexist:

- **Memory files** (`/memories/SOUL.md`, `/memories/AGENTS.md`, `/memories/preferences.md`, `/memories/proactive_tasks.md`) — Loaded by the memory middleware at session start and injected into the system prompt. The agent can update them via its filesystem tools. Files persist on disk across restarts.
- **Chat history** — Persisted via `MemorySaver` checkpointer. Each WebSocket connection gets a unique `threadId`; the checkpointer automatically saves/restores conversation state between invokes within the same session. Main agent and background agent share the same checkpointer and thread ID.

### Memory File Seeding

`src/memories/` contains template memory files (version-controlled). On every startup, the entire directory is copied to `memories/` (overwriting existing files). This ensures template updates are always applied.

### Proactive Cron

A `ProactiveCron` runs on a periodic interval (20 seconds, 1 second for the first tick). It:
- Reads `memories/proactive_tasks.md` from disk (not from agent state)
- If the file has content beyond the heading, invokes the background agent
- Starts on WebSocket connect, stops on disconnect
- Auto-stops after 3 minutes
- Shares the same `threadId` as the connection so task results appear in the same conversation history
- Events are forwarded to the browser via WebSocket
- "PASS" responses from the background agent are silently ignored in the UI

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
├── agent.ts              # Three agents, model, backend, memory, middleware config
├── proactive_cron.ts     # Periodic cron that checks proactive_tasks.md and invokes background agent
├── index.ts              # Hono web server + WebSocket handler
├── memories/             # Template memory files (seeded to memories/ on every startup)
│   ├── SOUL.md           # Agent identity and personality
│   ├── AGENTS.md         # Agent behavior & conventions
│   ├── preferences.md    # User preferences
│   └── proactive_tasks.md # Proactive task definitions
└── tools/
    └── google_calendar.ts  # Google Calendar CRUD tools
memories/                  # Runtime memory files (gitignored, overwritten from src/memories/ on startup)
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
- [Deep Agents Subagents](https://docs.langchain.com/oss/javascript/deepagents/subagents)
- [Deep Agents Custom Middleware](https://docs.langchain.com/oss/javascript/deepagents/customization)
- [deepagents on npm](https://www.npmjs.com/package/deepagents)
- [deepagentsjs on GitHub](https://github.com/langchain-ai/deepagentsjs)
