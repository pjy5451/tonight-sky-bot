import {
  constants,
  degreesLat,
  degreesLong,
  eciToGeodetic,
  gstime,
  json2satrec,
  propagate,
  type OMMJsonObject,
  type SatRec,
} from "satellite.js";
import {
  GROUP_COLOR,
  HUBBLE_NORAD_CATALOG_ID,
  TIANGONG_NORAD_CATALOG_ID,
  type FilterGroup,
} from "./catalog";
import { translate, type Locale } from "./i18n";
import { globeVector, type Vec3 } from "./satellite-shape";

/** NORAD 카탈로그에서 ISS(ZARYA)의 번호. */
export const ISS_NORAD_CATALOG_ID = 25544;

export { HUBBLE_NORAD_CATALOG_ID, TIANGONG_NORAD_CATALOG_ID };

/** 한 프레임에 궤도를 계산하는 위성 수. 나머진 다음 프레임으로 넘긴다. */
export const SCENE_BATCH = 400;

export const ISS_COLOR = "#E8B04A";
export const OTHER_SATELLITE_COLOR = "#7FD3FF";

/** 목업의 "5초마다 갱신". */
export const POSITION_UPDATE_MS = 5_000;

/** 궤도선과 한국 상공 통과 시각은 위치보다 드물게 다시 계산한다. */
export const ORBIT_REFRESH_MS = 60_000;

/** 진행 방향은 이 간격만큼 뒤의 지면 위치로 잡는다. */
const VELOCITY_SAMPLE_MS = 1_000;

export const KOREA_PASS_STEP_MS = 30_000;
export const KOREA_PASS_HORIZON_MS = 18 * 60 * 60 * 1000;

/**
 * 한반도를 감싸는 지리 상자.
 * 남쪽 마라도 인근 33.1°N, 북쪽 온성 인근 43°N, 서쪽 124.1°E, 동쪽 독도 인근 131.9°E.
 */
export const KOREA_BOUNDS = {
  minLat: 33.1,
  maxLat: 43,
  minLng: 124.1,
  maxLng: 131.9,
} as const;

const DATA_ERROR = "위성 궤도 데이터를 불러오지 못했습니다.";

export type SatelliteMarker = "model" | "dot";

export type Station = {
  name: string;
  noradId: number;
  omm: OMMJsonObject;
  group?: string;
  country?: string;
  korean?: boolean;
  marker?: SatelliteMarker;
};

export type StationCatalog = {
  fetchedAt: string | null;
  stations: Station[];
  error: string | null;
};

export type Propagation = {
  eciKm: { x: number; y: number; z: number };
  velocityKmS: { x: number; y: number; z: number };
  lat: number;
  lng: number;
  altKm: number;
  speedKmh: number;
};

export type SatellitePoint = {
  lat: number;
  lng: number;
  alt: number;
  altKm?: number;
  color: string;
  iss: boolean;
  /** 1초 뒤 지면 위치와의 차. 장면 좌표(지구 반지름 = 1)이며 모형이 이 방향을 본다. */
  velocity: Vec3;
  noradId?: number;
  name?: string;
  group?: string;
  country?: string;
  korean?: boolean;
  marker?: SatelliteMarker;
};

export type OrbitPoint = {
  lat: number;
  lng: number;
  alt: number;
};

export type OrbitPath = {
  points: OrbitPoint[];
};

export type SatelliteScene = {
  points: SatellitePoint[];
  paths: OrbitPath[];
  iss: { station: Station; fix: Propagation } | null;
};

export type Overflight = {
  overheadNow: boolean;
  at: Date | null;
};

const satrecCache = new WeakMap<Station, SatRec | null>();

function finiteNumber(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === "string" && value.trim() && Number.isFinite(Number(value))) {
    return Number(value);
  }
  return null;
}

