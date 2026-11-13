import { localDayStart } from "./clock";
import { REGIONS, type KeyValueStore, type Region } from "./location";

/** 성공한 관측 조건을 이 기기에만 둔다. */
export const CONDITIONS_STORAGE_KEY = "tonight-sky-conditions";

/** 같은 시·도 결과는 30분 동안 다시 받지 않는다. */
export const CONDITIONS_CACHE_MS = 30 * 60 * 1000;

/** 예보·Kp 요청이 이 시간을 넘기면 카드만 실패로 둔다. */
export const CONDITIONS_TIMEOUT_MS = 5000;

/** 가장 가까운 시·도 청사까지 이 거리보다 멀면 예보를 받지 않는다. */
export const FORECAST_RANGE_KM = 400;

export const OPEN_METEO_ORIGIN = "https://api.open-meteo.com";
export const SWPC_ORIGIN = "https://services.swpc.noaa.gov";

/** NOAA SWPC 행성 K 지수. 마지막 유효 행이 최근 값이다. */
export const SWPC_KP_URL = `${SWPC_ORIGIN}/products/noaa-planetary-k-index.json`;

const HOUR_MS = 60 * 60 * 1000;

export type ConditionsFailureReason = "place" | "no-sunset" | "request" | "aborted";

export type ConditionsSuccess = {
  ok: true;
  region: Region;
  index: number;
  cloudPercent: number;
  visibilityKm: number;
  humidityPercent: number;
  kp: number;
  fromCache: boolean;
};

export type ConditionsFailure = {
  ok: false;
  reason: ConditionsFailureReason;
  region: Region | null;
};

export type ConditionsResult = ConditionsSuccess | ConditionsFailure;

type FetchLike = (
  input: string,
  init?: { signal?: AbortSignal },
) => Promise<{
  ok: boolean;
  json(): Promise<unknown>;
}>;

export type ConditionsLoadInput = {
  latitude: number;
  longitude: number;
  sunset: Date | null;
  /** astronomy-engine 달 조도. 0~1. */
  moonIllumination: number;
  now?: Date;
  fetchImpl?: FetchLike;
  store?: KeyValueStore;
  timeoutMs?: number;
  signal?: AbortSignal;
};

type CachedConditions = {
  regionId: string;
  savedAt: number;
  index: number;
  cloudPercent: number;
  visibilityKm: number;
  humidityPercent: number;
  kp: number;
};

type NightSample = {
  cloudPercent: number;
  visibilityMeters: number;
  humidityPercent: number;
};

/**
 * 관측 지수 0~100. 소수점은 버린다.
 * 구름·달 밝기는 0~1, 시정은 km. 시정은 20km에서 더 이상 오르지 않는다.
 */
export function observingIndex(input: {
  cloudFraction: number;
  moonIllumination: number;
  visibilityKm: number;
}): number {
  const cloud = clamp01(input.cloudFraction);
  const moon = clamp01(input.moonIllumination);
  const visibility = Number.isFinite(input.visibilityKm) ? Math.max(0, input.visibilityKm) : 0;
  const clarity = Math.min(visibility / 20, 1);
  const score = 100 * (0.6 * (1 - cloud) + 0.25 * (1 - moon) + 0.15 * clarity);
  return clampIndex(Math.floor(score));
}

/** 위도·경도에서 가장 가까운 시·도 청사. 저장된 사용자 좌표를 그대로 쓰지 않는다. */
export function nearestRegion(latitude: number, longitude: number): Region | null {
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) {
    return null;
  }
  if (latitude < -90 || latitude > 90 || longitude < -180 || longitude > 180) {
    return null;
  }

  let best: Region | null = null;
  let bestDistance = Infinity;
  for (const region of REGIONS) {
    const distance = distanceKm(latitude, longitude, region.latitude, region.longitude);
    if (distance < bestDistance) {
      best = region;
      bestDistance = distance;
    }
  }
  return best;
}

/** 일몰 이상, 그 다음 지역 자정 미만. 일몰이 없으면 null. */
export function tonightWindow(sunset: Date | null): { start: number; end: number } | null {
  if (!sunset || Number.isNaN(sunset.getTime())) {
    return null;
  }
  const dayStart = localDayStart(sunset);
  const end = localDayStart(new Date(dayStart.getTime() + 36 * HOUR_MS));
  if (end.getTime() <= sunset.getTime()) {
    return null;
  }
  return { start: sunset.getTime(), end: end.getTime() };
}

export function weatherRequestUrl(region: Region): string {
  const url = new URL("/v1/forecast", OPEN_METEO_ORIGIN);
  url.searchParams.set("latitude", String(region.latitude));
  url.searchParams.set("longitude", String(region.longitude));
  url.searchParams.set("hourly", "cloud_cover,visibility,relative_humidity_2m");
  url.searchParams.set("timeformat", "unixtime");
  url.searchParams.set("forecast_days", "2");
  url.searchParams.set("timezone", "UTC");
  return url.toString();
}

export function formatVisibilityKm(km: number): string {
  const rounded = Math.round(km * 10) / 10;
  return Number.isInteger(rounded) ? String(rounded) : rounded.toFixed(1);
}

