import { calendarDayIndex, zonedParts } from "./clock";
import { translate, weekdayLabel, type Locale } from "./i18n";

export const LAUNCH_LOAD_ERROR = "발사 일정을 불러오지 못했습니다.";
export const LAUNCH_EMPTY_MESSAGE = "다가오는 발사 일정이 없습니다.";
export const LAUNCH_LOADING_MESSAGE = "불러오는 중";

/** 발사 탭이 보이는 동안 초 단위 카운트다운을 갱신하는 간격. */
export const COUNTDOWN_UPDATE_MS = 1000;

export type LaunchItem = {
  id: string;
  name: string;
  net: string;
  provider: string | null;
  rocket: string | null;
  pad: string | null;
  location: string | null;
  webcastUrl: string | null;
};

export type LaunchCatalog = {
  fetchedAt: string | null;
  launches: LaunchItem[];
  error: string | null;
};

export type CountdownParts = {
  days: number;
  hours: number;
  minutes: number;
  seconds: number;
};

function readText(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }
  const trimmed = value.trim();
  return trimmed ? trimmed : null;
}

/** 브라우저에 넣어도 안전한 http(s) 주소만 남긴다. */
export function readHttpUrl(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }
  const trimmed = value.trim();
  if (!/^https?:\/\//i.test(trimmed)) {
    return null;
  }
  try {
    const url = new URL(trimmed);
    if (url.username || url.password || (url.protocol !== "http:" && url.protocol !== "https:")) {
      return null;
    }
    return url.href;
  } catch {
    return null;
  }
}

function readWebcastUrl(value: unknown): string | null {
  if (!Array.isArray(value)) {
    return null;
  }
  for (const entry of value) {
    const url = readHttpUrl(entry);
    if (url) {
      return url;
    }
  }
  return null;
}

function toLaunchItem(value: unknown, index: number): LaunchItem | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }
  const record = value as Record<string, unknown>;
  const net = readText(record.net);
  if (!net || Number.isNaN(Date.parse(net))) {
    return null;
  }

  const name = readText(record.name) ?? "";
  const id = readText(record.id) ?? `launch-${index}`;
  return {
    id,
    name,
    net,
    provider: readText(record.provider),
    rocket: readText(record.rocket),
    pad: readText(record.pad),
    location: readText(record.location),
    webcastUrl: readWebcastUrl(record.webcast_urls),
  };
}

export function parseLaunchDocument(payload: unknown): LaunchCatalog {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    return { fetchedAt: null, launches: [], error: LAUNCH_LOAD_ERROR };
  }

  const record = payload as Record<string, unknown>;
  const fetchedAt = readText(record.fetched_at);
  if (typeof record.error === "string" && record.error.trim()) {
    return { fetchedAt, launches: [], error: LAUNCH_LOAD_ERROR };
  }
  if (!Array.isArray(record.items)) {
    return { fetchedAt, launches: [], error: LAUNCH_LOAD_ERROR };
  }

  const launches: LaunchItem[] = [];
  for (const [index, item] of record.items.entries()) {
    const launch = toLaunchItem(item, index);
    if (launch) {
      launches.push(launch);
    }
  }
  launches.sort((left, right) => Date.parse(left.net) - Date.parse(right.net));
  return { fetchedAt, launches, error: null };
}

/** 지금 이후(지금 포함)인 발사만, 이른 시각부터. */
export function upcomingLaunches(launches: readonly LaunchItem[], now: Date): LaunchItem[] {
  const nowMs = now.getTime();
  return launches.filter((launch) => Date.parse(launch.net) >= nowMs);
}

/** 기기 시간대 달력의 날짜 번호. 시간대를 넘기면 그 달력이다. */
export function kstCalendarDayIndex(date: Date, timeZone?: string): number {
  return calendarDayIndex(date, timeZone);
}

/**
 * `M/D (요일) HH:MM`. 날짜와 시·분은 기기 시간대이고, 요일 이름만 언어를 따른다.
 * 초는 올리지 않고 그 시각의 시·분만 적는다.
 */
export function formatLaunchDateTime(date: Date, locale: Locale = "ko", timeZone?: string): string {
  const parts = zonedParts(date, timeZone);
  const weekday = weekdayLabel(parts.weekday, locale);
  const hour = String(parts.hour).padStart(2, "0");
  const minute = String(parts.minute).padStart(2, "0");
  return `${parts.month}/${parts.day} (${weekday}) ${hour}:${minute}`;
}

/** 한국어 요일의 기기 시간대 발사 시각. Asia/Seoul에서는 한국시간과 같다. */
export function formatKstLaunchDateTime(date: Date, timeZone?: string): string {
  return formatLaunchDateTime(date, "ko", timeZone);
}

/** 같은 시간대 달력의 D-day. 당일은 D-Day, 미래는 D-N. */
export function formatLaunchDday(target: Date, now: Date, timeZone?: string): string {
  const diff = kstCalendarDayIndex(target, timeZone) - kstCalendarDayIndex(now, timeZone);
  if (diff <= 0) {
    return "D-Day";
  }
  return `D-${diff}`;
}

export function countdownParts(target: Date, now: Date): CountdownParts {
  const remainingSeconds = Math.max(0, Math.floor((target.getTime() - now.getTime()) / 1000));
  const days = Math.floor(remainingSeconds / 86_400);
  const hours = Math.floor((remainingSeconds % 86_400) / 3_600);
  const minutes = Math.floor((remainingSeconds % 3_600) / 60);
  const seconds = remainingSeconds % 60;
  return { days, hours, minutes, seconds };
}

export function formatCountdownUnit(value: number): string {
  if (!Number.isInteger(value) || value < 0) {
    return "00";
  }
  return String(value).padStart(2, "0");
}

export function launchVehicle(launch: LaunchItem, locale: Locale = "ko"): string {
  return launch.rocket || launch.name || translate(locale, "launchFallback");
}

export function launchMission(launch: LaunchItem): string | null {
  const name = launch.name.trim();
  if (!name) {
    return null;
  }
  const parts = name.split("|");
  if (parts.length > 1) {
    const mission = parts.slice(1).join("|").trim();
    return mission || null;
  }
  if (launch.rocket && name !== launch.rocket) {
    return name;
  }
  return null;
}

export function nextLaunchTitle(launch: LaunchItem, locale: Locale = "ko"): string {
  const vehicle = launchVehicle(launch, locale);
  const mission = launchMission(launch);
  if (mission && mission !== vehicle) {
    return `${vehicle} · ${mission}`;
  }
  return vehicle;
}

export function launchOperatorPlace(launch: LaunchItem): string {
  return [launch.provider, launch.location || launch.pad].filter((part): part is string => Boolean(part)).join(" · ");
}
