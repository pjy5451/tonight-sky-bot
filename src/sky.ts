import {
  Body,
  Equator,
  GeoVector,
  Horizon,
  Illumination,
  MoonPhase,
  Observer,
  RotateVector,
  Rotation_EQJ_EQD,
  SearchAltitude,
  SearchRiseSet,
  VectorObserver,
} from "astronomy-engine";
import { formatClock, localDayStart } from "./clock";
import { translate, type Locale, type MessageKey } from "./i18n";

const DAY_MS = 24 * 60 * 60 * 1000;

const COMPASS_16 = [
  "북",
  "북북동",
  "북동",
  "동북동",
  "동",
  "동남동",
  "남동",
  "남남동",
  "남",
  "남남서",
  "남서",
  "서남서",
  "서",
  "서북서",
  "북서",
  "북북서",
] as const;

export type Compass16 = (typeof COMPASS_16)[number];

const COMPASS_KEY: Record<Compass16, MessageKey> = {
  북: "compassNorth",
  북북동: "compassNorthNortheast",
  북동: "compassNortheast",
  동북동: "compassEastNortheast",
  동: "compassEast",
  동남동: "compassEastSoutheast",
  남동: "compassSoutheast",
  남남동: "compassSouthSoutheast",
  남: "compassSouth",
  남남서: "compassSouthSouthwest",
  남서: "compassSouthwest",
  서남서: "compassWestSouthwest",
  서: "compassWest",
  서북서: "compassWestNorthwest",
  북서: "compassNorthwest",
  북북서: "compassNorthNorthwest",
};

const PLANETS = [
  { id: "venus", name: "금성", body: Body.Venus },
  { id: "mars", name: "화성", body: Body.Mars },
  { id: "jupiter", name: "목성", body: Body.Jupiter },
  { id: "saturn", name: "토성", body: Body.Saturn },
] as const;

export type PlanetId = (typeof PLANETS)[number]["id"];
export type PlanetName = (typeof PLANETS)[number]["name"];

export type SkyPlace = {
  latitude: number;
  longitude: number;
};

export type PlanetPlacement = {
  id: PlanetId;
  name: PlanetName;
  azimuth: number;
  altitude: number;
  direction: Compass16;
};

export type TonightSky = {
  sunrise: Date | null;
  sunset: Date | null;
  moonPhaseAngle: number;
  /** 달 조도 0~1. 관측 지수는 반올림 전의 이 값을 쓴다. */
  moonIllumination: number;
  moonIlluminationPercent: number;
  moonPhaseName: string;
  /** 행성 목록을 계산한 시각. 해가 떠 있으면 다음 태양 고도 −6° 시각이다. */
  planetTime: Date;
  planets: PlanetPlacement[];
};

/**
 * 기기 시간대에서 그 날짜의 자정.
 * 시간대를 넘기면 그 달력이다. 테스트 프로세스는 Asia/Seoul이라 한국 자정과 같다.
 */
export function kstDayStart(date: Date, timeZone?: string): Date {
  return localDayStart(date, timeZone);
}

/**
 * 기기 시간대의 `HH:MM`. 분은 가장 가까운 분으로 반올림한다.
 * 시간대를 넘기면 그 달력의 시·분이다. Asia/Seoul에서는 한국시간과 같다.
 */
export function formatKstTime(date: Date, timeZone?: string): string {
  return formatClock(date, timeZone);
}

function normalizeDegrees(degrees: number): number {
  return ((degrees % 360) + 360) % 360;
}

/**
 * 16방위. 북이 0°이고 동쪽으로 갈수록 증가한다.
 * 한 칸은 22.5°(360°/16)이고, 경계는 방위각이 커지는 쪽으로 붙인다.
 */
export function compass16(azimuthDegrees: number): Compass16 {
  if (!Number.isFinite(azimuthDegrees)) {
    throw new RangeError("방위각이 올바른 숫자가 아닙니다.");
  }
  const index = Math.round(normalizeDegrees(azimuthDegrees) / 22.5) % 16;
  return COMPASS_16[index] ?? "북";
}

export function compassLabel(direction: Compass16, locale: Locale = "ko"): string {
  return translate(locale, COMPASS_KEY[direction]);
}

