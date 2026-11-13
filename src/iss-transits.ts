import {
  Body,
  Equator,
  Horizon,
  KM_PER_AU,
  Observer,
} from "astronomy-engine";
import {
  degreesToRadians,
  eciToEcf,
  ecfToLookAngles,
  gstime,
  json2satrec,
  propagate,
  radiansToDegrees,
  twoline2satrec,
  type SatRec,
} from "satellite.js";
import type { PassObserver } from "./iss-passes";
import type { Station } from "./satellites";

/** IAU nominal solar radius. */
export const SUN_RADIUS_KM = 695700;

/** IAU mean lunar radius. */
export const MOON_RADIUS_KM = 1737.4;

/** 거친 탐색 간격. 백로그 34. */
export const TRANSIT_COARSE_STEP_MS = 2_000;

/** 각거리 2° 미만인 구간의 다시 보는 간격. */
export const TRANSIT_FINE_STEP_MS = 250;

/** 이 각거리보다 가까운 이웃 구간만 0.25초로 다시 본다. */
export const TRANSIT_REFINE_DEG = 2;

export type TransitBody = "sun" | "moon";

export type IssTransit = {
  body: TransitBody;
  time: Date;
};

export type TransitSample = {
  /** 관측자 지평 고도·방위로 잰 각거리(도). 통과 판정은 이 값만 쓴다. */
  angularDistanceDeg: number;
  /** 지구 중심 각거리. 넘겨도 판정에 쓰지 않는다. */
  geocentricAngularDistanceDeg?: number;
  issAltitudeDeg: number;
  angularRadiusDeg: number;
};

type Vec3 = { x: number; y: number; z: number };

type Look = {
  altitudeDeg: number;
  azimuthDeg: number;
};

const BODY = {
  sun: Body.Sun,
  moon: Body.Moon,
} as const;

const RADIUS_KM = {
  sun: SUN_RADIUS_KM,
  moon: MOON_RADIUS_KM,
} as const;

function finiteVector(value: unknown): Vec3 | null {
  if (!value || typeof value !== "object") {
    return null;
  }
  const vec = value as { x?: unknown; y?: unknown; z?: unknown };
  if (typeof vec.x !== "number" || typeof vec.y !== "number" || typeof vec.z !== "number") {
    return null;
  }
  if (!Number.isFinite(vec.x) || !Number.isFinite(vec.y) || !Number.isFinite(vec.z)) {
    return null;
  }
  return { x: vec.x, y: vec.y, z: vec.z };
}

function geodeticOf(place: PassObserver): { longitude: number; latitude: number; height: number } | null {
  if (!Number.isFinite(place.latitude) || place.latitude < -90 || place.latitude > 90) {
    return null;
  }
  if (!Number.isFinite(place.longitude) || place.longitude < -180 || place.longitude > 180) {
    return null;
  }
  const heightMeters = Number.isFinite(place.heightMeters) ? place.heightMeters : 0;
  return {
    latitude: degreesToRadians(place.latitude),
    longitude: degreesToRadians(place.longitude),
    height: heightMeters / 1000,
  };
}

/** 관측자 거리(km)로 본 원반 각반지름(도). */
export function angularRadiusDeg(radiusKm: number, distanceKm: number): number {
  if (!(radiusKm > 0) || !(distanceKm > radiusKm)) {
    return 0;
  }
  return (Math.asin(radiusKm / distanceKm) * 180) / Math.PI;
}

/** AU 거리를 km로 바꾼다. 변환은 astronomy-engine의 KM_PER_AU만 쓴다. */
export function distanceKmFromAu(distanceAu: number): number {
  return distanceAu * KM_PER_AU;
}

/**
 * 같은 관측자의 지평 고도·방위 두 점 사이 각거리(도).
 * 지구 중심 방향의 사잇각이 아니다.
 */
export function angularSeparationDeg(
  altitude1Deg: number,
  azimuth1Deg: number,
  altitude2Deg: number,
  azimuth2Deg: number,
): number {
  const alt1 = (altitude1Deg * Math.PI) / 180;
  const alt2 = (altitude2Deg * Math.PI) / 180;
  const az1 = (azimuth1Deg * Math.PI) / 180;
  const az2 = (azimuth2Deg * Math.PI) / 180;
  const cosine =
    Math.sin(alt1) * Math.sin(alt2) +
    Math.cos(alt1) * Math.cos(alt2) * Math.cos(az1 - az2);
  const clamped = Math.min(1, Math.max(-1, cosine));
  return (Math.acos(clamped) * 180) / Math.PI;
}

