import { Body, Equator, Horizon, Observer, SearchAltitude } from "astronomy-engine";
import { describe, expect, it } from "vitest";
import {
  compass16,
  computeTonightSky,
  directionSkyLabel,
  formatKstTime,
  moonLitPath,
  moonPhaseName,
  subsolarPoint,
} from "../src/sky";

/**
 * 미국 해군 천문대(USNO) Astronomical Applications API v4.
 * https://aa.usno.navy.mil/api/rstt/oneday?date=2026-11-12&coords=37.6,127.0&tz=9
 * 2026-11-11 조회. 좌표는 앱이 저장하는 서울 대표값(북위 37.6, 동경 127.0)이다.
 * 일출 07:08, 일몰 17:24 (한국표준시), 달 조도 8%, waxing crescent.
 */
const SEOUL = { latitude: 37.6, longitude: 127 };
const NOON_KST = new Date("2026-11-12T03:00:00.000Z");
const USNO_SUNRISE = Date.parse("2026-11-11T22:08:00.000Z");
const USNO_SUNSET = Date.parse("2026-11-12T08:24:00.000Z");
const TWO_MINUTES_MS = 2 * 60 * 1000;

function pathPoints(path: string): Array<[number, number]> {
  const numbers = [...path.matchAll(/-?\d+\.\d+/g)].map((match) => Number(match[0]));
  const points: Array<[number, number]> = [];
  for (let index = 0; index + 1 < numbers.length; index += 2) {
    const x = numbers[index];
    const y = numbers[index + 1];
    if (x !== undefined && y !== undefined) {
      points.push([x, y]);
    }
  }
  return points;
}

describe("Korean Standard Time", () => {
  it("formats clock times in KST even when the runtime zone is UTC", () => {
    expect(formatKstTime(new Date("2026-11-12T08:23:39.335Z"))).toBe("17:24");
    expect(formatKstTime(new Date("2026-11-11T22:08:08.268Z"))).toBe("07:08");
    expect(formatKstTime(new Date("2026-11-12T14:59:30.000Z"))).toBe("00:00");
  });
});

describe("compass and moon phase names", () => {
  it("maps azimuth to the 16 Korean compass points", () => {
    expect(compass16(0)).toBe("북");
    expect(compass16(11.24)).toBe("북");
    expect(compass16(11.25)).toBe("북북동");
    expect(compass16(90)).toBe("동");
    expect(compass16(180)).toBe("남");
    expect(compass16(270)).toBe("서");
    expect(compass16(359)).toBe("북");
    expect(compass16(-90)).toBe("서");
    expect(directionSkyLabel("동")).toBe("동쪽 하늘");
    expect(directionSkyLabel("남남동")).toBe("남남동 하늘");
  });

  it("names the eight equal phases of the lunar cycle", () => {
    expect(moonPhaseName(0)).toBe("삭");
    expect(moonPhaseName(19.3, 3)).toBe("초승달");
    expect(moonPhaseName(22.5)).toBe("초승달");
    expect(moonPhaseName(90)).toBe("상현달");
    expect(moonPhaseName(135)).toBe("상현달과 보름달 사이");
    expect(moonPhaseName(180)).toBe("보름달");
    expect(moonPhaseName(225)).toBe("보름달과 하현달 사이");
    expect(moonPhaseName(270)).toBe("하현달");
    expect(moonPhaseName(315)).toBe("그믐달");
    expect(moonPhaseName(359)).toBe("그믐달");
    expect(moonPhaseName(359, 0)).toBe("그믐달");
    expect(moonPhaseName(5, 0)).toBe("삭");
  });
});