function isFiniteVec(value: unknown): value is { x: number; y: number; z: number } {
  if (!value || typeof value !== "object") {
    return false;
  }
  const vec = value as { x?: unknown; y?: unknown; z?: unknown };
  return (
    typeof vec.x === "number" &&
    typeof vec.y === "number" &&
    typeof vec.z === "number" &&
    Number.isFinite(vec.x) &&
    Number.isFinite(vec.y) &&
    Number.isFinite(vec.z)
  );
}

function toStation(item: unknown): Station | null {
  if (!item || typeof item !== "object" || Array.isArray(item)) {
    return null;
  }

  const raw = item as Record<string, unknown>;
  const name = typeof raw.OBJECT_NAME === "string" ? raw.OBJECT_NAME.trim() : "";
  const noradId = finiteNumber(raw.NORAD_CAT_ID);
  const epoch = typeof raw.EPOCH === "string" ? raw.EPOCH.trim() : "";
  const meanMotion = finiteNumber(raw.MEAN_MOTION);
  const eccentricity = finiteNumber(raw.ECCENTRICITY);
  const inclination = finiteNumber(raw.INCLINATION);
  const raan = finiteNumber(raw.RA_OF_ASC_NODE);
  const argument = finiteNumber(raw.ARG_OF_PERICENTER);
  const anomaly = finiteNumber(raw.MEAN_ANOMALY);

  if (!name || noradId === null || !epoch || meanMotion === null || meanMotion <= 0) {
    return null;
  }
  if (
    eccentricity === null ||
    inclination === null ||
    raan === null ||
    argument === null ||
    anomaly === null
  ) {
    return null;
  }

  const omm: OMMJsonObject = {
    OBJECT_NAME: name,
    OBJECT_ID: typeof raw.OBJECT_ID === "string" && raw.OBJECT_ID.trim() ? raw.OBJECT_ID.trim() : "UNKNOWN",
    EPOCH: epoch,
    MEAN_MOTION: meanMotion,
    ECCENTRICITY: eccentricity,
    INCLINATION: inclination,
    RA_OF_ASC_NODE: raan,
    ARG_OF_PERICENTER: argument,
    MEAN_ANOMALY: anomaly,
    NORAD_CAT_ID: noradId,
    ELEMENT_SET_NO: finiteNumber(raw.ELEMENT_SET_NO) ?? 999,
    BSTAR: finiteNumber(raw.BSTAR) ?? 0,
    MEAN_MOTION_DOT: finiteNumber(raw.MEAN_MOTION_DOT) ?? 0,
    MEAN_MOTION_DDOT: finiteNumber(raw.MEAN_MOTION_DDOT) ?? 0,
  };

  if (raw.CLASSIFICATION_TYPE === "U" || raw.CLASSIFICATION_TYPE === "C") {
    omm.CLASSIFICATION_TYPE = raw.CLASSIFICATION_TYPE;
  }
  if (raw.EPHEMERIS_TYPE === 0 || raw.EPHEMERIS_TYPE === "0") {
    omm.EPHEMERIS_TYPE = raw.EPHEMERIS_TYPE;
  }

  return { name, noradId, omm };
}

export function parseTleDocument(payload: unknown): StationCatalog {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    return { fetchedAt: null, stations: [], error: DATA_ERROR };
  }

  const record = payload as Record<string, unknown>;
  const fetchedAt =
    typeof record.fetched_at === "string" && record.fetched_at.trim() ? record.fetched_at.trim() : null;

  if (!Array.isArray(record.items)) {
    return { fetchedAt, stations: [], error: DATA_ERROR };
  }

  const stations: Station[] = [];
  for (const item of record.items) {
    const station = toStation(item);
    if (station) {
      stations.push(station);
    }
  }

  if (stations.length === 0) {
    return { fetchedAt, stations, error: DATA_ERROR };
  }

  return { fetchedAt, stations, error: null };
}

const CATALOG_GROUPS = new Set<string>([
  "starlink",
  "gps-ops",
  "galileo",
  "geo",
  "weather",
  "science",
  "korea",
  "stations",
]);

export type CatalogLoad = {
  fetchedAt: string | null;
  satellites: Station[];
  error: string | null;
};