function observerDistanceDeg(sample: TransitSample): number {
  return typeof sample.angularDistanceDeg === "number" && Number.isFinite(sample.angularDistanceDeg)
    ? sample.angularDistanceDeg
    : Number.POSITIVE_INFINITY;
}

function qualifies(sample: TransitSample): boolean {
  return observerDistanceDeg(sample) < sample.angularRadiusDeg && sample.issAltitudeDeg > 0;
}

/**
 * 시작부터 2초마다 보고, 이웃 중 각거리가 2° 미만이면 그 닫힌 구간을 0.25초로 다시 본다.
 * 0.25초 샘플에서 각거리가 각반지름보다 작고 ISS 고도가 0°보다 큰 연속 구간이 통과 1건이다.
 * 시각은 그 구간에서 각거리가 가장 작은 샘플이다.
 * `elapsedSeconds`는 시작 시각부터의 초다.
 */
export function searchTransitTimes(
  start: Date,
  end: Date,
  sampleAt: (elapsedSeconds: number) => TransitSample,
): Date[] {
  const startMs = start.getTime();
  const endMs = end.getTime();
  if (!Number.isFinite(startMs) || !Number.isFinite(endMs) || endMs <= startMs) {
    return [];
  }

  const cache = new Map<number, TransitSample>();
  const at = (ms: number): TransitSample => {
    const cached = cache.get(ms);
    if (cached) {
      return cached;
    }
    const sample = sampleAt((ms - startMs) / 1000);
    cache.set(ms, sample);
    return sample;
  };

  const coarse: number[] = [];
  for (let ms = startMs; ms <= endMs; ms += TRANSIT_COARSE_STEP_MS) {
    coarse.push(ms);
  }

  const fine = new Set<number>();
  for (let index = 0; index < coarse.length - 1; index += 1) {
    const left = coarse[index];
    const right = coarse[index + 1];
    if (left === undefined || right === undefined) {
      continue;
    }
    const leftDistance = observerDistanceDeg(at(left));
    const rightDistance = observerDistanceDeg(at(right));
    if (leftDistance < TRANSIT_REFINE_DEG || rightDistance < TRANSIT_REFINE_DEG) {
      for (let ms = left; ms <= right; ms += TRANSIT_FINE_STEP_MS) {
        fine.add(ms);
      }
    }
  }

  const hits: Date[] = [];
  let run: Array<{ ms: number; distance: number }> = [];
  let previousMs: number | null = null;

  const flush = () => {
    if (run.length === 0) {
      return;
    }
    let best = run[0];
    if (!best) {
      run = [];
      return;
    }
    for (const item of run) {
      if (item.distance < best.distance) {
        best = item;
      }
    }
    hits.push(new Date(best.ms));
    run = [];
  };

  for (const ms of [...fine].sort((left, right) => left - right)) {
    const sample = at(ms);
    const distance = observerDistanceDeg(sample);
    const continuous = previousMs !== null && ms - previousMs <= TRANSIT_FINE_STEP_MS;
    if (!qualifies(sample)) {
      flush();
    } else if (!continuous) {
      flush();
      run.push({ ms, distance });
    } else {
      run.push({ ms, distance });
    }
    previousMs = ms;
  }
  flush();
  return hits;
}

function miss(altitudeDeg: number): TransitSample {
  return {
    angularDistanceDeg: 180,
    issAltitudeDeg: altitudeDeg,
    angularRadiusDeg: 0,
  };
}

function issLook(
  satrec: SatRec,
  geodetic: { longitude: number; latitude: number; height: number },
  date: Date,
): Look | null {
  const propagated = propagate(satrec, date);
  const position = finiteVector(propagated?.position);
  if (!position) {
    return null;
  }
  const ecf = eciToEcf(position, gstime(date));
  const look = ecfToLookAngles(geodetic, ecf);
  return {
    altitudeDeg: radiansToDegrees(look.elevation),
    azimuthDeg: (radiansToDegrees(look.azimuth) + 360) % 360,
  };
}

