import { describe, expect, it } from "vitest";
import { formatClock, formatShortOffset, localDayStart } from "../src/clock";

describe("device clock", () => {
  it("reads shortOffset labels from Intl and does not switch the process zone", () => {
    expect(Intl.DateTimeFormat().resolvedOptions().timeZone).toBe("Asia/Seoul");
    const date = new Date("2026-11-14T12:05:41Z");
    expect(formatShortOffset(date, "Asia/Seoul")).toBe("GMT+9");
    expect(formatShortOffset(date, "America/New_York")).toBe("GMT-5");
    expect(formatClock(new Date("2026-11-14T12:05:00Z"), "America/New_York")).toBe("07:05");
    expect(formatClock(new Date("2026-11-14T12:05:00Z"), "Asia/Seoul")).toBe("21:05");
  });

  it("starts the local day at midnight in that zone", () => {
    expect(localDayStart(new Date("2026-11-12T03:00:00.000Z"), "Asia/Seoul").toISOString()).toBe(
      "2026-11-11T15:00:00.000Z",
    );
    expect(localDayStart(new Date("2026-11-15T06:00:00.000Z"), "America/New_York").toISOString()).toBe(
      "2026-11-15T05:00:00.000Z",
    );
    expect(localDayStart(new Date("2026-07-01T16:00:00.000Z"), "America/New_York").toISOString()).toBe(
      "2026-07-01T04:00:00.000Z",
    );
  });
});
