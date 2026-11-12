import { Observer } from "astronomy-engine";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createApp } from "../src/app";
import {
  ISS_STANDARD_MAGNITUDE,
  issApparentMagnitude,
  predictIssPasses,
  satrecFromIssTle,
  visualMagnitudeFromPhase,
} from "../src/iss-passes";
import { saveLocation } from "../src/location";
import { computeTonightSky, formatKstTime, sunCenterAltitudeCrossing } from "../src/sky";
import {
  buildTonightTimeline,
  formatTimelineCountdown,
  nextTimelineEvent,
} from "../src/timeline";

afterEach(() => {
  document.body.innerHTML = "";
  localStorage.clear();
});

/**
 * 한국천문연구원 월별 해/달 출몰. 지역 「서울」, 2026년 11월.
 * https://astro.kasi.re.kr/life/sunmoon?location=서울&date=202611
 * 2026-11-12 조회. 시각은 한국표준시 분 단위.
 * 시민박명 저녁 17:52, 항해박명 저녁 18:23, 천문박명 저녁 18:54.
 */
const SEOUL = { latitude: 37.6, longitude: 127 };
const NOON = new Date("2026-11-12T03:00:00.000Z");
const TWO_MINUTES_MS = 2 * 60 * 1000;
const KASI_CIVIL_END = Date.parse("2026-11-12T08:52:00.000Z");
const KASI_NAUTICAL_END = Date.parse("2026-11-12T09:23:00.000Z");
const KASI_ASTRO_END = Date.parse("2026-11-12T09:54:00.000Z");

declare const process: {
  cwd(): string;
};

function loadFixtureTle(): string {
  return new TextDecoder().decode(
    readFileSync(join(process.cwd(), "tests/fixtures/iss-zarya-2026-11-11.tle")),
  );
}

describe("ISS visual magnitude", () => {
  it("is the published standard magnitude at 1000 km and a 90° phase angle", () => {
    expect(ISS_STANDARD_MAGNITUDE).toBe(-1.3);
    expect(visualMagnitudeFromPhase(-1.3, 1000, Math.PI / 2)).toBeCloseTo(-1.3, 10);
    expect(visualMagnitudeFromPhase(-1.3, 0, Math.PI / 2)).toBeNull();
    expect(visualMagnitudeFromPhase(-1.3, 1000, Math.PI)).toBeNull();
  });
});

