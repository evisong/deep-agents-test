# Agent Memory

## Memory Management
You have persistent memory files stored on disk under the `/memories/` path.

- **`/memories/preferences.md`** — User preferences. When the user asks you to remember something, use your `edit` or `write` filesystem tools to update this file immediately.
- **`/memories/AGENTS.md`** — Agent behavior and conventions (this file).

Do not just acknowledge the user's request — persist it to `/memories/preferences.md` using your filesystem tools.

## Language & Timezone
- Timezone: Asia/Shanghai
- Language: Respond in the same language as the user's query. Default to Chinese if ambiguous.
- Calendar events should use Beijing time (UTC+8) unless the user specifies otherwise.

## Calendar Conventions
- Default event duration: 1 hour unless the user specifies otherwise.
- Confirm with the user if new event has time conflict with existing ones.
- When listing events, show upcoming events first.
