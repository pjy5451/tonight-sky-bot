import { describe, expect, it } from "vitest";
import storedTleText from "../public/data/tle.json?raw";
import { globePixelRatio } from "../src/globe-view";
import {
  KOREA_PASS_HORIZON_MS,
  altitudeRatio,
  buildSatelliteScene,
  findNextOverflight,
  formatAltitude,
  formatDuration,
  formatGroundPosition,
  formatKoreaPassLabel,
  formatSpeed,
  isOverKorea,
  parseTleDocument,
  propagateStation,
  splitOrbitPaths,
  type Station,
} from "../src/satellites";

/**
 * David A. Vallado, Paul Crawford, Richard Hujsak, T.S. Kelso,
 * "Revisiting Spacetrack Report #3", AIAA 2006-6753.
 * 검증 위성 00005 (Vanguard 1)의 WGS-72 SGP4 상태.
 * 시각 0분과 360분의 TEME 위치·속도(km, km/s)는 공개 검증 벡터다.
 */
const VANGUARD = {
  OBJECT_NAME: "VANGUARD 1",
  OBJECT_ID: "1958-002B",
  EPOCH: "2000-06-27T18:50:19.733568Z",
  MEAN_MOTION: 10.82419157,
  ECCENTRICITY: 0.1859667,
  INCLINATION: 34.2682,
  RA_OF_ASC_NODE: 348.7242,
  ARG_OF_PERICENTER: 331.7664,
  MEAN_ANOMALY: 19.3264,
  NORAD_CAT_ID: 5,
  ELEMENT_SET_NO: 999,
  BSTAR: 2.8098e-5,
  MEAN_MOTION_DOT: 2.3e-7,
  MEAN_MOTION_DDOT: 0,
  EPHEMERIS_TYPE: 0,
  CLASSIFICATION_TYPE: "U",
};

const EPOCH = new Date(VANGUARD.EPOCH);
const PLUS_360_MIN = new Date(EPOCH.getTime() + 360 * 60 * 1000);

const STATE_AT_EPOCH = {
  position: [7022.46529266, -1400.08296755, 0.03995155],
  velocity: [1.893841015, 6.405893759, 4.53480725],
};

const STATE_AT_360 = {
  position: [-7154.03120202, -3783.17682504, -3536.19412294],
  velocity: [4.741887409, -4.151817765, -2.093935425],
};

function vanguardStation(): Station {
  const catalog = parseTleDocument({ fetched_at: VANGUARD.EPOCH, items: [VANGUARD] });
  const station = catalog.stations[0];
  if (!station) {
    throw new Error("검증 위성을 읽지 못했습니다.");
  }
  return station;
}

describe("propagateStation", () => {
  it("matches the published SGP4 state of satellite 00005 at epoch", () => {
    const fix = propagateStation(vanguardStation(), EPOCH);
    expect(fix).not.toBeNull();
    if (!fix) {
      return;
    }

    expect(fix.eciKm.x).toBeCloseTo(STATE_AT_EPOCH.position[0] ?? 0, 2);
    expect(fix.eciKm.y).toBeCloseTo(STATE_AT_EPOCH.position[1] ?? 0, 2);
    expect(fix.eciKm.z).toBeCloseTo(STATE_AT_EPOCH.position[2] ?? 0, 2);
    expect(fix.velocityKmS.x).toBeCloseTo(STATE_AT_EPOCH.velocity[0] ?? 0, 3);
    expect(fix.velocityKmS.y).toBeCloseTo(STATE_AT_EPOCH.velocity[1] ?? 0, 3);
    expect(fix.velocityKmS.z).toBeCloseTo(STATE_AT_EPOCH.velocity[2] ?? 0, 3);
    expect(fix.speedKmh).toBeCloseTo(
      Math.hypot(...STATE_AT_EPOCH.velocity) * 3600,
      1,
    );
    expect(fix.lat).toBeGreaterThanOrEqual(-90);
    expect(fix.lat).toBeLessThanOrEqual(90);
    expect(fix.lng).toBeGreaterThan(-180);
    expect(fix.lng).toBeLessThanOrEqual(180);
    expect(fix.altKm).toBeGreaterThan(100);
    expect(fix.altKm).toBeLessThan(40_000);
  });

  it("matches the published SGP4 state 360 minutes after epoch", () => {
    const fix = propagateStation(vanguardStation(), PLUS_360_MIN);
    expect(fix).not.toBeNull();
    if (!fix) {
      return;
    }

    expect(fix.eciKm.x).toBeCloseTo(STATE_AT_360.position[0] ?? 0, 2);
    expect(fix.eciKm.y).toBeCloseTo(STATE_AT_360.position[1] ?? 0, 2);
    expect(fix.eciKm.z).toBeCloseTo(STATE_AT_360.position[2] ?? 0, 2);
    expect(fix.velocityKmS.x).toBeCloseTo(STATE_AT_360.velocity[0] ?? 0, 3);
    expect(fix.velocityKmS.y).toBeCloseTo(STATE_AT_360.velocity[1] ?? 0, 3);
    expect(fix.velocityKmS.z).toBeCloseTo(STATE_AT_360.velocity[2] ?? 0, 3);
  });

  it("returns null for a date that is not a time", () => {
    expect(propagateStation(vanguardStation(), new Date("not-a-date"))).toBeNull();
  });
});

