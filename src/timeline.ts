import {
  Body,
  Equator,
  Horizon,
  Observer,
  SearchHourAngle,
  SearchRiseSet,
} from "astronomy-engine";
import type { IssPass } from "./iss-passes";
import {
  computeTonightSky,
  kstDayStart,
  sunCenterAltitudeCrossing,
  type Compass16,
  type PlanetId,
  type SkyPlace,
} from "./sky";

const HOUR_MS = 60 * 60 * 1000;
const NOON_OFFSET_MS = 12 * HOUR_MS;
/** 일출을 못 찾을 때 저녁 창을 닫는 한계. 서울의 밤은 이보다 짧다. */
const NIGHT_CAP_MS = 18 * HOUR_MS;

const PLANET_BODY: Record<PlanetId, Body> = {
  venus: Body.Venus,
  mars: Body.Mars,
  jupiter: Body.Jupiter,
  saturn: Body.Saturn,
};

const KIND_ORDER = {
  sunset: 0,
  civil: 1,
  nautical: 2,
  astronomical: 3,
  moonrise: 4,
  moonset: 5,
  planet: 6,
  iss: 7,
} as const;

export type TimelineKind = keyof typeof KIND_ORDER;

export type TimelineEvent = {
  kind: TimelineKind;
  time: Date;
  from?: Compass16;
  to?: Compass16;
  elevation?: number;
  magnitude?: number | null;
  recommended?: boolean;
  planetId?: PlanetId;
  altitude?: number;
};

export type TimelineOptions = {
  issPasses?: readonly IssPass[];
  magnitude?: (pass: IssPass) => number | null;
};

function localNoon(date: Date): Date {
  return new Date(kstDayStart(date).getTime() + NOON_OFFSET_MS);
}

function inWindow(time: Date, startMs: number, endMs: number): boolean {
  const ms = time.getTime();
  return ms >= startMs && ms < endMs;
}

function pushTwilight(
  events: TimelineEvent[],
  kind: "civil" | "nautical" | "astronomical",
  observer: Observer,
  noon: Date,
  altitude: number,
  startMs: number,
  endMs: number,
): void {
  const time = sunCenterAltitudeCrossing(observer, noon, -1, altitude);
  if (time && inWindow(time, startMs, endMs)) {
    events.push({ kind, time });
  }
}

/**
 * 선택 지역의 오늘 저녁부터 다음 일출 전까지.
 * 일몰, 시민·항해·천문 박명 끝, 맨눈 ISS 통과, 오늘 밤 행성의 남중, 달 뜸·짐.
 * 박명과 오늘 밤 행성 시각은 `sunCenterAltitudeCrossing`을 같이 쓴다.
 */
export function buildTonightTimeline(
  place: SkyPlace,
  date: Date,
  options: TimelineOptions = {},
): TimelineEvent[] {
  const sky = computeTonightSky(place, date);
  if (!sky.sunset) {
    return [];
  }

  const observer = new Observer(place.latitude, place.longitude, 0);
  const sunset = sky.sunset;
  const startMs = sunset.getTime();
  const nextSunrise = SearchRiseSet(Body.Sun, observer, 1, sunset, 2);
  const sunriseMs = nextSunrise?.date.getTime() ?? Number.NaN;
  const endMs =
    Number.isFinite(sunriseMs) && sunriseMs > startMs ? sunriseMs : startMs + NIGHT_CAP_MS;
  const noon = localNoon(date);
  const events: TimelineEvent[] = [{ kind: "sunset", time: sunset }];

  pushTwilight(events, "civil", observer, noon, -6, startMs, endMs);
  pushTwilight(events, "nautical", observer, noon, -12, startMs, endMs);
  pushTwilight(events, "astronomical", observer, noon, -18, startMs, endMs);

  const moonrise = SearchRiseSet(Body.Moon, observer, 1, sunset, 1);
  if (moonrise && inWindow(moonrise.date, startMs, endMs)) {
    events.push({ kind: "moonrise", time: moonrise.date });
  }
  const moonset = SearchRiseSet(Body.Moon, observer, -1, sunset, 1);
  if (moonset && inWindow(moonset.date, startMs, endMs)) {
    events.push({ kind: "moonset", time: moonset.date });
  }

  for (const planet of sky.planets) {
    const body = PLANET_BODY[planet.id];
    const culmination = SearchHourAngle(body, observer, 0, sunset, 1);
    if (!inWindow(culmination.time.date, startMs, endMs)) {
      continue;
    }
    const equatorial = Equator(body, culmination.time.date, observer, true, true);
    const horizontal = Horizon(
      culmination.time.date,
      observer,
      equatorial.ra,
      equatorial.dec,
      "normal",
    );
    if (!(horizontal.altitude > 0)) {
      continue;
    }
    events.push({
      kind: "planet",
      time: culmination.time.date,
      planetId: planet.id,
      altitude: horizontal.altitude,
    });
  }

  const issEvents: TimelineEvent[] = [];
  for (const pass of options.issPasses ?? []) {
    if (!inWindow(pass.peak.time, startMs, endMs)) {
      continue;
    }
    let magnitude: number | null = null;
    if (options.magnitude) {
      try {
        const value = options.magnitude(pass);
        magnitude = typeof value === "number" && Number.isFinite(value) ? value : null;
      } catch {
        magnitude = null;
      }
    }
    issEvents.push({
      kind: "iss",
      time: pass.peak.time,
      from: pass.start.direction,
      to: pass.end.direction,
      elevation: pass.peak.elevation,
      magnitude,
    });
  }
  const best = issEvents.reduce<TimelineEvent | null>((current, event) => {
    if (!current) {
      return event;
    }
    const elevation = event.elevation ?? Number.NEGATIVE_INFINITY;
    const currentElevation = current.elevation ?? Number.NEGATIVE_INFINITY;
    if (elevation > currentElevation) {
      return event;
    }
    if (elevation === currentElevation && event.time.getTime() < current.time.getTime()) {
      return event;
    }
    return current;
  }, null);
  if (best) {
    best.recommended = true;
  }
  events.push(...issEvents);

  events.sort(
    (left, right) =>
      left.time.getTime() - right.time.getTime() || KIND_ORDER[left.kind] - KIND_ORDER[right.kind],
  );
  return events;
}

/** 아직 오지 않은 첫 이벤트. 시각이 같으면 목록 순서를 따른다. */
export function nextTimelineEvent(
  events: readonly TimelineEvent[],
  now: Date,
): TimelineEvent | null {
  const nowMs = now.getTime();
  if (Number.isNaN(nowMs)) {
    return null;
  }
  return events.find((event) => event.time.getTime() > nowMs) ?? null;
}

/** `T−HH:MM:SS`. 빼기는 U+2212. 이미 지난 시각이면 null. */
export function formatTimelineCountdown(target: Date, now: Date): string | null {
  const remainingMs = target.getTime() - now.getTime();
  if (!Number.isFinite(remainingMs) || remainingMs <= 0) {
    return null;
  }
  const totalSeconds = Math.floor(remainingMs / 1000);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  const pad = (value: number) => String(value).padStart(2, "0");
  return `T\u2212${pad(hours)}:${pad(minutes)}:${pad(seconds)}`;
}
