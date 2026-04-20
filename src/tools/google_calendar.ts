import { google } from "googleapis";
import { tool } from "langchain";
import { z } from "zod";

const DEFAULT_CALENDAR_ID = process.env.GOOGLE_CALENDAR_ID || "primary";

// --- Auth helper ---

export function getCalendar() {
  const key = process.env.GOOGLE_CALENDAR_SERVICE_ACCOUNT_JSON;
  if (!key) throw new Error("GOOGLE_CALENDAR_SERVICE_ACCOUNT_JSON env var is not set");

  const auth = new google.auth.GoogleAuth({
    credentials: JSON.parse(key),
    scopes: ["https://www.googleapis.com/auth/calendar"],
  });
  return google.calendar({ version: "v3", auth });
}

// --- list_events ---

export const listEvents = tool(
  async ({
    calendarId = DEFAULT_CALENDAR_ID,
    timeMin,
    timeMax,
    maxResults = 10,
  }: {
    calendarId?: string;
    timeMin?: string;
    timeMax?: string;
    maxResults?: number;
  }) => {
    const cal = getCalendar();
    const res = await cal.events.list({
      calendarId,
      timeMin,
      timeMax,
      maxResults,
      singleEvents: true,
      orderBy: "startTime",
    });
    const events = res.data.items ?? [];
    if (events.length === 0) return "No events found.";
    return events
      .map((e) => {
        const start = e.start?.dateTime || e.start?.date || "?";
        const end = e.end?.dateTime || e.end?.date || "?";
        return `[${e.id}] ${start} → ${end} | ${e.summary || "(no title)"}` + (e.location ? ` @ ${e.location}` : "");
      })
      .join("\n");
  },
  {
    name: "list_events",
    description: "List events from a Google Calendar. Returns event IDs, times, titles, and locations.",
    schema: z.object({
      calendarId: z.string().optional().default(DEFAULT_CALENDAR_ID).describe(`Calendar ID (default: '${DEFAULT_CALENDAR_ID}')`),
      timeMin: z.string().optional().describe("Start of range as ISO datetime (e.g. '2026-04-19T00:00:00Z')"),
      timeMax: z.string().optional().describe("End of range as ISO datetime"),
      maxResults: z.number().optional().default(10).describe("Maximum events to return"),
    }),
  },
);

// --- create_event ---

export const createEvent = tool(
  async ({
    calendarId = DEFAULT_CALENDAR_ID,
    summary,
    description,
    start,
    end,
    location,
  }: {
    calendarId?: string;
    summary: string;
    description?: string;
    start: string;
    end: string;
    location?: string;
  }) => {
    const cal = getCalendar();
    const res = await cal.events.insert({
      calendarId,
      requestBody: {
        summary,
        description,
        start: { dateTime: start },
        end: { dateTime: end },
        location,
      },
    });
    const e = res.data;
    return `Created event [${e.id}]: ${e.summary} (${e.start?.dateTime} → ${e.end?.dateTime})`;
  },
  {
    name: "create_event",
    description: "Create a new Google Calendar event. Returns the event ID.",
    schema: z.object({
      calendarId: z.string().optional().default(DEFAULT_CALENDAR_ID).describe(`Calendar ID (default: '${DEFAULT_CALENDAR_ID}')`),
      summary: z.string().describe("Event title"),
      description: z.string().optional().describe("Event description"),
      start: z.string().describe("Start time as ISO datetime (e.g. '2026-04-20T09:00:00Z')"),
      end: z.string().describe("End time as ISO datetime"),
      location: z.string().optional().describe("Event location"),
    }),
  },
);

// --- update_event ---

export const updateEvent = tool(
  async ({
    calendarId = DEFAULT_CALENDAR_ID,
    eventId,
    summary,
    description,
    start,
    end,
    location,
  }: {
    calendarId?: string;
    eventId: string;
    summary?: string;
    description?: string;
    start?: string;
    end?: string;
    location?: string;
  }) => {
    const cal = getCalendar();

    // Build patch body with only provided fields
    const body: Record<string, unknown> = {};
    if (summary !== undefined) body.summary = summary;
    if (description !== undefined) body.description = description;
    if (start !== undefined) body.start = { dateTime: start };
    if (end !== undefined) body.end = { dateTime: end };
    if (location !== undefined) body.location = location;

    const res = await cal.events.patch({
      calendarId,
      eventId,
      requestBody: body,
    });
    const e = res.data;
    return `Updated event [${e.id}]: ${e.summary} (${e.start?.dateTime} → ${e.end?.dateTime})`;
  },
  {
    name: "update_event",
    description: "Update an existing Google Calendar event by its ID. Only provided fields will be changed.",
    schema: z.object({
      calendarId: z.string().optional().default(DEFAULT_CALENDAR_ID).describe(`Calendar ID (default: '${DEFAULT_CALENDAR_ID}')`),
      eventId: z.string().describe("The event ID to update"),
      summary: z.string().optional().describe("New event title"),
      description: z.string().optional().describe("New event description"),
      start: z.string().optional().describe("New start time as ISO datetime"),
      end: z.string().optional().describe("New end time as ISO datetime"),
      location: z.string().optional().describe("New event location (set to empty string to clear)"),
    }),
  },
);

// --- delete_event ---

export const deleteEvent = tool(
  async ({
    calendarId = DEFAULT_CALENDAR_ID,
    eventId,
  }: {
    calendarId?: string;
    eventId: string;
  }) => {
    const cal = getCalendar();
    await cal.events.delete({ calendarId, eventId });
    return `Deleted event [${eventId}]`;
  },
  {
    name: "delete_event",
    description: "Delete a Google Calendar event by its ID. This action cannot be undone.",
    schema: z.object({
      calendarId: z.string().optional().default(DEFAULT_CALENDAR_ID).describe(`Calendar ID (default: '${DEFAULT_CALENDAR_ID}')`),
      eventId: z.string().describe("The event ID to delete"),
    }),
  },
);