export function directionSkyLabel(direction: Compass16, locale: Locale = "ko"): string {
  switch (direction) {
    case "북":
      return translate(locale, "skyNorth");
    case "동":
      return translate(locale, "skyEast");
    case "남":
      return translate(locale, "skySouth");
    case "서":
      return translate(locale, "skyWest");
    default:
      return translate(locale, "skyOther", { direction: compassLabel(direction, locale) });
  }
}

/**
 * 달의 위상 이름.
 * `MoonPhase`가 정한 기준(0° 삭, 90° 상현, 180° 보름, 270° 하현) 사이를
 * 초승·상현과 보름 사이·보름과 하현 사이·그믐으로 부른다.
 * 밝기가 0%로 반올림되면, 하현을 지나 삭으로 가는 쪽은 그믐달, 그 외는 삭이다.
 */
function moonPhaseKey(phaseAngleDeg: number, illuminationPercent?: number): MessageKey {
  const phase = normalizeDegrees(phaseAngleDeg);
  if (illuminationPercent === 0) {
    return phase > 180 ? "moonWaningCrescent" : "moonNew";
  }
  if (illuminationPercent === 100 || phase === 180) {
    return "moonFull";
  }
  if (phase === 0) {
    return "moonNew";
  }
  if (phase < 90) {
    return "moonWaxingCrescent";
  }
  if (phase === 90) {
    return "moonFirstQuarter";
  }
  if (phase < 180) {
    return "moonWaxingGibbous";
  }
  if (phase === 270) {
    return "moonLastQuarter";
  }
  if (phase < 270) {
    return "moonWaningGibbous";
  }
  return "moonWaningCrescent";
}

export function moonPhaseName(
  phaseAngleDeg: number,
  illuminationPercent?: number,
  locale: Locale = "ko",
): string {
  return translate(locale, moonPhaseKey(phaseAngleDeg, illuminationPercent));
}

/**
 * 달의 밝은 부분 SVG path. 북반구는 초승이 오른쪽, 남반구는 왼쪽이다.
 * 가로축은 오른쪽이 동쪽 방향(화면 오른쪽)이다.
 * 너무 가늘어 면적이 없으면 null (삭).
 */
export function moonLitPath(phaseAngleDeg: number, brightOnLeft: boolean): string | null {
  const cx = 10;
  const cy = 10;
  const radius = 9;
  const phase = (normalizeDegrees(phaseAngleDeg) * Math.PI) / 180;
  const sinPhase = Math.sin(phase);
  const cosPhase = Math.cos(phase);
  const steps = 48;
  const rows: Array<{ y: number; x0: number; x1: number }> = [];
  let maxWidth = 0;

  for (let index = 0; index <= steps; index += 1) {
    const yMath = radius - (2 * radius * index) / steps;
    const half = Math.sqrt(Math.max(0, radius * radius - yMath * yMath));
    let x0: number;
    let x1: number;
    if (sinPhase >= 0) {
      x0 = cosPhase * half;
      x1 = half;
    } else {
      x0 = -half;
      x1 = -cosPhase * half;
    }
    if (brightOnLeft) {
      const flipped0 = -x1;
      const flipped1 = -x0;
      x0 = flipped0;
      x1 = flipped1;
    }
    if (x1 < x0) {
      const swap = x0;
      x0 = x1;
      x1 = swap;
    }
    maxWidth = Math.max(maxWidth, x1 - x0);
    rows.push({ y: cy - yMath, x0: cx + x0, x1: cx + x1 });
  }

  if (maxWidth < 0.15) {
    return null;
  }

  const format = (value: number) => value.toFixed(2);
  const rightEdge = rows.map((row) => `${format(row.x1)} ${format(row.y)}`);
  const leftEdge = rows.map((row) => `${format(row.x0)} ${format(row.y)}`);
  const commands = [`M ${rightEdge[0]}`];
  for (const point of rightEdge.slice(1)) {
    commands.push(`L ${point}`);
  }
  for (let index = leftEdge.length - 1; index >= 0; index -= 1) {
    commands.push(`L ${leftEdge[index]}`);
  }
  commands.push("Z");
  return commands.join(" ");
}

function riseOrSetOnKstDay(
  body: Body,
  observer: Observer,
  direction: 1 | -1,
  dayStart: Date,
): Date | null {
  const found = SearchRiseSet(body, observer, direction, dayStart, 1);
  if (!found) {
    return null;
  }
  const time = found.date.getTime();
  const start = dayStart.getTime();
  if (time < start || time >= start + DAY_MS) {
    return null;
  }
  return new Date(time);
}

