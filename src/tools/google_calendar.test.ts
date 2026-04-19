import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock googleapis before any import of google_calendar
const mockList = vi.fn();
const mockInsert = vi.fn();
const mockUpdate = vi.fn();
const mockDelete = vi.fn();

vi.mock("googleapis", () => ({
  google: {
    auth: {
      GoogleAuth: vi.fn(),
    },
    calendar: vi.fn(() => ({
      events: { list: mockList, insert: mockInsert, update: mockUpdate, delete: mockDelete },
    })),
  },
}));

// Set env var before importing so getCalendar() doesn't throw
process.env.GOOGLE_CALENDAR_SERVICE_ACCOUNT_JSON = '{"type":"service_account","project_id":"test","private_key":"test","client_email":"test@test.iam.gserviceaccount.com"}';

const { listEvents, createEvent, updateEvent, deleteEvent } = await import("./google_calendar.js");

beforeEach(() => {
  vi.clearAllMocks();
});

// --- Tests ---

describe("listEvents", () => {
  it("returns formatted event list", async () => {
    mockList.mockResolvedValue({
      data: {
        items: [
          { id: "1", summary: "Standup", start: { dateTime: "2026-04-20T09:00:00Z" }, end: { dateTime: "2026-04-20T09:30:00Z" }, location: "Zoom" },
          { id: "2", summary: "Lunch", start: { date: "2026-04-20" }, end: { date: "2026-04-20" } },
        ],
      },
    });

    const result = await listEvents.invoke({ calendarId: "primary", maxResults: 10 });

    expect(mockList).toHaveBeenCalledWith({
      calendarId: "primary",
      maxResults: 10,
      singleEvents: true,
      orderBy: "startTime",
      timeMin: undefined,
      timeMax: undefined,
    });
    expect(result).toContain("[1] 2026-04-20T09:00:00Z → 2026-04-20T09:30:00Z | Standup @ Zoom");
    expect(result).toContain("[2] 2026-04-20 → 2026-04-20 | Lunch");
  });

  it("returns 'No events found' for empty list", async () => {
    mockList.mockResolvedValue({ data: { items: [] } });

    const result = await listEvents.invoke({});

    expect(result).toBe("No events found.");
  });

  it("handles events without title", async () => {
    mockList.mockResolvedValue({
      data: {
        items: [
          { id: "3", start: { dateTime: "2026-04-20T12:00:00Z" }, end: { dateTime: "2026-04-20T13:00:00Z" } },
        ],
      },
    });

    const result = await listEvents.invoke({});

    expect(result).toContain("(no title)");
  });
});

describe("createEvent", () => {
  it("creates an event and returns confirmation", async () => {
    mockInsert.mockImplementation(async ({ requestBody }: { requestBody: Record<string, unknown> }) => ({
      data: { id: "evt-123", summary: requestBody.summary, start: requestBody.start, end: requestBody.end },
    }));

    const result = await createEvent.invoke({
      summary: "Team Sync",
      start: "2026-04-20T10:00:00Z",
      end: "2026-04-20T11:00:00Z",
      location: "Room A",
      description: "Weekly sync",
    });

    expect(mockInsert).toHaveBeenCalledWith({
      calendarId: "primary",
      requestBody: {
        summary: "Team Sync",
        start: { dateTime: "2026-04-20T10:00:00Z" },
        end: { dateTime: "2026-04-20T11:00:00Z" },
        location: "Room A",
        description: "Weekly sync",
      },
    });
    expect(result).toContain("Created event [evt-123]: Team Sync");
  });
});

describe("updateEvent", () => {
  it("sends only provided fields", async () => {
    mockUpdate.mockResolvedValue({
      data: { id: "evt-123", summary: "New Title", start: { dateTime: "2026-04-20T10:00:00Z" }, end: { dateTime: "2026-04-20T11:00:00Z" } },
    });

    await updateEvent.invoke({ eventId: "evt-123", summary: "New Title" });

    expect(mockUpdate).toHaveBeenCalledWith({
      calendarId: "primary",
      eventId: "evt-123",
      requestBody: { summary: "New Title" },
    });
  });

  it("sends all fields when all are provided", async () => {
    mockUpdate.mockResolvedValue({
      data: { id: "evt-123", summary: "Updated", start: { dateTime: "2026-04-20T12:00:00Z" }, end: { dateTime: "2026-04-20T13:00:00Z" } },
    });

    await updateEvent.invoke({
      eventId: "evt-123",
      summary: "Updated",
      start: "2026-04-20T12:00:00Z",
      end: "2026-04-20T13:00:00Z",
      location: "Room B",
      description: "Updated desc",
    });

    expect(mockUpdate).toHaveBeenCalledWith({
      calendarId: "primary",
      eventId: "evt-123",
      requestBody: {
        summary: "Updated",
        start: { dateTime: "2026-04-20T12:00:00Z" },
        end: { dateTime: "2026-04-20T13:00:00Z" },
        location: "Room B",
        description: "Updated desc",
      },
    });
  });
});

describe("deleteEvent", () => {
  it("deletes an event and returns confirmation", async () => {
    mockDelete.mockResolvedValue(undefined);

    const result = await deleteEvent.invoke({ eventId: "evt-123" });

    expect(mockDelete).toHaveBeenCalledWith({ calendarId: "primary", eventId: "evt-123" });
    expect(result).toBe("Deleted event [evt-123]");
  });
});
