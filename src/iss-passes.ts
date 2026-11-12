import { Body, Equator, Horizon, Observer } from "astronomy-engine";
import {
  constants,
  degreesToRadians,
  eciToEcf,
  ecfToLookAngles,
  gstime,
  jday,
  json2satrec,
  propagate,
  radiansToDegrees,
  sunPos,
  twoline2satrec,
  type SatRec,
} from "satellite.js";
import { translate, type Locale } from "./i18n";
import type { Station } from "./satellites";
import { compass16, compassLabel, formatKstTime, kstDayStart, type Compass16 } from "./sky";

/** 보이는 통과로 칠 최저 고도. 백로그 05. */
export const ISS_PASS_MIN_ELEVATION_DEG = 10;

/** 관측자 위치에서 태양이 이 고도 이하일 때만 통과로 센다. */
export const ISS_PASS_MAX_SUN_ALTITUDE_DEG = -6;

/** 오늘 밤을 포함해 앞으로 볼 구간. */
export const ISS_PASS_HORIZON_MS = 3 * 24 * 60 * 60 * 1000;

/**
 * 이미 떠 있는 통과의 시작을 놓치지 않도록 되돌아보는 시간.
 * 고도 10° 이상인 ISS 통과는 10분을 넘기지 않는다.
 */
export const ISS_PASS_LOOKBACK_MS = 15 * 60 * 1000;

const COARSE_STEP_MS = 10_000;
const PEAK_STEP_MS = 1_000;
const DAY_MS = 24 * 60 * 60 * 1000;
const EN_DASH = "\u2013";

export type PassObserver = {
  latitude: number;
  longitude: number;
  /** 평균 해수면 위 높이. 앱은 높이를 저장하지 않으므로 0을 쓴다. */
  heightMeters: number;
};

export type IssPassPoint = {
  time: Date;
  azimuth: number;
  elevation: number;
  direction: Compass16;
};

export type IssPass = {
  start: IssPassPoint;
  peak: IssPassPoint;
  end: IssPassPoint;
};

type Vec3 = { x: number; y: number; z: number };

type Sight = {
  time: number;
  azimuth: number;
  elevation: number;
  visible: boolean;
};

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

/**
 * 지구 그림자. satellite.js 태양 방향(SGP4와 같은 적도 좌표계)의 반대편이고,
 * 지구-태양 축에서 수직 거리가 satellite.js `earthRadius`보다 작으면 그림자 안이다.
 */
function inEarthShadow(position: Vec3, date: Date): boolean {
  const sun = sunPos(jday(date)).rsun;
  const sunDistance = Math.hypot(sun[0], sun[1], sun[2]);
  if (sunDistance === 0) {
    return false;
  }
  const along = (position.x * sun[0] + position.y * sun[1] + position.z * sun[2]) / sunDistance;
  if (along >= 0) {
    return false;
  }
  const radius = Math.hypot(position.x, position.y, position.z);
  const radial = Math.sqrt(Math.max(0, radius * radius - along * along));
  return radial < constants.earthRadius;
}

