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
  SearchRiseSet,
  VectorObserver,
} from "astronomy-engine";

/**
 * 한국표준시는 UTC+9이고 서머타임을 쓰지 않는다.
 * 기기 시간대와 상관없이 이 오프셋으로 날짜·시각을 정한다.
 */
const KST_OFFSET_MS = 9 * 60 * 60 * 1000;
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
  moonIlluminationPercent: number;
  moonPhaseName: string;
  planets: PlanetPlacement[];
};

export function kstDayStart(date: Date): Date {
  const shifted = new Date(date.getTime() + KST_OFFSET_MS);
  return new Date(
    Date.UTC(shifted.getUTCFullYear(), shifted.getUTCMonth(), shifted.getUTCDate()) - KST_OFFSET_MS,
  );
}

/** 가장 가까운 분으로 반올림한 한국표준시 `HH:MM`. */
export function formatKstTime(date: Date): string {
  const rounded = new Date(Math.round(date.getTime() / 60_000) * 60_000);
  const shifted = new Date(rounded.getTime() + KST_OFFSET_MS);
  const hour = String(shifted.getUTCHours()).padStart(2, "0");
  const minute = String(shifted.getUTCMinutes()).padStart(2, "0");
  return `${hour}:${minute}`;
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

export function directionSkyLabel(direction: Compass16): string {
  switch (direction) {
    case "북":
      return "북쪽 하늘";
    case "동":
      return "동쪽 하늘";
    case "남":
      return "남쪽 하늘";
    case "서":
      return "서쪽 하늘";
    default:
      return `${direction} 하늘`;
  }
}

/**
 * 달의 위상 이름.
 * `MoonPhase`가 정한 기준(0° 삭, 90° 상현, 180° 보름, 270° 하현) 사이를
 * 초승·상현과 보름 사이·보름과 하현 사이·그믐으로 부른다.
 * 밝기가 0%로 반올림되면, 하현을 지나 삭으로 가는 쪽은 그믐달, 그 외는 삭이다.
 */
export function moonPhaseName(phaseAngleDeg: number, illuminationPercent?: number): string {
  const phase = normalizeDegrees(phaseAngleDeg);
  if (illuminationPercent === 0) {
    return phase > 180 ? "그믐달" : "삭";
  }
  if (illuminationPercent === 100 || phase === 180) {
    return "보름달";
  }
  if (phase === 0) {
    return "삭";
  }
  if (phase < 90) {
    return "초승달";
  }
  if (phase === 90) {
    return "상현달";
  }
  if (phase < 180) {
    return "상현달과 보름달 사이";
  }
  if (phase === 270) {
    return "하현달";
  }
  if (phase < 270) {
    return "보름달과 하현달 사이";
  }
  return "그믐달";
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
 * 선택한 위치의 오늘(한국 날짜) 일출·일몰, 그 시각의 달, 지금 지평선 위의 행성.
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
  const moonIlluminationPercent = Math.min(
    100,
    Math.max(0, Math.round(illumination.phase_fraction * 100)),
  );

  const planets: PlanetPlacement[] = [];
  for (const planet of PLANETS) {
    const equatorial = Equator(planet.body, date, observer, true, true);
    const horizontal = Horizon(date, observer, equatorial.ra, equatorial.dec, "normal");
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
    moonIlluminationPercent,
    moonPhaseName: moonPhaseName(moonPhaseAngle, moonIlluminationPercent),
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