describe("moon shape", () => {
  it("draws a dark disk at new moon, a right-hand crescent, and a flipped southern limb", () => {
    expect(moonLitPath(0, false)).toBeNull();

    const crescent = moonLitPath(31.6, false);
    expect(crescent).not.toBeNull();
    const crescentPoints = pathPoints(crescent ?? "");
    expect(Math.max(...crescentPoints.map(([x]) => x))).toBeGreaterThan(18);
    const middle = crescentPoints.filter(([, y]) => y > 8 && y < 12);
    expect(Math.min(...middle.map(([x]) => x))).toBeGreaterThan(16);

    const quarter = pathPoints(moonLitPath(90, false) ?? "");
    expect(Math.min(...quarter.map(([x]) => x))).toBeGreaterThan(9.5);
    expect(Math.max(...quarter.map(([x]) => x))).toBeGreaterThan(18);

    const southernQuarter = pathPoints(moonLitPath(90, true) ?? "");
    expect(Math.max(...southernQuarter.map(([x]) => x))).toBeLessThan(10.5);
    expect(Math.min(...southernQuarter.map(([x]) => x))).toBeLessThan(2);

    const full = pathPoints(moonLitPath(180, false) ?? "");
    expect(Math.min(...full.map(([x]) => x))).toBeLessThan(2);
    expect(Math.max(...full.map(([x]) => x))).toBeGreaterThan(18);
  });
});

