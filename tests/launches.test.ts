import { describe, expect, it } from "vitest";
import {
  LAUNCH_EMPTY_MESSAGE,
  LAUNCH_LOAD_ERROR,
  countdownParts,
  formatCountdownUnit,
  formatKstLaunchDateTime,
  formatLaunchDateTime,
  formatLaunchDday,
  launchOperatorPlace,
  nextLaunchTitle,
  parseLaunchDocument,
  upcomingLaunches,
  type LaunchItem,
} from "../src/launches";

const NOW = new Date("2026-11-12T08:38:00.000Z");

function launch(overrides: Partial<LaunchItem> = {}): LaunchItem {
  return {
    id: "launch-1",
    name: "Falcon 9 Block 5 | Starlink 위성",
    net: "2026-11-14T12:05:41Z",
    provider: "SpaceX",
    rocket: "Falcon 9",
    pad: "SLC-40",
    location: "미국 케이프커내버럴",
    webcastUrl: "https://example.com/live",
    ...overrides,
  };
}

describe("Korean launch time", () => {
  it("converts a UTC net to a KST month, weekday, and clock", () => {
    expect(formatKstLaunchDateTime(new Date("2026-11-14T12:05:41Z"))).toBe("11/14 (토) 21:05");
    expect(formatKstLaunchDateTime(new Date("2026-11-16T00:30:00Z"))).toBe("11/16 (월) 09:30");
  });

  it("rolls the calendar date forward across KST midnight", () => {
    expect(formatKstLaunchDateTime(new Date("2026-11-15T16:00:00Z"))).toBe("11/16 (월) 01:00");
  });

  it("counts D-day on the device calendar, not by elapsed hours", () => {
    expect(formatLaunchDday(new Date("2026-11-16T00:30:00Z"), NOW)).toBe("D-4");
    expect(formatLaunchDday(new Date("2026-11-12T14:00:00Z"), NOW)).toBe("D-Day");
    expect(formatLaunchDday(new Date("2026-11-13T00:00:00Z"), NOW)).toBe("D-1");
  });
});

describe("countdown", () => {
  it("splits the remaining time into days, hours, minutes, and seconds", () => {
    expect(countdownParts(new Date("2026-11-14T12:05:41Z"), NOW)).toEqual({
      days: 2,
      hours: 3,
      minutes: 27,
      seconds: 41,
    });
    expect(formatCountdownUnit(2)).toBe("02");
    expect(formatCountdownUnit(41)).toBe("41");
    expect(formatCountdownUnit(120)).toBe("120");
  });

  it("stays at zero after the launch time has passed", () => {
    expect(countdownParts(new Date("2026-11-12T08:37:59Z"), NOW)).toEqual({
      days: 0,
      hours: 0,
      minutes: 0,
      seconds: 0,
    });
  });
});

describe("launch document", () => {
  it("sorts compact items and keeps only a safe livestream url", () => {
    const catalog = parseLaunchDocument({
      fetched_at: "2026-11-12T03:00:00.000Z",
      items: [
        {
          id: "later",
          name: "Electron | Mission",
          net: "2026-11-16T00:30:00Z",
          provider: "Rocket Lab",
          rocket: "Electron",
          location: "뉴질랜드",
          webcast_urls: ["javascript:alert(1)"],
        },
        {
          id: "next",
          name: "Falcon 9 Block 5 | Starlink 위성",
          net: "2026-11-14T12:05:41Z",
          provider: "SpaceX",
          rocket: "Falcon 9",
          pad: "SLC-40",
          location: "미국 케이프커내버럴",
          webcast_urls: ["not a url", "https://example.com/live"],
        },
      ],
    });

    expect(catalog.error).toBeNull();
    expect(catalog.fetchedAt).toBe("2026-11-12T03:00:00.000Z");
    expect(catalog.launches.map((item) => item.id)).toEqual(["next", "later"]);
    expect(catalog.launches[0]?.webcastUrl).toBe("https://example.com/live");
    expect(catalog.launches[1]?.webcastUrl).toBeNull();
    expect(nextLaunchTitle(catalog.launches[0] ?? launch())).toBe("Falcon 9 · Starlink 위성");
    expect(launchOperatorPlace(catalog.launches[0] ?? launch())).toBe("SpaceX · 미국 케이프커내버럴");
  });

  it("drops launches that are already in the past", () => {
    const catalog = parseLaunchDocument({
      items: [
        launch({ id: "past", net: "2026-11-11T00:00:00Z" }),
        launch({ id: "soon", net: "2026-11-12T08:38:00.000Z" }),
      ],
    });
    expect(upcomingLaunches(catalog.launches, NOW).map((item) => item.id)).toEqual(["soon"]);
  });

  it("reports an empty list without treating it as a failed request", () => {
    const catalog = parseLaunchDocument({ fetched_at: "2026-11-12T03:00:00.000Z", items: [] });
    expect(catalog).toEqual({
      fetchedAt: "2026-11-12T03:00:00.000Z",
      launches: [],
      error: null,
    });
    expect(upcomingLaunches(catalog.launches, NOW)).toEqual([]);
    expect(LAUNCH_EMPTY_MESSAGE).toBe("다가오는 발사 일정이 없습니다.");
  });

  it("uses a fixed message for a failed or unreadable file", () => {
    expect(parseLaunchDocument({ error: "Launch Library 2 요청 실패: HTTP 503", items: [] })).toEqual({
      fetchedAt: null,
      launches: [],
      error: LAUNCH_LOAD_ERROR,
    });
    expect(parseLaunchDocument({})).toEqual({
      fetchedAt: null,
      launches: [],
      error: LAUNCH_LOAD_ERROR,
    });
    expect(parseLaunchDocument({ items: [{ name: "missing net" }] }).launches).toEqual([]);
    expect(LAUNCH_LOAD_ERROR).not.toContain("HTTP");
  });
});

describe("launch times in a named zone", () => {
  it("shows 2026-11-14T12:05:41Z as New York 07:05 and Seoul 21:05", () => {
    expect(Intl.DateTimeFormat().resolvedOptions().timeZone).toBe("Asia/Seoul");
    const net = new Date("2026-11-14T12:05:41Z");
    expect(formatLaunchDateTime(net, "en", "America/New_York")).toBe("11/14 (Sat) 07:05");
    expect(formatLaunchDateTime(net, "ko", "Asia/Seoul")).toBe("11/14 (토) 21:05");
    expect(formatLaunchDateTime(net, "en")).toBe("11/14 (Sat) 21:05");
  });

  it("counts D-1 in New York when the Korean date of both instants is the same day", () => {
    const now = new Date("2026-11-15T03:00:00.000Z");
    const net = new Date("2026-11-15T06:00:00.000Z");
    expect(formatLaunchDateTime(net, "en", "America/New_York")).toBe("11/15 (Sun) 01:00");
    expect(formatLaunchDday(net, now, "America/New_York")).toBe("D-1");
    expect(formatLaunchDateTime(net, "ko", "Asia/Seoul")).toBe("11/15 (일) 15:00");
    expect(formatLaunchDday(net, now, "Asia/Seoul")).toBe("D-Day");
    expect(Intl.DateTimeFormat().resolvedOptions().timeZone).toBe("Asia/Seoul");
  });
});
