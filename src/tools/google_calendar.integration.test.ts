import { describe, it, expect, afterAll } from "vitest";
import { listEvents, createEvent, updateEvent, deleteEvent } from "./google_calendar.js";

// Run with: npx vitest run src/tools/google_calendar.integration.test.ts
// Requires GOOGLE_CALENDAR_SERVICE_ACCOUNT_JSON in .env or environment

if (!process.env.GOOGLE_CALENDAR_SERVICE_ACCOUNT_JSON) {
  throw new Error("Set GOOGLE_CALENDAR_SERVICE_ACCOUNT_JSON to run integration tests");
}

const CALENDAR_ID = process.env.GOOGLE_CALENDAR_ID || "primary";

// Track created events for cleanup
const createdIds: string[] = [];

afterAll(async () => {
  // Clean up any events we created
  for (const id of createdIds) {
    try {
      await deleteEvent.invoke({ calendarId: CALENDAR_ID, eventId: id });
      console.log(`Cleaned up event ${id}`);
    } catch (err) {
      console.warn(`Failed to clean up event ${id}:`, err);
    }
  }
});

describe("Google Calendar (live)", () => {
  const now = new Date();
  const tomorrow = new Date(now);
  tomorrow.setDate(tomorrow.getDate() + 1);
  const dayAfter = new Date(now);
  dayAfter.setDate(dayAfter.getDate() + 2);

  const tomorrowStart = new Date(tomorrow);
  tomorrowStart.setHours(10, 0, 0, 0);
  const tomorrowEnd = new Date(tomorrow);
  tomorrowEnd.setHours(11, 0, 0, 0);
  const dayAfterStart = new Date(dayAfter);
  dayAfterStart.setHours(14, 0, 0, 0);
  const dayAfterEnd = new Date(dayAfter);
  dayAfterEnd.setHours(15, 0, 0, 0);

  it("creates an event", async () => {
    const result = await createEvent.invoke({
      calendarId: CALENDAR_ID,
      summary: "Integration Test Event",
      description: "Created by vitest integration test",
      start: tomorrowStart.toISOString(),
      end: tomorrowEnd.toISOString(),
      location: "Test Location",
    });

    expect(result).toContain("Created event [");
    expect(result).toContain("Integration Test Event");

    // Extract ID for cleanup and subsequent tests
    const match = result.match(/\[(.+?)\]/);
    if (match) createdIds.push(match[1]);
  });

  it("lists events in a time range", async () => {
    const result = await listEvents.invoke({
      calendarId: CALENDAR_ID,
      timeMin: tomorrowStart.toISOString(),
      timeMax: dayAfterEnd.toISOString(),
      maxResults: 10,
    });

    // Should at least see the event we just created
    expect(result).toContain("Integration Test Event");
    console.log("\nListed events:\n" + result);
  });

  it("updates the created event", async () => {
    const eventId = createdIds[0];
    const result = await updateEvent.invoke({
      calendarId: CALENDAR_ID,
      eventId,
      summary: "Updated Integration Test Event",
      start: dayAfterStart.toISOString(),
      end: dayAfterEnd.toISOString(),
    });

    expect(result).toContain("Updated event [");
    expect(result).toContain("Updated Integration Test Event");
  });

  it("lists events to verify the update", async () => {
    const result = await listEvents.invoke({
      calendarId: CALENDAR_ID,
      timeMin: tomorrowStart.toISOString(),
      timeMax: dayAfterEnd.toISOString(),
      maxResults: 10,
    });

    expect(result).toContain("Updated Integration Test Event");
    console.log("\nEvents after update:\n" + result);
  });

  it("deletes the event", async () => {
    const eventId = createdIds.shift()!; // remove from cleanup list
    const result = await deleteEvent.invoke({
      calendarId: CALENDAR_ID,
      eventId,
    });

    expect(result).toBe(`Deleted event [${eventId}]`);
  });

  it("verifies the event is gone", async () => {
    const result = await listEvents.invoke({
      calendarId: CALENDAR_ID,
      timeMin: tomorrowStart.toISOString(),
      timeMax: dayAfterEnd.toISOString(),
      maxResults: 10,
    });

    expect(result).not.toContain("Updated Integration Test Event");
  });
});