export function formatKp(value: number): string {
  const rounded = Math.round(value * 100) / 100;
  return String(rounded);
}

export function readConditionsCache(
  store: KeyValueStore,
  regionId: string,
  now: Date,
): ConditionsSuccess | null {
  let raw: string | null;
  try {
    raw = store.getItem(CONDITIONS_STORAGE_KEY);
  } catch {
    return null;
  }
  if (!raw) {
    return null;
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!isCachedConditions(parsed) || parsed.regionId !== regionId) {
    return null;
  }
  const age = now.getTime() - parsed.savedAt;
  if (!Number.isFinite(age) || age < 0 || age >= CONDITIONS_CACHE_MS) {
    return null;
  }

  const region = REGIONS.find((item) => item.id === parsed.regionId) ?? null;
  if (!region) {
    return null;
  }
  return {
    ok: true,
    region,
    index: parsed.index,
    cloudPercent: parsed.cloudPercent,
    visibilityKm: parsed.visibilityKm,
    humidityPercent: parsed.humidityPercent,
    kp: parsed.kp,
    fromCache: true,
  };
}

/**
 * 오늘 밤 평균 구름·시정·습도와 최근 Kp.
 * 요청 주소의 좌표는 가장 가까운 시·도 대표점뿐이다.
 */
export async function loadObservingConditions(input: ConditionsLoadInput): Promise<ConditionsResult> {
  const region = nearestRegion(input.latitude, input.longitude);
  if (!region) {
    return { ok: false, reason: "place", region: null };
  }

  const night = tonightWindow(input.sunset);
  if (!night) {
    return { ok: false, reason: "no-sunset", region };
  }

  const now = input.now ?? new Date();
  const store = input.store;
  if (store) {
    const cached = readConditionsCache(store, region.id, now);
    if (cached) {
      return cached;
    }
  }

  if (input.signal?.aborted) {
    return { ok: false, reason: "aborted", region };
  }

  const timeoutMs = input.timeoutMs ?? CONDITIONS_TIMEOUT_MS;
  const fetchImpl = input.fetchImpl ?? fetch;
  const timeout = new AbortController();
  const timer = setTimeout(() => timeout.abort(), timeoutMs);
  const signal = mergeSignals(input.signal, timeout.signal);

  try {
    const weatherUrl = weatherRequestUrl(region);
    assertForecastUrl(weatherUrl, region);
    const [weatherBody, kpBody] = await Promise.all([
      readJson(fetchImpl, weatherUrl, signal),
      readJson(fetchImpl, SWPC_KP_URL, signal),
    ]);
    if (input.signal?.aborted) {
      return { ok: false, reason: "aborted", region };
    }
    const samples = weatherBody ? samplesInWindow(weatherBody, night) : null;
    const kp = kpBody ? latestKp(kpBody) : null;
    if (!samples || samples.length === 0 || kp === null) {
      return { ok: false, reason: "request", region };
    }

    const cloudPercent = mean(samples.map((sample) => sample.cloudPercent));
    const visibilityMeters = mean(samples.map((sample) => sample.visibilityMeters));
    const humidityPercent = mean(samples.map((sample) => sample.humidityPercent));
    if (cloudPercent === null || visibilityMeters === null || humidityPercent === null) {
      return { ok: false, reason: "request", region };
    }
    const visibilityKm = visibilityMeters / 1000;

    const result: ConditionsSuccess = {
      ok: true,
      region,
      index: observingIndex({
        cloudFraction: cloudPercent / 100,
        moonIllumination: input.moonIllumination,
        visibilityKm,
      }),
      cloudPercent: clampIndex(Math.round(cloudPercent)),
      visibilityKm,
      humidityPercent: clampIndex(Math.round(humidityPercent)),
      kp,
      fromCache: false,
    };
    writeCache(store, result, now);
    return result;
  } catch {
    if (input.signal?.aborted) {
      return { ok: false, reason: "aborted", region };
    }
    return { ok: false, reason: "request", region };
  } finally {
    clearTimeout(timer);
  }
}

function writeCache(store: KeyValueStore | undefined, result: ConditionsSuccess, now: Date): void {
  if (!store) {
    return;
  }
  const payload: CachedConditions = {
    regionId: result.region.id,
    savedAt: now.getTime(),
    index: result.index,
    cloudPercent: result.cloudPercent,
    visibilityKm: result.visibilityKm,
    humidityPercent: result.humidityPercent,
    kp: result.kp,
  };
  try {
    store.setItem(CONDITIONS_STORAGE_KEY, JSON.stringify(payload));
  } catch {
    // 저장을 막는 브라우저에서도 이번 화면은 보여 준다.
  }
}

function assertForecastUrl(url: string, region: Region): void {
  const parsed = new URL(url);
  if (parsed.origin !== OPEN_METEO_ORIGIN) {
    throw new Error("예보 주소가 올바르지 않습니다.");
  }
  if (parsed.searchParams.get("latitude") !== String(region.latitude)) {
    throw new Error("예보 좌표가 시·도 대표점이 아닙니다.");
  }
  if (parsed.searchParams.get("longitude") !== String(region.longitude)) {
    throw new Error("예보 좌표가 시·도 대표점이 아닙니다.");
  }
}