describe("tonight timeline for Seoul on 2026-11-12", () => {
  it("orders sunset, twilight, moonset, and Saturn, and matches the KASI twilight times", () => {
    const sky = computeTonightSky(SEOUL, NOON);
    const events = buildTonightTimeline(SEOUL, NOON);
    const observer = new Observer(SEOUL.latitude, SEOUL.longitude, 0);
    const civil = events.find((event) => event.kind === "civil");
    const nautical = events.find((event) => event.kind === "nautical");
    const astronomical = events.find((event) => event.kind === "astronomical");

    expect(events.map((event) => event.kind)).toEqual([
      "sunset",
      "civil",
      "nautical",
      "astronomical",
      "moonset",
      "planet",
    ]);
    expect(events.map((event) => event.time.getTime())).toEqual(
      [...events].sort((left, right) => left.time.getTime() - right.time.getTime()).map((event) => event.time.getTime()),
    );
    expect(events[0]?.time.toISOString()).toBe(sky.sunset?.toISOString());
    expect(civil?.time.toISOString()).toBe(sky.planetTime.toISOString());
    expect(civil?.time.toISOString()).toBe(
      sunCenterAltitudeCrossing(observer, NOON, -1, -6)?.toISOString(),
    );
    expect(Math.abs((civil?.time.getTime() ?? 0) - KASI_CIVIL_END)).toBeLessThanOrEqual(TWO_MINUTES_MS);
    expect(Math.abs((nautical?.time.getTime() ?? 0) - KASI_NAUTICAL_END)).toBeLessThanOrEqual(TWO_MINUTES_MS);
    expect(Math.abs((astronomical?.time.getTime() ?? 0) - KASI_ASTRO_END)).toBeLessThanOrEqual(
      TWO_MINUTES_MS,
    );
    expect(formatKstTime(astronomical?.time ?? new Date(0))).toBe("18:54");
    expect(events.find((event) => event.kind === "moonrise")).toBeUndefined();
    expect(events.filter((event) => event.kind === "planet").map((event) => event.planetId)).toEqual([
      "saturn",
    ]);
    expect(Math.round(events.find((event) => event.planetId === "saturn")?.altitude ?? Number.NaN)).toBe(53);
    expect(nextTimelineEvent(events, NOON)?.kind).toBe("sunset");
    expect(formatTimelineCountdown(new Date("2026-11-12T08:24:00.000Z"), NOON)).toBe("T\u221205:24:00");
    expect(formatTimelineCountdown(NOON, NOON)).toBeNull();
  });

  it("marks only the highest ISS pass and keeps the night in time order", () => {
    const satrec = satrecFromIssTle(loadFixtureTle());
    expect(satrec).not.toBeNull();
    const place = { latitude: SEOUL.latitude, longitude: SEOUL.longitude, heightMeters: 0 };
    const passes = predictIssPasses(
      satrec!,
      place,
      new Date("2026-11-11T15:00:00.000Z"),
      new Date("2026-11-13T06:00:00.000Z"),
    );
    const events = buildTonightTimeline(SEOUL, NOON, {
      issPasses: passes,
      magnitude: (pass) => issApparentMagnitude(satrec!, place, pass.peak.time),
    });
    const iss = events.filter((event) => event.kind === "iss");
    const recommended = iss.filter((event) => event.recommended);

    expect(iss.length).toBeGreaterThan(0);
    expect(recommended).toHaveLength(1);
    const bestElevation = Math.max(...iss.map((event) => event.elevation ?? Number.NEGATIVE_INFINITY));
    expect(recommended[0]?.elevation).toBe(bestElevation);
    for (const event of iss) {
      expect(event.magnitude).not.toBeNull();
      expect(event.magnitude).toBeLessThan(2);
      expect(event.from).toBeTruthy();
      expect(event.to).toBeTruthy();
    }
    const times = events.map((event) => event.time.getTime());
    expect(times).toEqual([...times].sort((left, right) => left - right));
    const astronomical = events.find((event) => event.kind === "astronomical");
    expect(Math.abs((astronomical?.time.getTime() ?? 0) - KASI_ASTRO_END)).toBeLessThanOrEqual(
      TWO_MINUTES_MS,
    );
  });
});

describe("tonight timeline on the screen", () => {
  it("shows the full-night row, a ticking countdown, and no alert button", () => {
    saveLocation(localStorage, {
      latitude: SEOUL.latitude,
      longitude: SEOUL.longitude,
      label: "서울",
      source: "region",
    });
    document.body.innerHTML = "";
    document.body.append(createApp({ now: () => NOON }));

    const night = document.querySelector(".timeline-row[data-kind='astronomical']");
    expect(night?.querySelector(".timeline-title")?.textContent).toBe("완전한 밤");
    expect(night?.querySelector(".timeline-note")?.textContent).toBe("천문 박명 끝 · 별 보기 시작");
    expect(document.querySelector("#timeline-countdown")?.textContent).toMatch(
      /^다음 이벤트 T\u2212\d{2}:\d{2}:\d{2}$/,
    );
    expect(document.querySelector("#tonight-timeline button")).toBeNull();
    expect(document.querySelector("#tonight-timeline")?.textContent).not.toContain("알림");
    expect(document.querySelector(".timeline-row.is-past")).toBeNull();

    document.body.innerHTML = "";
    document.body.append(createApp({ now: () => new Date("2026-11-12T12:00:00.000Z") }));
    expect(document.querySelector(".timeline-row[data-kind='sunset']")?.classList.contains("is-past")).toBe(
      true,
    );
    expect(document.querySelector(".timeline-row[data-kind='planet']")?.classList.contains("is-past")).toBe(
      false,
    );
  });
});