/** ISS·톈궁·허블만 3D 모형이고, 나머지 추가 위성은 색 점이다. 정거장 그룹은 기존 모형이다. */
export function markerFor(noradId: number, group?: string): SatelliteMarker {
  if (
    noradId === ISS_NORAD_CATALOG_ID ||
    noradId === TIANGONG_NORAD_CATALOG_ID ||
    noradId === HUBBLE_NORAD_CATALOG_ID
  ) {
    return "model";
  }
  if (group === undefined || group === "stations") {
    return "model";
  }
  return "dot";
}

function catalogStation(row: unknown): Station | null {
  if (!Array.isArray(row) || row.length < 14) {
    return null;
  }
  const name = typeof row[0] === "string" ? row[0].trim() : "";
  const noradId = finiteNumber(row[1]);
  const group = typeof row[2] === "string" ? row[2] : "";
  const country = typeof row[3] === "string" ? row[3] : "";
  const epoch = typeof row[4] === "string" ? row[4].trim() : "";
  const meanMotion = finiteNumber(row[5]);
  const eccentricity = finiteNumber(row[6]);
  const inclination = finiteNumber(row[7]);
  const raan = finiteNumber(row[8]);
  const argument = finiteNumber(row[9]);
  const anomaly = finiteNumber(row[10]);
  const bstar = finiteNumber(row[11]) ?? 0;
  const meanMotionDot = finiteNumber(row[12]) ?? 0;
  const korean = row[13] === 1 || row[13] === true;

  if (!name || noradId === null || !CATALOG_GROUPS.has(group) || !epoch) {
    return null;
  }
  if (meanMotion === null || meanMotion <= 0) {
    return null;
  }
  if (eccentricity === null || inclination === null || raan === null || argument === null || anomaly === null) {
    return null;
  }

  const omm: OMMJsonObject = {
    OBJECT_NAME: name,
    OBJECT_ID: "UNKNOWN",
    EPOCH: epoch,
    MEAN_MOTION: meanMotion,
    ECCENTRICITY: eccentricity,
    INCLINATION: inclination,
    RA_OF_ASC_NODE: raan,
    ARG_OF_PERICENTER: argument,
    MEAN_ANOMALY: anomaly,
    NORAD_CAT_ID: noradId,
    ELEMENT_SET_NO: 999,
    BSTAR: bstar,
    MEAN_MOTION_DOT: meanMotionDot,
    MEAN_MOTION_DDOT: 0,
  };

  return {
    name,
    noradId,
    omm,
    group,
    country,
    korean,
    marker: markerFor(noradId, group),
  };
}

/** `catalog.json`의 짧은 행만 읽는다. 파일이 비어 있으면 오류가 아니다. */
export function parseCatalogDocument(payload: unknown): CatalogLoad {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    return { fetchedAt: null, satellites: [], error: null };
  }

  const record = payload as Record<string, unknown>;
  const fetchedAt =
    typeof record.fetched_at === "string" && record.fetched_at.trim() ? record.fetched_at.trim() : null;
  const rows = Array.isArray(record.items) ? record.items : null;
  const satellites: Station[] = [];
  if (rows) {
    for (const row of rows) {
      const station = catalogStation(row);
      if (station) {
        satellites.push(station);
      }
    }
  }

  const failed = typeof record.error === "string" && record.error.trim().length > 0 && satellites.length === 0;
  return { fetchedAt, satellites, error: failed ? "failed" : null };
}

function groupColor(group: string | undefined): string {
  if (group && group in GROUP_COLOR) {
    return GROUP_COLOR[group as FilterGroup];
  }
  return OTHER_SATELLITE_COLOR;
}

function satrecFor(station: Station): SatRec | null {
  const cached = satrecCache.get(station);
  if (cached !== undefined) {
    return cached;
  }

  try {
    const satrec = json2satrec(station.omm);
    satrecCache.set(station, satrec);
    return satrec;
  } catch {
    satrecCache.set(station, null);
    return null;
  }
}