function assertPlace(place: SkyPlace): void {
  if (!Number.isFinite(place.latitude) || place.latitude < -90 || place.latitude > 90) {
    throw new RangeError("위도가 올바르지 않습니다.");
  }
  if (!Number.isFinite(place.longitude) || place.longitude < -180 || place.longitude > 180) {
    throw new RangeError("경도가 올바르지 않습니다.");
  }
}

/**
 * 행성 목록을 볼 시각.
 * 태양 중심 고도(굴절 없음, SearchAltitude와 같은 기준)가 −6°보다 높으면
 * 다음에 그 고도를 지나 내려가는 시각을 쓴다. 이미 −6° 이하이거나
 * 그 시각이 없으면(극주) 지금 시각을 쓴다.
 */
function planetMoment(observer: Observer, date: Date): Date {
  const sun = Equator(Body.Sun, date, observer, true, true);
  const sunAltitude = Horizon(date, observer, sun.ra, sun.dec).altitude;
  if (!(sunAltitude > -6)) {
    return date;
  }
  const found = SearchAltitude(Body.Sun, observer, -1, date, 2, -6);
  return found ? found.date : date;
}

/**
 * 선택한 위치의 오늘(기기 시간대 날짜) 일출·일몰, 그 시각의 달,
 * 오늘 밤(태양 고도 −6° 이하) 지평선 위의 행성.
 * 프로세스가 Asia/Seoul이면 오늘 날짜는 한국 날짜와 같다.
 * 고도는 저장하지 않으므로 평균 해수면(0m)에서 본다.
 * 일출·일몰은 astronomy-engine `SearchRiseSet`(태양 윗가장자리와 표준 대기굴절)을 쓴다.
 */
export function computeTonightSky(place: SkyPlace, date: Date): TonightSky {
  assertPlace(place);
  if (Number.isNaN(date.getTime())) {
    throw new RangeError("시각이 올바르지 않습니다.");
  }

  const observer = new Observer(place.latitude, place.longitude, 0);
  const dayStart = kstDayStart(date);
  const sunrise = riseOrSetOnKstDay(Body.Sun, observer, 1, dayStart);
  const sunset = riseOrSetOnKstDay(Body.Sun, observer, -1, dayStart);

  const moonPhaseAngle = MoonPhase(date);
  const illumination = Illumination(Body.Moon, date);
  const moonIllumination = Math.min(1, Math.max(0, illumination.phase_fraction));
  const moonIlluminationPercent = Math.min(100, Math.max(0, Math.round(moonIllumination * 100)));

  const planetTime = planetMoment(observer, date);
  const planets: PlanetPlacement[] = [];
  for (const planet of PLANETS) {
    const equatorial = Equator(planet.body, planetTime, observer, true, true);
    const horizontal = Horizon(planetTime, observer, equatorial.ra, equatorial.dec, "normal");
    if (horizontal.altitude > 0) {
      planets.push({
        id: planet.id,
        name: planet.name,
        azimuth: horizontal.azimuth,
        altitude: horizontal.altitude,
        direction: compass16(horizontal.azimuth),
      });
    }
  }

  return {
    sunrise,
    sunset,
    moonPhaseAngle,
    moonIllumination,
    moonIlluminationPercent,
    moonPhaseName: moonPhaseName(moonPhaseAngle, moonIlluminationPercent),
    planetTime,
    planets,
  };
}

export type SubsolarPoint = {
  latitude: number;
  longitude: number;
};

/**
 * 태양이 머리 위에 있는 지점.
 * 지구 중심에서 본 태양 방향(광행차 보정, J2000)을 그날의 적도로 돌린 뒤
 * astronomy-engine `VectorObserver`가 정한 지리 위도·경도를 쓴다.
 */
export function subsolarPoint(date: Date): SubsolarPoint {
  if (Number.isNaN(date.getTime())) {
    throw new RangeError("시각이 올바르지 않습니다.");
  }
  const ofDate = RotateVector(Rotation_EQJ_EQD(date), GeoVector(Body.Sun, date, true));
  const place = VectorObserver(ofDate, true);
  return {
    latitude: place.latitude,
    longitude: place.longitude,
  };
}
