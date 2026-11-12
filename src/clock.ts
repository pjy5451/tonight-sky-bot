/**
 * 화면 시각은 기기 시간대다. 표기는 Intl `timeZoneName: "shortOffset"`
 * (GMT+9, GMT-5)만 쓴다. long은 한국어에서 "한국 표준시"가 되어
 * 영어 화면에 한글이 남는다.
 * 시간대를 생략하면 이 프로세스의 시간대다. 테스트는 시작부터 Asia/Seoul이다.
 */

const DAY_MS = 86_400_000;

const WEEKDAY_INDEX: Record<string, number> = {
  Sun: 0,
  Mon: 1,
  Tue: 2,
  Wed: 3,
  Thu: 4,
  Fri: 5,
  Sat: 6,
};

export type ZonedParts = {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  /** 0이 일요일. */
  weekday: number;
};

export function deviceTimeZone(): string {
  return Intl.DateTimeFormat().resolvedOptions().timeZone;
}

export function resolveTimeZone(timeZone?: string): string {
  if (timeZone === undefined) {
    return deviceTimeZone();
  }
  if (!timeZone) {
    throw new RangeError("시간대가 올바르지 않습니다.");
  }
  return timeZone;
}

function assertInstant(date: Date): void {
  if (Number.isNaN(date.getTime())) {
    throw new RangeError("시각이 올바르지 않습니다.");
  }
}

function readPart(parts: Intl.DateTimeFormatPart[], type: Intl.DateTimeFormatPartTypes): string {
  const value = parts.find((part) => part.type === type)?.value;
  if (!value) {
    throw new Error("시간대 표기를 읽지 못했습니다.");
  }
  return value;
}

export function zonedParts(date: Date, timeZone?: string): ZonedParts {
  assertInstant(date);
  const formatter = new Intl.DateTimeFormat("en-US", {
    timeZone: resolveTimeZone(timeZone),
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    weekday: "short",
    hourCycle: "h23",
  });
  const parts = formatter.formatToParts(date);
  const weekday = WEEKDAY_INDEX[readPart(parts, "weekday").slice(0, 3)];
  if (weekday === undefined) {
    throw new Error("요일을 읽지 못했습니다.");
  }
  let hour = Number(readPart(parts, "hour"));
  if (hour === 24) {
    hour = 0;
  }
  const parsed = {
    year: Number(readPart(parts, "year")),
    month: Number(readPart(parts, "month")),
    day: Number(readPart(parts, "day")),
    hour,
    minute: Number(readPart(parts, "minute")),
    weekday,
  };
  if (Object.values(parsed).some((value) => !Number.isInteger(value))) {
    throw new Error("시간대 표기를 읽지 못했습니다.");
  }
  return parsed;
}

/** `timeZoneName: "shortOffset"`. 예: GMT+9, GMT-5, GMT+0. */
export function formatShortOffset(date: Date, timeZone?: string): string {
  assertInstant(date);
  const formatter = new Intl.DateTimeFormat("en-US", {
    timeZone: resolveTimeZone(timeZone),
    hour: "numeric",
    hourCycle: "h23",
    timeZoneName: "shortOffset",
  });
  const name = readPart(formatter.formatToParts(date), "timeZoneName");
  if (!/^GMT(?:[+-]\d{1,2}(?::\d{2})?)?$/.test(name)) {
    throw new Error("시간대 표기를 읽지 못했습니다.");
  }
  return name;
}

export function offsetMinutes(date: Date, timeZone?: string): number {
  const label = formatShortOffset(date, timeZone);
  if (label === "GMT") {
    return 0;
  }
  const match = /^GMT([+-])(\d{1,2})(?::(\d{2}))?$/.exec(label);
  if (!match) {
    throw new Error("시간대 표기를 읽지 못했습니다.");
  }
  const sign = match[1] === "-" ? -1 : 1;
  const hours = Number(match[2]);
  const minutes = Number(match[3] ?? "0");
  return sign * (hours * 60 + minutes);
}

/** 그 시간대 달력에서 자정(시·분 00:00)의 절대 시각. */
export function localDayStart(date: Date, timeZone?: string): Date {
  const parts = zonedParts(date, timeZone);
  const zone = resolveTimeZone(timeZone);
  const wall = Date.UTC(parts.year, parts.month - 1, parts.day, 0, 0, 0);
  const corrected = wall - offsetMinutes(new Date(wall), zone) * 60_000;
  return new Date(wall - offsetMinutes(new Date(corrected), zone) * 60_000);
}

/** 그 시간대 달력 날짜를 하루 단위 정수로. 서머타임과 무관하게 날짜 차이만 센다. */
export function calendarDayIndex(date: Date, timeZone?: string): number {
  const parts = zonedParts(date, timeZone);
  return Math.round(Date.UTC(parts.year, parts.month - 1, parts.day) / DAY_MS);
}

/** 가장 가까운 분으로 반올림한 뒤 그 시간대의 `HH:MM`. */
export function formatClock(date: Date, timeZone?: string): string {
  assertInstant(date);
  const rounded = new Date(Math.round(date.getTime() / 60_000) * 60_000);
  const parts = zonedParts(rounded, timeZone);
  return `${String(parts.hour).padStart(2, "0")}:${String(parts.minute).padStart(2, "0")}`;
}
