import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createApp } from "../src/app";
import {
  ISS_PASS_HORIZON_MS,
  ISS_PASS_LOOKBACK_MS,
  issPassLater,
  issPassRoute,
  issPassTimeRange,
  kstDayOffset,
  predictIssPasses,
  predictStationPasses,
  satrecFromIssTle,
  upcomingIssPasses,
  type IssPass,
} from "../src/iss-passes";
import { saveLocation } from "../src/location";
import { parseTleDocument } from "../src/satellites";
import type { Compass16 } from "../src/sky";
import "../src/styles.css";

declare const process: {
  cwd(): string;
};

const MINUTE_MS = 60_000;
const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Heavens-Above Visible Passes, 2026-11-11 조회.
 * 서울 37.5665°N 126.9780°E, 고도 38m. 시각은 UTC.
 */
const SEOUL = { latitude: 37.5665, longitude: 126.978, heightMeters: 38 };

const REFERENCE: Array<{
  start: string;
  startDir: Compass16;
  peak: string;
  peakEl: number;
  peakDir: Compass16;
  end: string;
  endDir: Compass16;
}> = [
  {
    start: "2026-11-11T09:46:01Z",
    startDir: "남서",
    peak: "2026-11-11T09:49:18Z",
    peakEl: 60,
    peakDir: "남동",
    end: "2026-11-11T09:49:53Z",
    endDir: "동",
  },
  {
    start: "2026-11-12T08:58:39Z",
    startDir: "남남서",
    peak: "2026-11-12T09:01:39Z",
    peakEl: 31,
    peakDir: "남동",
    end: "2026-11-12T09:04:24Z",
    endDir: "동북동",
  },
  {
    start: "2026-11-12T10:35:33Z",
    startDir: "서",
    peak: "2026-11-12T10:37:22Z",
    peakEl: 22,
    peakDir: "서북서",
    end: "2026-11-12T10:37:22Z",
    endDir: "서북서",
  },
  {
    start: "2026-11-13T09:47:24Z",
    startDir: "서남서",
    peak: "2026-11-13T09:50:35Z",
    peakEl: 41,
    peakDir: "북서",
    end: "2026-11-13T09:51:46Z",
    endDir: "북북동",
  },
  {
    start: "2026-11-14T08:59:27Z",
    startDir: "남서",
    peak: "2026-11-14T09:02:46Z",
    peakEl: 74,
    peakDir: "북서",
    end: "2026-11-14T09:06:05Z",
    endDir: "북동",
  },
  {
    start: "2026-11-14T10:38:12Z",
    startDir: "북서",
    peak: "2026-11-14T10:39:02Z",
    peakEl: 13,
    peakDir: "북서",
    end: "2026-11-14T10:39:02Z",
    endDir: "북서",
  },
];

const REFERENCE_OMM = {
  OBJECT_NAME: "ISS (ZARYA)",
  OBJECT_ID: "1998-067A",
  EPOCH: "2026-11-11T04:58:11.303Z",
  MEAN_MOTION: 15.49310717,
  ECCENTRICITY: 0.0007316,
  INCLINATION: 51.6322,
  RA_OF_ASC_NODE: 292.5559,
  ARG_OF_PERICENTER: 12.7435,
  MEAN_ANOMALY: 347.3737,
  NORAD_CAT_ID: 25544,
  BSTAR: 0.00017362,
  MEAN_MOTION_DOT: 0.00009235,
  MEAN_MOTION_DDOT: 0,
};

function loadFixtureTle(): string {
  const bytes = readFileSync(join(process.cwd(), "tests/fixtures/iss-zarya-2026-11-11.tle"));
  return new TextDecoder().decode(bytes);
}

function withinMinute(actual: Date, expectedIso: string, label: string): void {
  const delta = Math.abs(actual.getTime() - Date.parse(expectedIso));
  expect(delta, `${label} delta ${delta}ms`).toBeLessThanOrEqual(MINUTE_MS);
}