describe("station catalog", () => {
  it("reads the committed orbit file without inventing satellites", () => {
    expect(parseTleDocument(JSON.parse(storedTleText))).toEqual({
      fetchedAt: null,
      stations: [],
      error: "위성 궤도 데이터를 불러오지 못했습니다.",
    });
  });

  it("keeps a valid record and skips a record missing elements", () => {
    const catalog = parseTleDocument({
      fetched_at: "2026-11-10T12:00:00.000Z",
      items: [VANGUARD, { OBJECT_NAME: "BROKEN", NORAD_CAT_ID: 1 }],
    });

    expect(catalog.error).toBeNull();
    expect(catalog.fetchedAt).toBe("2026-11-10T12:00:00.000Z");
    expect(catalog.stations).toHaveLength(1);
    expect(catalog.stations[0]?.noradId).toBe(5);
  });

  it("reports an error document with no usable records", () => {
    expect(parseTleDocument({ error: "CelesTrak 요청 실패: HTTP 503", items: [] }).error).toBe(
      "위성 궤도 데이터를 불러오지 못했습니다.",
    );
  });
});

describe("globe scene", () => {
  it("highlights ISS and draws an orbit that does not jump the date line", () => {
    const iss = { ...VANGUARD, NORAD_CAT_ID: 25544, OBJECT_NAME: "ISS (ZARYA)" };
    const other = { ...VANGUARD, NORAD_CAT_ID: 48274, OBJECT_NAME: "CSS (TIANHE)" };
    const catalog = parseTleDocument({ items: [other, iss] });
    const scene = buildSatelliteScene(catalog.stations, EPOCH);

    expect(scene.points.map((point) => point.color)).toEqual(["#6CC4FF", "#F5B544"]);
    expect(scene.points.map((point) => point.iss)).toEqual([false, true]);
    expect(scene.iss?.station.noradId).toBe(25544);
    expect(scene.paths.length).toBeGreaterThan(0);
    expect(scene.paths.reduce((count, path) => count + path.points.length, 0)).toBeGreaterThan(30);

    for (const path of scene.paths) {
      for (let index = 1; index < path.points.length; index += 1) {
        const previous = path.points[index - 1];
        const point = path.points[index];
        expect(Math.abs((point?.lng ?? 0) - (previous?.lng ?? 0))).toBeLessThanOrEqual(180);
      }
    }

    expect(scene.iss && altitudeRatio(scene.iss.fix.altKm)).toBeCloseTo(scene.points[1]?.alt ?? 0, 6);
  });

  it("splits a ground track where longitude wraps and drops a lone point", () => {
    expect(
      splitOrbitPaths([
        { lat: 8, lng: 150, alt: 0.06 },
        { lat: 10, lng: 170, alt: 0.06 },
        { lat: 12, lng: -170, alt: 0.06 },
        { lat: 14, lng: -160, alt: 0.06 },
      ]),
    ).toEqual([
      [
        { lat: 8, lng: 150, alt: 0.06 },
        { lat: 10, lng: 170, alt: 0.06 },
      ],
      [
        { lat: 12, lng: -170, alt: 0.06 },
        { lat: 14, lng: -160, alt: 0.06 },
      ],
    ]);
  });

  it("drops a one-point fragment left by the date line", () => {
    expect(splitOrbitPaths([{ lat: 1, lng: 179, alt: 0 }, { lat: 1, lng: -179, alt: 0 }])).toEqual([]);
  });
});