/** SGP4로 한 시각의 지구 고정 위치·속도를 계산한다. 실패하면 null. */
export function propagateStation(station: Station, date: Date): Propagation | null {
  const satrec = satrecFor(station);
  if (!satrec || Number.isNaN(date.getTime())) {
    return null;
  }

  const propagated = propagate(satrec, date);
  if (!propagated || !isFiniteVec(propagated.position) || !isFiniteVec(propagated.velocity)) {
    return null;
  }

  const geodetic = eciToGeodetic(propagated.position, gstime(date));
  const lat = degreesLat(geodetic.latitude);
  const lng = degreesLong(geodetic.longitude);
  if (!Number.isFinite(lat) || !Number.isFinite(lng) || !Number.isFinite(geodetic.height)) {
    return null;
  }

  return {
    eciKm: { x: propagated.position.x, y: propagated.position.y, z: propagated.position.z },
    velocityKmS: {
      x: propagated.velocity.x,
      y: propagated.velocity.y,
      z: propagated.velocity.z,
    },
    lat,
    lng,
    altKm: geodetic.height,
    speedKmh: Math.hypot(propagated.velocity.x, propagated.velocity.y, propagated.velocity.z) * 3600,
  };
}

export function altitudeRatio(altKm: number): number {
  return altKm / constants.earthRadius;
}

export function isOverKorea(lat: number, lng: number): boolean {
  return (
    lat >= KOREA_BOUNDS.minLat &&
    lat <= KOREA_BOUNDS.maxLat &&
    lng >= KOREA_BOUNDS.minLng &&
    lng <= KOREA_BOUNDS.maxLng
  );
}

/** 지면 궤적이 영역 안에 들어오는 첫 시각. 계산이 끊기면 null. */
export function findNextOverflight(
  insideAt: (date: Date) => boolean | null,
  start: Date,
  stepMs: number,
  horizonMs: number,
): Overflight | null {
  if (stepMs <= 0 || horizonMs < 0 || Number.isNaN(start.getTime())) {
    return null;
  }

  let previous: boolean | null = null;
  for (let elapsed = 0; elapsed <= horizonMs; elapsed += stepMs) {
    const date = new Date(start.getTime() + elapsed);
    const inside = insideAt(date);
    if (inside === null) {
      return null;
    }
    if (elapsed === 0 && inside) {
      return { overheadNow: true, at: date };
    }
    if (inside && previous === false) {
      return { overheadNow: false, at: date };
    }
    previous = inside;
  }

  return { overheadNow: false, at: null };
}

export function findNextKoreaPass(station: Station, start: Date): Overflight | null {
  return findNextOverflight(
    (date) => {
      const fix = propagateStation(station, date);
      if (!fix) {
        return null;
      }
      return isOverKorea(fix.lat, fix.lng);
    },
    start,
    KOREA_PASS_STEP_MS,
    KOREA_PASS_HORIZON_MS,
  );
}

export function splitOrbitPaths(points: readonly OrbitPoint[]): OrbitPoint[][] {
  const paths: OrbitPoint[][] = [];
  let current: OrbitPoint[] = [];

  const flush = () => {
    if (current.length > 1) {
      paths.push(current);
    }
    current = [];
  };

  for (const point of points) {
    const previous = current[current.length - 1];
    if (previous && Math.abs(point.lng - previous.lng) > 180) {
      flush();
    }
    current.push(point);
  }

  flush();
  return paths;
}

function orbitPathsFor(station: Station, date: Date): OrbitPath[] {
  const meanMotion = finiteNumber(station.omm.MEAN_MOTION);
  if (meanMotion === null || meanMotion <= 0) {
    return [];
  }

  const periodMs = (constants.minutesPerDay / meanMotion) * 60_000;
  const steps = 90;
  const samples: OrbitPoint[] = [];

  for (let index = 0; index <= steps; index += 1) {
    const fix = propagateStation(station, new Date(date.getTime() + (periodMs * index) / steps));
    if (!fix) {
      continue;
    }
    samples.push({
      lat: fix.lat,
      lng: fix.lng,
      alt: altitudeRatio(fix.altKm),
    });
  }

  return splitOrbitPaths(samples).map((points) => ({ points }));
}