async function readJson(fetchImpl: FetchLike, url: string, signal: AbortSignal): Promise<unknown | null> {
  const parsed = new URL(url);
  if (parsed.origin !== OPEN_METEO_ORIGIN && parsed.origin !== SWPC_ORIGIN) {
    return null;
  }
  try {
    const response = await fetchImpl(url, { signal });
    if (!response.ok) {
      return null;
    }
    return await response.json();
  } catch {
    return null;
  }
}

function samplesInWindow(payload: unknown, window: { start: number; end: number }): NightSample[] | null {
  if (!payload || typeof payload !== "object") {
    return null;
  }
  const hourly = (payload as { hourly?: unknown }).hourly;
  if (!hourly || typeof hourly !== "object") {
    return null;
  }
  const record = hourly as Record<string, unknown>;
  const times = record.time;
  const clouds = record.cloud_cover;
  const visibilities = record.visibility;
  const humidities = record.relative_humidity_2m;
  if (!Array.isArray(times) || !Array.isArray(clouds) || !Array.isArray(visibilities) || !Array.isArray(humidities)) {
    return null;
  }

  const count = Math.min(times.length, clouds.length, visibilities.length, humidities.length);
  const samples: NightSample[] = [];
  for (let index = 0; index < count; index += 1) {
    const time = epochMs(times[index]);
    const cloud = finiteNumber(clouds[index]);
    const visibility = finiteNumber(visibilities[index]);
    const humidity = finiteNumber(humidities[index]);
    if (time === null || cloud === null || visibility === null || humidity === null) {
      continue;
    }
    if (time < window.start || time >= window.end) {
      continue;
    }
    samples.push({
      cloudPercent: cloud,
      visibilityMeters: visibility,
      humidityPercent: humidity,
    });
  }
  return samples;
}

function latestKp(payload: unknown): number | null {
  if (!Array.isArray(payload)) {
    return null;
  }
  let latest: number | null = null;
  for (const row of payload) {
    if (!Array.isArray(row) || row.length < 2) {
      continue;
    }
    const value = finiteNumber(row[1]);
    if (value === null || value < 0 || value > 9) {
      continue;
    }
    latest = value;
  }
  return latest;
}

function epochMs(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value < 1e12 ? value * 1000 : value;
  }
  if (typeof value !== "string" || value.trim() === "") {
    return null;
  }
  const numeric = Number(value);
  if (Number.isFinite(numeric)) {
    return numeric < 1e12 ? numeric * 1000 : numeric;
  }
  const parsed = Date.parse(value);
  return Number.isNaN(parsed) ? null : parsed;
}

function finiteNumber(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === "string" && value.trim() !== "") {
    const numeric = Number(value);
    return Number.isFinite(numeric) ? numeric : null;
  }
  return null;
}

function mean(values: number[]): number | null {
  if (values.length === 0) {
    return null;
  }
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function isCachedConditions(value: unknown): value is CachedConditions {
  if (!value || typeof value !== "object") {
    return false;
  }
  const record = value as Record<string, unknown>;
  return (
    typeof record.regionId === "string" &&
    record.regionId.length > 0 &&
    typeof record.savedAt === "number" &&
    Number.isFinite(record.savedAt) &&
    isUnit(record.index, 0, 100) &&
    isUnit(record.cloudPercent, 0, 100) &&
    typeof record.visibilityKm === "number" &&
    Number.isFinite(record.visibilityKm) &&
    record.visibilityKm >= 0 &&
    isUnit(record.humidityPercent, 0, 100) &&
    typeof record.kp === "number" &&
    Number.isFinite(record.kp) &&
    record.kp >= 0 &&
    record.kp <= 9
  );
}

function isUnit(value: unknown, min: number, max: number): value is number {
  return typeof value === "number" && Number.isInteger(value) && value >= min && value <= max;
}

function clamp01(value: number): number {
  if (!Number.isFinite(value)) {
    return 0;
  }
  return Math.min(1, Math.max(0, value));
}

function clampIndex(value: number): number {
  if (!Number.isFinite(value)) {
    return 0;
  }
  return Math.min(100, Math.max(0, value));
}

function mergeSignals(caller: AbortSignal | undefined, timeout: AbortSignal): AbortSignal {
  const controller = new AbortController();
  const abort = () => controller.abort();
  if (caller?.aborted || timeout.aborted) {
    abort();
    return controller.signal;
  }
  caller?.addEventListener("abort", abort, { once: true });
  timeout.addEventListener("abort", abort, { once: true });
  return controller.signal;
}

/** 기존 관측 조건 거리. 지구 반지름 6371km. */
export function distanceKm(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const earthRadiusKm = 6371;
  const toRad = (degrees: number) => (degrees * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return 2 * earthRadiusKm * Math.asin(Math.min(1, Math.sqrt(a)));
}