describe("tonight sky for a fixed place and time", () => {
  it("keeps sunrise and sunset within two minutes of the USNO times", () => {
    const sky = computeTonightSky(SEOUL, NOON_KST);

    expect(sky.sunrise).not.toBeNull();
    expect(sky.sunset).not.toBeNull();
    expect(Math.abs((sky.sunrise?.getTime() ?? 0) - USNO_SUNRISE)).toBeLessThanOrEqual(TWO_MINUTES_MS);
    expect(Math.abs((sky.sunset?.getTime() ?? 0) - USNO_SUNSET)).toBeLessThanOrEqual(TWO_MINUTES_MS);
    expect(formatKstTime(sky.sunrise ?? new Date(0))).toBe("07:08");
    expect(formatKstTime(sky.sunset ?? new Date(0))).toBe("17:24");
  });

  it("uses the KST calendar day, not the UTC day, for sunrise and sunset", () => {
    const justAfterKstMidnight = new Date("2026-11-12T15:30:00.000Z");
    const noonNextKstDay = new Date("2026-11-13T03:00:00.000Z");
    const early = computeTonightSky(SEOUL, justAfterKstMidnight);
    const later = computeTonightSky(SEOUL, noonNextKstDay);
    const previousDay = computeTonightSky(SEOUL, NOON_KST);

    expect(early.sunset?.toISOString()).toBe(later.sunset?.toISOString());
    expect(early.sunrise?.toISOString()).toBe(later.sunrise?.toISOString());
    expect(early.sunset?.toISOString()).not.toBe(previousDay.sunset?.toISOString());
  });

  it("reports the published moon illumination and a waxing crescent", () => {
    const sky = computeTonightSky(SEOUL, NOON_KST);
    const later = computeTonightSky(SEOUL, new Date("2026-11-20T03:00:00.000Z"));

    expect(sky.moonIlluminationPercent).toBe(8);
    expect(sky.moonPhaseName).toBe("초승달");
    expect(sky.moonPhaseAngle).toBeGreaterThan(22.5);
    expect(sky.moonPhaseAngle).toBeLessThan(67.5);
    expect(later.moonIlluminationPercent).not.toBe(sky.moonIlluminationPercent);
    expect(later.moonPhaseName).toBe("상현달과 보름달 사이");

    // 같은 USNO 조회, 날짜만 2026-11-11. 일출 07:07, 일몰 17:24, 달 3%, waxing crescent.
    const previousDay = computeTonightSky(SEOUL, new Date("2026-11-11T03:00:00.000Z"));
    expect(Math.abs((previousDay.sunrise?.getTime() ?? 0) - Date.parse("2026-11-10T22:07:00.000Z"))).toBeLessThanOrEqual(
      TWO_MINUTES_MS,
    );
    expect(Math.abs((previousDay.sunset?.getTime() ?? 0) - Date.parse("2026-11-11T08:24:00.000Z"))).toBeLessThanOrEqual(
      TWO_MINUTES_MS,
    );
    expect(previousDay.moonIlluminationPercent).toBe(3);
    expect(previousDay.moonPhaseName).toBe("초승달");
  });

  it("lists only the planets above the horizon, in Venus-Mars-Jupiter-Saturn order", () => {
    const noon = computeTonightSky(SEOUL, NOON_KST);
    expect(noon.planets.map((planet) => planet.name)).toEqual(["토성"]);
    expect(noon.planets.map((planet) => planet.direction)).toEqual(["동남동"]);
    expect(Math.round(noon.planets[0]?.altitude ?? Number.NaN)).toBe(26);
    for (const planet of noon.planets) {
      expect(planet.altitude).toBeGreaterThan(0);
      expect(planet.direction).toBe(compass16(planet.azimuth));
    }

    const eveningDate = new Date("2026-11-12T12:00:00.000Z");
    const evening = computeTonightSky(SEOUL, eveningDate);
    expect(evening.planets.map((planet) => planet.name)).toEqual(["토성"]);
    expect(evening.planets[0]?.direction).toBe("남남동");
    expect(evening.planets[0]?.altitude).toBeGreaterThan(0);
    expect(evening.planetTime.toISOString()).toBe(eveningDate.toISOString());
  });

  it("uses the next sun altitude of -6° for planets while the sun is still up", () => {
    const when = new Date("2026-11-12T04:39:00.000Z");
    const sky = computeTonightSky(SEOUL, when);
    const observer = new Observer(SEOUL.latitude, SEOUL.longitude, 0);
    const next = SearchAltitude(Body.Sun, observer, -1, when, 2, -6);
    expect(next).not.toBeNull();
    const night = next?.date ?? when;
    expect(night.toISOString()).not.toBe(when.toISOString());
    expect(sky.planetTime.toISOString()).toBe(night.toISOString());
    expect(formatKstTime(sky.planetTime)).toBe("17:51");

    const bodies = [Body.Venus, Body.Mars, Body.Jupiter, Body.Saturn] as const;
    const above = bodies.flatMap((body) => {
      const equatorial = Equator(body, night, observer, true, true);
      const horizontal = Horizon(night, observer, equatorial.ra, equatorial.dec, "normal");
      return horizontal.altitude > 0
        ? [{ body, altitude: horizontal.altitude, direction: compass16(horizontal.azimuth) }]
        : [];
    });
    expect(above.map((row) => row.body)).toEqual([Body.Saturn]);
    expect(sky.planets.map((planet) => planet.id)).toEqual(["saturn"]);
    expect(sky.planets).toHaveLength(above.length);
    for (const [index, row] of above.entries()) {
      const planet = sky.planets[index];
      expect(planet?.direction).toBe(row.direction);
      expect(Math.abs((planet?.altitude ?? 0) - row.altitude)).toBeLessThanOrEqual(1);
    }
  });

  it("does not invent a sunrise or sunset during the midnight sun", () => {
    const polarDay = computeTonightSky(
      { latitude: 78.22, longitude: 15.65 },
      new Date("2026-06-21T12:00:00.000Z"),
    );
    expect(polarDay.sunrise).toBeNull();
    expect(polarDay.sunset).toBeNull();
    expect(polarDay.planetTime.toISOString()).toBe("2026-06-21T12:00:00.000Z");
  });
});

describe("subsolar point", () => {
  it("rejects an invalid time", () => {
    expect(() => subsolarPoint(new Date("not-a-date"))).toThrow(RangeError);
  });

  it("is near latitude 0° and longitude 0° at 2026-03-20 12:00 UTC", () => {
    const point = subsolarPoint(new Date("2026-03-20T12:00:00.000Z"));
    expect(Number.isFinite(point.latitude)).toBe(true);
    expect(Number.isFinite(point.longitude)).toBe(true);
    expect(Math.abs(point.latitude)).toBeLessThanOrEqual(3);
    expect(Math.abs(point.longitude)).toBeLessThanOrEqual(3);
  });

  it("shifts about 90° west after six hours of Earth rotation", () => {
    const noon = subsolarPoint(new Date("2026-03-20T12:00:00.000Z"));
    const later = subsolarPoint(new Date("2026-03-20T18:00:00.000Z"));
    const eastward = ((later.longitude - noon.longitude + 540) % 360) - 180;
    expect(eastward).toBeGreaterThan(-95);
    expect(eastward).toBeLessThan(-85);
  });
});
