import { readFileSync } from "node:fs";
import { join } from "node:path";
import { Body, Equator, KM_PER_AU, Observer } from "astronomy-engine";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createApp } from "../src/app";
import { translate } from "../src/i18n";
import { satrecFromIssTle } from "../src/iss-passes";
import {
  MOON_RADIUS_KM,
  SUN_RADIUS_KM,
  angularRadiusDeg,
  angularSeparationDeg,
  distanceKmFromAu,
  measureIssTransit,
  predictIssTransitsFromTle,
  searchTransitTimes,
} from "../src/iss-transits";
import { saveLocation } from "../src/location";
import { formatKstTime } from "../src/sky";
import "../src/styles.css";

declare const process: {
  cwd(): string;
};

const DAY_MS = 24 * 60 * 60 * 1000;
const PLACE = { latitude: 37.5665, longitude: 126.978, heightMeters: 0 };

function loadFixtureTle(): string {
  const bytes = readFileSync(join(process.cwd(), "tests/fixtures/iss-zarya-2026-11-11.tle"));
  return new TextDecoder().decode(bytes);
}

/** 백로그 34의 주입 각거리. t는 시작부터의 초. */
function injectedSeparation(elapsedSeconds: number): number {
  if (elapsedSeconds >= 0 && elapsedSeconds <= 10) {
    return 6 - 5.9 * (1 - Math.abs(elapsedSeconds - 5) / 5);
  }
  return 6;
}

function readSource(path: string): string {
  return new TextDecoder().decode(readFileSync(join(process.cwd(), path)));
}