export function buildSatelliteScene(
  stations: readonly Station[],
  date: Date,
  options: { includeOrbit?: boolean } = {},
): SatelliteScene {
  const points: SatellitePoint[] = [];
  let iss: SatelliteScene["iss"] = null;

  for (const station of stations) {
    const fix = propagateStation(station, date);
    if (!fix) {
      continue;
    }

    const isIss = station.noradId === ISS_NORAD_CATALOG_ID;
    const marker = station.marker ?? markerFor(station.noradId, station.group);
    const alt = altitudeRatio(fix.altKm);
    points.push({
      lat: fix.lat,
      lng: fix.lng,
      alt,
      altKm: fix.altKm,
      color: isIss ? ISS_COLOR : marker === "dot" ? groupColor(station.group) : OTHER_SATELLITE_COLOR,
      iss: isIss,
      velocity: marker === "dot" ? { x: 0, y: 0, z: 0 } : travelVelocity(station, date, fix, alt),
      noradId: station.noradId,
      name: station.name,
      group: station.group ?? "stations",
      country: station.country ?? "",
      korean: station.korean === true,
      marker,
    });

    if (isIss) {
      iss = { station, fix };
    }
  }

  const includeOrbit = options.includeOrbit !== false;
  return {
    points,
    paths: includeOrbit && iss ? orbitPathsFor(iss.station, date) : [],
    iss,
  };
}

function travelVelocity(station: Station, date: Date, fix: Propagation, alt: number): Vec3 {
  const ahead = propagateStation(station, new Date(date.getTime() + VELOCITY_SAMPLE_MS));
  if (!ahead) {
    return { x: 0, y: 0, z: 0 };
  }
  const here = globeVector(fix.lat, fix.lng, alt, 1);
  const there = globeVector(ahead.lat, ahead.lng, altitudeRatio(ahead.altKm), 1);
  return { x: there.x - here.x, y: there.y - here.y, z: there.z - here.z };
}

function grouped(value: number): string {
  const rounded = Math.round(value);
  const sign = rounded < 0 ? "-" : "";
  const digits = Math.abs(rounded).toString();
  return sign + digits.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
}

function hemisphere(value: number, positive: string, negative: string): string {
  return `${Math.abs(value).toFixed(1)}°${value >= 0 ? positive : negative}`;
}

export function formatGroundPosition(lat: number, lng: number): string {
  return `${hemisphere(lat, "N", "S")}\n${hemisphere(lng, "E", "W")}`;
}

export function formatAltitude(altKm: number, locale: Locale = "ko"): string {
  return translate(locale, "altitudeAbout", { value: grouped(altKm) });
}

export function formatSpeed(speedKmh: number): string {
  return `${grouped(speedKmh)} km/h`;
}

/** 남은 시간. 디자인 고정폭 `T−HH:MM` (빼기는 U+2212). */
export function formatDuration(ms: number, locale: Locale = "ko"): string {
  const minutes = Math.max(0, Math.round(ms / 60_000));
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  void locale;
  return `T\u2212${String(hours).padStart(2, "0")}:${String(rest).padStart(2, "0")}`;
}

export function formatKoreaPassLabel(pass: Overflight, now: Date, locale: Locale = "ko"): string {
  if (pass.overheadNow || (pass.at !== null && pass.at.getTime() <= now.getTime())) {
    return translate(locale, "koreaPassNow");
  }
  if (pass.at) {
    return translate(locale, "koreaPassIn", {
      duration: formatDuration(pass.at.getTime() - now.getTime(), locale),
    });
  }
  const hours = Math.round(KOREA_PASS_HORIZON_MS / (60 * 60 * 1000));
  return translate(locale, "koreaPassNone", { hours });
}