describe("Korea overflights", () => {
  it("treats the peninsula as inside and other cities as outside", () => {
    expect(isOverKorea(37.6, 127)).toBe(true);
    expect(isOverKorea(35.2, 129.1)).toBe(true);
    expect(isOverKorea(33.4, 126.5)).toBe(true);
    expect(isOverKorea(21.3, -157.8)).toBe(false);
    expect(isOverKorea(51.5, -0.1)).toBe(false);
    expect(isOverKorea(43.1, 127)).toBe(false);
    expect(isOverKorea(33, 127)).toBe(false);
  });

  it("finds the first entry and a pass that is already overhead", () => {
    const start = new Date("2026-01-01T00:00:00.000Z");
    const entered = findNextOverflight(
      (date) => date.getTime() >= start.getTime() + 90 * 60 * 1000,
      start,
      30_000,
      3 * 60 * 60 * 1000,
    );
    expect(entered).toEqual({
      overheadNow: false,
      at: new Date(start.getTime() + 90 * 60 * 1000),
    });

    const overhead = findNextOverflight(() => true, start, 30_000, 60_000);
    expect(overhead).toEqual({ overheadNow: true, at: start });

    const none = findNextOverflight(() => false, start, 30_000, 60_000);
    expect(none).toEqual({ overheadNow: false, at: null });
    expect(formatKoreaPassLabel(none ?? { overheadNow: false, at: null }, start)).toBe(
      "18시간 안에 한국 상공을 지나지 않습니다.",
    );
    expect(KOREA_PASS_HORIZON_MS).toBe(18 * 60 * 60 * 1000);
  });

  it("stops when a sample cannot be calculated", () => {
    const start = new Date("2026-01-01T00:00:00.000Z");
    expect(
      findNextOverflight(
        (date) => (date.getTime() === start.getTime() ? false : null),
        start,
        30_000,
        60_000,
      ),
    ).toBeNull();
  });

  it("formats the countdown in hours and minutes", () => {
    const start = new Date("2026-01-01T00:00:00.000Z");
    expect(formatDuration(12 * 60 * 1000)).toBe("12분");
    expect(formatDuration(2 * 60 * 60 * 1000)).toBe("2시간");
    expect(formatDuration((60 + 12) * 60 * 1000)).toBe("1시간 12분");
    expect(
      formatKoreaPassLabel(
        { overheadNow: false, at: new Date(start.getTime() + (60 + 12) * 60 * 1000) },
        start,
      ),
    ).toBe("다음 한국 상공 통과까지 1시간 12분");
    expect(formatKoreaPassLabel({ overheadNow: true, at: start }, start)).toBe(
      "지금 한국 상공에 있습니다",
    );
  });
});

describe("readout formatting", () => {
  it("formats coordinates, altitude, and speed for the ISS card", () => {
    expect(formatGroundPosition(12.34, -145.26)).toBe("12.3°N\n145.3°W");
    expect(formatGroundPosition(-33.86, 151.21)).toBe("33.9°S\n151.2°E");
    expect(formatAltitude(419.6)).toBe("약 420 km");
    expect(formatSpeed(27600.4)).toBe("27,600 km/h");
  });
});

describe("mobile globe settings", () => {
  it("caps the pixel ratio lower on a narrow screen", () => {
    expect(globePixelRatio(3, true)).toBe(1.25);
    expect(globePixelRatio(1, true)).toBe(1);
    expect(globePixelRatio(3, false)).toBe(2);
    expect(globePixelRatio(Number.NaN, true)).toBe(1);
  });
});