afterEach(() => {
  document.body.innerHTML = "";
  localStorage.clear();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("ISS transit search", () => {
  it("finds the single injected crossing at 5 seconds", () => {
    const start = new Date("2026-11-11T00:00:00.000Z");
    const end = new Date(start.getTime() + 10_000);
    expect(injectedSeparation(0)).toBeCloseTo(6, 8);
    expect(injectedSeparation(2)).toBeCloseTo(3.64, 8);
    expect(injectedSeparation(4)).toBeCloseTo(1.28, 8);
    expect(injectedSeparation(5)).toBeCloseTo(0.1, 8);
    expect(injectedSeparation(6)).toBeCloseTo(1.28, 8);
    expect(injectedSeparation(8)).toBeCloseTo(3.64, 8);
    expect(injectedSeparation(10)).toBeCloseTo(6, 8);

    const hits = searchTransitTimes(start, end, (elapsedSeconds) => ({
      angularDistanceDeg: injectedSeparation(elapsedSeconds),
      issAltitudeDeg: 10,
      angularRadiusDeg: 0.25,
    }));
    expect(hits.map((time) => time.getTime() - start.getTime())).toEqual([5_000]);
  });

  it("does not treat a geocentric 0.1° alignment as a transit when the observer angle is 1°", () => {
    const start = new Date("2026-11-11T00:00:00.000Z");
    const hits = searchTransitTimes(start, new Date(start.getTime() + 10_000), () => ({
      angularDistanceDeg: 1,
      geocentricAngularDistanceDeg: 0.1,
      issAltitudeDeg: 10,
      angularRadiusDeg: 0.25,
    }));
    expect(hits).toEqual([]);
  });

  it("uses horizon altitude and azimuth, not a geocentric angle, for separation", () => {
    expect(angularSeparationDeg(10, 0, 11, 0)).toBeCloseTo(1, 6);
    expect(angularSeparationDeg(10, 0, 10, 0)).toBeCloseTo(0, 5);
  });

  it("converts AU with KM_PER_AU before the radius formula", () => {
    expect(SUN_RADIUS_KM).toBe(695700);
    expect(MOON_RADIUS_KM).toBe(1737.4);
    expect(distanceKmFromAu(1)).toBe(KM_PER_AU);
    expect(angularRadiusDeg(SUN_RADIUS_KM, distanceKmFromAu(1))).toBeCloseTo(
      (Math.asin(SUN_RADIUS_KM / KM_PER_AU) * 180) / Math.PI,
      12,
    );
    expect(angularRadiusDeg(MOON_RADIUS_KM, distanceKmFromAu(0.0025))).toBeCloseTo(
      (Math.asin(MOON_RADIUS_KM / (0.0025 * KM_PER_AU)) * 180) / Math.PI,
      12,
    );
  });
});

describe("ISS transit geometry", () => {
  it("keeps every fixture event inside the observer disk above the horizon", () => {
    const tle = loadFixtureTle();
    const start = new Date("2026-11-11T00:00:00.000Z");
    const end = new Date(start.getTime() + 4 * DAY_MS);
    const events = predictIssTransitsFromTle(tle, PLACE, start, end);
    const satrec = satrecFromIssTle(tle);
    expect(satrec).not.toBeNull();
    if (!satrec) {
      return;
    }
    const observer = new Observer(PLACE.latitude, PLACE.longitude, PLACE.heightMeters);
    for (const event of events) {
      const measured = measureIssTransit(satrec, PLACE, event.time, event.body);
      expect(measured.angularDistanceDeg).toBeLessThan(measured.angularRadiusDeg);
      expect(measured.issAltitudeDeg).toBeGreaterThan(0);
      const equatorial = Equator(
        event.body === "sun" ? Body.Sun : Body.Moon,
        event.time,
        observer,
        true,
        true,
      );
      const radiusKm = event.body === "sun" ? SUN_RADIUS_KM : MOON_RADIUS_KM;
      expect(measured.angularRadiusDeg).toBeCloseTo(
        angularRadiusDeg(radiusKm, distanceKmFromAu(equatorial.dist)),
        8,
      );
    }
  }, 30_000);

  it("measures the solar radius from the observer distance in AU", () => {
    const tle = loadFixtureTle();
    const satrec = satrecFromIssTle(tle);
    expect(satrec).not.toBeNull();
    if (!satrec) {
      return;
    }
    const date = new Date("2026-11-11T09:49:18.000Z");
    const observer = new Observer(PLACE.latitude, PLACE.longitude, PLACE.heightMeters);
    const equatorial = Equator(Body.Sun, date, observer, true, true);
    const measured = measureIssTransit(satrec, PLACE, date, "sun");
    expect(measured.angularRadiusDeg).toBeCloseTo(
      angularRadiusDeg(SUN_RADIUS_KM, equatorial.dist * KM_PER_AU),
      8,
    );
  });
});

describe("ISS transit screen", () => {
  it("shows a non-empty empty row when the orbit file has no ISS", async () => {
    saveLocation(localStorage, {
      latitude: 37.5665,
      longitude: 126.978,
      label: "서울",
      source: "region",
    });
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL) => {
        const url = String(input);
        expect(url).not.toContain("celestrak.org");
        if (url.includes("data/tle.json")) {
          return { ok: true, json: async () => ({ fetched_at: "2026-11-11T00:00:00.000Z", items: [] }) };
        }
        return { ok: true, json: async () => ({ fetched_at: null, items: [] }) };
      }),
    );

    document.body.append(createApp({ now: () => new Date("2026-11-11T00:00:00.000Z") }));
    const sentence = translate("ko", "issTransitNone");
    expect(sentence.length).toBeGreaterThan(0);
    expect(sentence).not.toMatch(/\d{1,2}:\d{2}/);

    await vi.waitFor(() => {
      expect(document.querySelector("#iss-transit-empty")?.textContent).toBe(sentence);
    });
    expect(document.querySelector("#iss-transit-list")?.childElementCount).toBe(0);
    expect(document.querySelector("#iss-transit-card")?.textContent).toContain("ISS 태양·달 통과");
    expect(document.querySelector("#iss-pass-card")).not.toBeNull();
  });

  it("keeps the fixture TLE out of the screen and off the one-second timer", () => {
    const app = readSource("src/app.ts");
    const transits = readSource("src/iss-transits.ts");
    expect(app).not.toContain("26315.20707527");
    expect(app).not.toContain("1 25544U");
    expect(transits).not.toContain("26315.20707527");
    expect(transits).not.toContain("1 25544U");
    expect(app).not.toContain("predictIssTransitsFromTle");

    const timerAt = app.indexOf("timer = window.setInterval(() => {");
    const countdownAt = app.indexOf("COUNTDOWN_UPDATE_MS);", timerAt);
    expect(timerAt).toBeGreaterThan(-1);
    expect(countdownAt).toBeGreaterThan(timerAt);
    const timerBody = app.slice(timerAt, countdownAt);
    expect(timerBody).not.toContain("predictStationTransits");
    expect(timerBody).not.toContain("renderIssTransits");
    expect(timerBody).not.toContain("searchTransitTimes");
  });

  it("formats a transit with the device clock", () => {
    const time = new Date("2026-11-14T12:05:41.000Z");
    expect(formatKstTime(time)).toBe("21:06");
    expect(translate("ko", "issTransitSun")).toBe("태양");
    expect(translate("en", "issTransitSun")).toBe("Sun");
    expect(translate("ko", "issTransitMoon")).toBe("달");
    expect(translate("en", "issTransitMoon")).toBe("Moon");
  });
});