function matchReference(passes: IssPass[]): void {
  const unmatched = [...passes];
  for (const reference of REFERENCE) {
    const found = unmatched.findIndex(
      (pass) => Math.abs(pass.start.time.getTime() - Date.parse(reference.start)) <= MINUTE_MS,
    );
    expect(found, reference.start).toBeGreaterThanOrEqual(0);
    const pass = unmatched[found];
    if (!pass) {
      continue;
    }
    unmatched.splice(found, 1);
    withinMinute(pass.start.time, reference.start, "start");
    withinMinute(pass.peak.time, reference.peak, "peak");
    withinMinute(pass.end.time, reference.end, "end");
    expect(Math.abs(pass.peak.elevation - reference.peakEl)).toBeLessThanOrEqual(3);
    expect(pass.start.direction, `start az ${pass.start.azimuth}`).toBe(reference.startDir);
    expect(pass.peak.direction, `peak az ${pass.peak.azimuth}`).toBe(reference.peakDir);
    expect(pass.end.direction, `end az ${pass.end.azimuth}`).toBe(reference.endDir);
  }
  expect(unmatched.map((pass) => pass.start.time.toISOString())).toEqual([]);
}

afterEach(() => {
  document.body.innerHTML = "";
  localStorage.clear();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("ISS pass prediction", () => {
  it("stores the reference TLE with the published spacing", () => {
    const text = loadFixtureTle().replace(/\r\n/g, "\n").trim();
    expect(text).toBe(
      [
        "ISS (ZARYA)",
        "1 25544U 98067A   26315.20707527  .00009235  00000+0  17362-3 0  9997",
        "2 25544  51.6322 292.5559 0007316  12.7435 347.3737 15.49310717594546",
      ].join("\n"),
    );
    expect(satrecFromIssTle(text)?.satnum).toBe("25544");
  });

  it("matches the six Heavens-Above passes from 2026-11-11 00:00 UTC across 4 days", () => {
    const satrec = satrecFromIssTle(loadFixtureTle());
    expect(satrec).not.toBeNull();
    if (!satrec) {
      return;
    }
    const start = new Date("2026-11-11T00:00:00.000Z");
    const passes = predictIssPasses(satrec, SEOUL, start, new Date(start.getTime() + 4 * DAY_MS));
    matchReference(passes);
  });

  it("reads the same passes from an OMM record like tle.json", () => {
    const satrec = satrecFromIssTle(loadFixtureTle());
    const station = parseTleDocument({ items: [REFERENCE_OMM] }).stations[0];
    expect(satrec).not.toBeNull();
    expect(station?.noradId).toBe(25544);
    if (!satrec || !station) {
      return;
    }
    const start = new Date("2026-11-11T00:00:00.000Z");
    const end = new Date(start.getTime() + 4 * DAY_MS);
    const fromTle = predictIssPasses(satrec, SEOUL, start, end);
    const fromJson = predictStationPasses(station, SEOUL, start, end);
    expect(fromJson).not.toBeNull();
    if (!fromJson) {
      return;
    }
    expect(fromJson).toHaveLength(fromTle.length);
    for (let index = 0; index < fromTle.length; index += 1) {
      const tlePass = fromTle[index];
      const jsonPass = fromJson[index];
      if (!tlePass || !jsonPass) {
        continue;
      }
      expect(Math.abs(jsonPass.start.time.getTime() - tlePass.start.time.getTime())).toBeLessThanOrEqual(MINUTE_MS);
      expect(Math.abs(jsonPass.peak.elevation - tlePass.peak.elevation)).toBeLessThanOrEqual(3);
    }
  });

  it("keeps the rise time of a pass that is already under way", () => {
    const satrec = satrecFromIssTle(loadFixtureTle());
    expect(satrec).not.toBeNull();
    if (!satrec) {
      return;
    }
    const now = new Date("2026-11-11T09:48:00.000Z");
    const passes = upcomingIssPasses(
      predictIssPasses(
        satrec,
        SEOUL,
        new Date(now.getTime() - ISS_PASS_LOOKBACK_MS),
        new Date("2026-11-11T12:00:00.000Z"),
      ),
      now,
    );
    expect(passes.length).toBeGreaterThan(0);
    withinMinute(passes[0]?.start.time ?? now, "2026-11-11T09:46:01Z", "in progress start");
    expect(kstDayOffset(now, passes[0]?.start.time ?? now)).toBe(0);
    expect(ISS_PASS_HORIZON_MS).toBe(3 * DAY_MS);
  });
});

describe("ISS pass card", () => {
  it("shows the next three nights from the local orbit file", async () => {
    saveLocation(localStorage, {
      latitude: 37.5665,
      longitude: 126.978,
      label: "서울",
      source: "region",
    });
    const now = new Date("2026-11-11T00:00:00.000Z");
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL) => {
        const url = String(input);
        expect(url).not.toContain("celestrak.org");
        if (url.includes("data/tle.json")) {
          return {
            ok: true,
            json: async () => ({ fetched_at: "2026-11-11T04:58:11.303Z", items: [REFERENCE_OMM] }),
          };
        }
        if (url.includes("data/launches.json")) {
          return { ok: true, json: async () => ({ fetched_at: null, items: [] }) };
        }
        throw new Error(`unexpected ${url}`);
      }),
    );

    document.documentElement.style.width = "390px";
    document.body.style.width = "390px";
    document.body.innerHTML = "";
    document.body.append(createApp({ now: () => now }));

    const station = parseTleDocument({ items: [REFERENCE_OMM] }).stations[0];
    const expected = station
      ? upcomingIssPasses(
          predictStationPasses(
            station,
            { latitude: 37.6, longitude: 127, heightMeters: 0 },
            new Date(now.getTime() - ISS_PASS_LOOKBACK_MS),
            new Date(now.getTime() + ISS_PASS_HORIZON_MS),
          ) ?? [],
          now,
        )
      : [];
    expect(expected.length).toBeGreaterThan(1);
    const featured = expected[0];
    if (!featured) {
      return;
    }

    await vi.waitFor(() => {
      expect(document.querySelector("#iss-pass-time")?.textContent).toBe(issPassTimeRange(featured));
    });

    expect(document.querySelector("#iss-pass-detail")?.textContent).toBe(issPassRoute(featured, "ko"));
    expect(document.querySelector("#iss-pass-badge")?.textContent).toBe("맨눈 관측");
    expect((document.querySelector("#iss-pass-badge") as HTMLElement | null)?.hidden).toBe(false);
    expect(getComputedStyle(document.querySelector("#iss-pass-badge") as HTMLElement).backgroundColor).toBe(
      "rgb(232, 176, 74)",
    );
    expect(getComputedStyle(document.querySelector("#iss-pass-card") as HTMLElement).borderTopColor).toBe(
      "rgb(28, 35, 51)",
    );
    expect(getComputedStyle(document.querySelector("#iss-pass-time") as HTMLElement).fontFamily).toContain(
      "IBM Plex Mono",
    );
    expect(getComputedStyle(document.querySelector("#iss-pass-time") as HTMLElement).fontSize).toBe("34px");
    const rows = [...document.querySelectorAll(".iss-pass-row")].map((row) => row.textContent);
    expect(rows).toEqual(expected.slice(1).map((pass) => {
      const offset = kstDayOffset(now, pass.start.time);
      const label = offset <= 0 ? "오늘" : offset === 1 ? "내일" : "모레";
      return `${label}${issPassLater(pass, "ko")}`;
    }));
    expect((document.querySelector("#iss-pass-note") as HTMLElement | null)?.hidden).toBe(true);
    expect(document.querySelector("#panel-tonight")?.textContent).not.toContain("준비 중");

    const rootWidth = document.documentElement.clientWidth || 390;
    expect(document.documentElement.scrollWidth).toBeLessThanOrEqual(rootWidth);

    document.querySelector<HTMLButtonElement>("#language-button")?.click();
    expect(document.querySelector("#iss-pass-badge")?.textContent).toBe("Naked eye");
    expect(document.querySelector("#iss-pass-detail")?.textContent).toBe(issPassRoute(featured, "en"));
    expect(document.querySelector("#iss-pass-card")?.textContent).not.toMatch(/[\u3131-\u318e\uac00-\ud7a3]/);
  });
});