function sampleBody(
  look: Look,
  place: PassObserver,
  date: Date,
  body: TransitBody,
): TransitSample {
  if (!(look.altitudeDeg > 0)) {
    return miss(look.altitudeDeg);
  }
  const observer = new Observer(place.latitude, place.longitude, place.heightMeters);
  const equatorial = Equator(BODY[body], date, observer, true, true);
  const horizontal = Horizon(date, observer, equatorial.ra, equatorial.dec, "normal");
  return {
    angularDistanceDeg: angularSeparationDeg(
      look.altitudeDeg,
      look.azimuthDeg,
      horizontal.altitude,
      horizontal.azimuth,
    ),
    issAltitudeDeg: look.altitudeDeg,
    angularRadiusDeg: angularRadiusDeg(RADIUS_KM[body], distanceKmFromAu(equatorial.dist)),
  };
}

/**
 * 한 시각의 관측자 각거리·ISS 고도·각반지름.
 * 각거리는 지평 고도·방위, 각반지름은 관측자 거리로 구한다.
 */
export function measureIssTransit(
  satrec: SatRec,
  place: PassObserver,
  date: Date,
  body: TransitBody,
): TransitSample {
  const geodetic = geodeticOf(place);
  if (!geodetic || Number.isNaN(date.getTime())) {
    return miss(-90);
  }
  let look: Look | null;
  try {
    look = issLook(satrec, geodetic, date);
  } catch {
    return miss(-90);
  }
  if (!look) {
    return miss(-90);
  }
  try {
    return sampleBody(look, place, date, body);
  } catch {
    return miss(look.altitudeDeg);
  }
}

export function predictIssTransits(
  satrec: SatRec,
  place: PassObserver,
  start: Date,
  end: Date,
): IssTransit[] {
  const geodetic = geodeticOf(place);
  const startMs = start.getTime();
  if (satrec.error !== 0 || !geodetic || !Number.isFinite(startMs)) {
    return [];
  }

  const looks = new Map<number, Look | null>();
  const lookAt = (elapsedSeconds: number): Look | null => {
    const ms = startMs + Math.round(elapsedSeconds * 1000);
    const cached = looks.get(ms);
    if (cached !== undefined) {
      return cached;
    }
    let look: Look | null;
    try {
      look = issLook(satrec, geodetic, new Date(ms));
    } catch {
      look = null;
    }
    looks.set(ms, look);
    return look;
  };

  const events = (["sun", "moon"] as const).flatMap((body) => {
    const times = searchTransitTimes(start, end, (elapsedSeconds) => {
      const look = lookAt(elapsedSeconds);
      if (!look) {
        return miss(-90);
      }
      const ms = startMs + Math.round(elapsedSeconds * 1000);
      try {
        return sampleBody(look, place, new Date(ms), body);
      } catch {
        return miss(look.altitudeDeg);
      }
    });
    return times.map((time) => ({ body, time }));
  });

  events.sort((left, right) => {
    const delta = left.time.getTime() - right.time.getTime();
    if (delta !== 0) {
      return delta;
    }
    return left.body === right.body ? 0 : left.body === "sun" ? -1 : 1;
  });
  return events;
}

/** 테스트가 05번 픽스처 TLE 문자열을 인자로 넘길 때 쓴다. 화면은 이 함수를 부르지 않는다. */
export function predictIssTransitsFromTle(
  tle: string,
  place: PassObserver,
  start: Date,
  end: Date,
): IssTransit[] {
  const lines = tle
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
  const line1 = lines.find((line) => line.startsWith("1 "));
  const line2 = lines.find((line) => line.startsWith("2 "));
  if (!line1 || !line2) {
    return [];
  }
  try {
    const satrec = twoline2satrec(line1, line2);
    if (satrec.error !== 0) {
      return [];
    }
    return predictIssTransits(satrec, place, start, end);
  } catch {
    return [];
  }
}

/** 화면이 tle.json에서 고른 ISS 레코드로 통과를 계산한다. */
export function predictStationTransits(
  station: Station,
  place: PassObserver,
  start: Date,
  end: Date,
): IssTransit[] {
  try {
    const satrec = json2satrec(station.omm);
    if (satrec.error !== 0) {
      return [];
    }
    return predictIssTransits(satrec, place, start, end);
  } catch {
    return [];
  }
}