function sunAltitudeDegrees(date: Date, place: PassObserver): number {
  const observer = new Observer(place.latitude, place.longitude, place.heightMeters);
  const equatorial = Equator(Body.Sun, date, observer, true, true);
  return Horizon(date, observer, equatorial.ra, equatorial.dec, "normal").altitude;
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

function pointFrom(sample: Sight): IssPassPoint {
  return {
    time: new Date(sample.time),
    azimuth: sample.azimuth,
    elevation: sample.elevation,
    direction: compass16(sample.azimuth),
  };
}

/**
 * 한 구간의 ISS 통과.
 * 시작은 고도 10°에 올라오거나 지구 그림자에서 나오는 시각,
 * 최고는 그 구간에서 가장 높은 시각,
 * 종료는 고도 10° 아래로 내려가거나 지구 그림자로 들어가는 시각이다.
 * 관측자 하늘에서 태양 고도가 -6°보다 높으면 그 시각은 구간에 넣지 않는다.
 */
export function predictIssPasses(
  satrec: SatRec,
  place: PassObserver,
  start: Date,
  end: Date,
): IssPass[] {
  const observer = geodeticOf(place);
  const begin = start.getTime();
  const finish = end.getTime();
  if (!observer || Number.isNaN(begin) || Number.isNaN(finish) || finish <= begin) {
    return [];
  }

  const sightAt = (time: number): Sight | null => {
    const date = new Date(time);
    const propagated = propagate(satrec, date);
    const position = finiteVector(propagated?.position);
    if (!position) {
      return null;
    }
    const ecf = eciToEcf(position, gstime(date));
    const look = ecfToLookAngles(observer, ecf);
    const elevation = radiansToDegrees(look.elevation);
    const azimuth = (radiansToDegrees(look.azimuth) + 360) % 360;
    const visible =
      elevation >= ISS_PASS_MIN_ELEVATION_DEG &&
      !inEarthShadow(position, date) &&
      sunAltitudeDegrees(date, place) <= ISS_PASS_MAX_SUN_ALTITUDE_DEG;
    return { time, azimuth, elevation, visible };
  };

  const isVisible = (time: number): boolean => sightAt(time)?.visible ?? false;

  const refine = (hidden: number, shown: number, entering: boolean): number => {
    let lo = hidden;
    let hi = shown;
    for (let step = 0; step < 24; step += 1) {
      const mid = (lo + hi) / 2;
      const visible = isVisible(mid);
      if (entering ? visible : !visible) {
        hi = mid;
      } else {
        lo = mid;
      }
    }
    return entering ? hi : lo;
  };

  const brightest = (from: number, to: number): Sight | null => {
    let best: Sight | null = null;
    const consider = (time: number) => {
      const sample = sightAt(time);
      if (!sample?.visible) {
        return;
      }
      if (!best || sample.elevation > best.elevation) {
        best = sample;
      }
    };
    consider(from);
    for (let time = from; time < to; time += PEAK_STEP_MS) {
      consider(time);
    }
    consider(to);
    return best;
  };

  const passes: IssPass[] = [];
  const pushPass = (from: number, to: number) => {
    if (to < from) {
      return;
    }
    const peak = brightest(from, to);
    const rise = sightAt(from);
    const set = sightAt(to);
    if (!peak || !rise?.visible || !set?.visible) {
      return;
    }
    passes.push({
      start: pointFrom(rise),
      peak: pointFrom(peak),
      end: pointFrom(set),
    });
  };

  let open: number | null = null;
  let previous = begin;
  let previousVisible = isVisible(previous);
  if (previousVisible) {
    open = previous;
  }

  const advance = (time: number) => {
    const visible = isVisible(time);
    if (visible && !previousVisible) {
      open = refine(previous, time, true);
    } else if (!visible && previousVisible && open !== null) {
      pushPass(open, refine(previous, time, false));
      open = null;
    }
    previous = time;
    previousVisible = visible;
  };

  for (let time = begin + COARSE_STEP_MS; time < finish; time += COARSE_STEP_MS) {
    advance(time);
  }
  if (previous < finish) {
    advance(finish);
  }
  if (open !== null && previousVisible) {
    pushPass(open, previous);
  }
  return passes;
}

export function satrecFromIssTle(tle: string): SatRec | null {
  const lines = tle
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
  const line1 = lines.find((line) => line.startsWith("1 "));
  const line2 = lines.find((line) => line.startsWith("2 "));
  if (!line1 || !line2) {
    return null;
  }
  try {
    const satrec = twoline2satrec(line1, line2);
    return satrec.error === 0 ? satrec : null;
  } catch {
    return null;
  }
}

/** 선택 위성의 다음 통과를 찾을 때 앞으로 보는 시간. */
export const SELECTION_PASS_HORIZON_MS = 24 * 60 * 60 * 1000;

/** 선택 지역에서 지금 보이거나 다음에 보이는 통과의 시작 시각. 없으면 null. */
export function nextObserverPass(station: Station, place: PassObserver, start: Date): Date | null {
  const begin = start.getTime();
  if (Number.isNaN(begin)) {
    return null;
  }
  const passes = predictStationPasses(station, place, start, new Date(begin + SELECTION_PASS_HORIZON_MS));
  if (!passes) {
    return null;
  }
  const next = passes.find((pass) => pass.end.time.getTime() >= begin);
  return next ? next.start.time : null;
}

export function predictStationPasses(
  station: Station,
  place: PassObserver,
  start: Date,
  end: Date,
): IssPass[] | null {
  try {
    const satrec = json2satrec(station.omm);
    if (satrec.error !== 0) {
      return null;
    }
    return predictIssPasses(satrec, place, start, end);
  } catch {
    return null;
  }
}

/** 끝난 통과는 빼고, 시작이 앞으로 3일 안에 있는 것만 남긴다. */
export function upcomingIssPasses(passes: readonly IssPass[], now: Date): IssPass[] {
  const nowMs = now.getTime();
  if (Number.isNaN(nowMs)) {
    return [];
  }
  const horizon = nowMs + ISS_PASS_HORIZON_MS;
  return passes.filter(
    (pass) => pass.end.time.getTime() >= nowMs && pass.start.time.getTime() <= horizon,
  );
}

export function kstDayOffset(from: Date, to: Date): number {
  return Math.round((kstDayStart(to).getTime() - kstDayStart(from).getTime()) / DAY_MS);
}

export function issPassTimeRange(pass: IssPass): string {
  return `${formatKstTime(pass.start.time)} ${EN_DASH} ${formatKstTime(pass.end.time)}`;
}

export function issPassRoute(pass: IssPass, locale: Locale): string {
  return translate(locale, "issPassRoute", {
    from: compassLabel(pass.start.direction, locale),
    to: compassLabel(pass.end.direction, locale),
    elevation: Math.round(pass.peak.elevation),
  });
}

export function issPassLater(pass: IssPass, locale: Locale): string {
  return translate(locale, "issPassLater", {
    when: issPassTimeRange(pass),
    from: compassLabel(pass.start.direction, locale),
    to: compassLabel(pass.end.direction, locale),
    elevation: Math.round(pass.peak.elevation),
  });
}

export type IssTrackSample = {
  time: Date;
  azimuth: number;
  elevation: number;
  /** 시작·최고·종료처럼 시각을 적어 둘 점. */
  mark: boolean;
};

/**
 * 이미 고른 통과를 방위·고도로 따라간다.
 * 각도는 predictIssPasses와 같이 satellite.js의 시선각이다.
 */
export function sampleIssTrack(
  station: Station,
  place: PassObserver,
  pass: IssPass,
  stepMs = 15_000,
): IssTrackSample[] {
  const observer = geodeticOf(place);
  if (!observer) {
    return [];
  }
  let satrec: SatRec;
  try {
    satrec = json2satrec(station.omm);
  } catch {
    return [];
  }
  if (satrec.error !== 0) {
    return [];
  }

  const lookAt = (time: number): { azimuth: number; elevation: number } | null => {
    const date = new Date(time);
    const propagated = propagate(satrec, date);
    const position = finiteVector(propagated?.position);
    if (!position) {
      return null;
    }
    const ecf = eciToEcf(position, gstime(date));
    const look = ecfToLookAngles(observer, ecf);
    return {
      azimuth: (radiansToDegrees(look.azimuth) + 360) % 360,
      elevation: radiansToDegrees(look.elevation),
    };
  };

  const start = pass.start.time.getTime();
  const peak = pass.peak.time.getTime();
  const end = pass.end.time.getTime();
  if (!Number.isFinite(start) || !Number.isFinite(peak) || !Number.isFinite(end) || end < start) {
    return [];
  }

  const marks = new Set([start, peak, end]);
  const times = new Set<number>(marks);
  const step = Number.isFinite(stepMs) && stepMs >= 1000 ? stepMs : 15_000;
  for (let time = start; time < end; time += step) {
    times.add(time);
  }

  const samples: IssTrackSample[] = [];
  for (const time of [...times].sort((left, right) => left - right)) {
    const look = lookAt(time);
    if (!look) {
      continue;
    }
    samples.push({
      time: new Date(time),
      azimuth: look.azimuth,
      elevation: look.elevation,
      mark: marks.has(time),
    });
  }
  return samples;
}
