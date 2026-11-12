import { translate, type Locale } from "./i18n";
import { formatKstTime } from "./sky";

/** 이 시간 이상 지난 데이터는 오류로 막지 않고 안내만 한다. */
export const STALE_DATA_MS = 24 * 60 * 60 * 1000;

/** `fetched_at`을 기기 시간대 `HH:MM`으로. 없거나 해석할 수 없으면 null. */
export function clockFromFetchedAt(fetchedAt: string | null): string | null {
  if (!fetchedAt) {
    return null;
  }
  const date = new Date(fetchedAt);
  if (Number.isNaN(date.getTime())) {
    return null;
  }
  return formatKstTime(date);
}

/**
 * 목업 하단의 `데이터: CelesTrak · The Space Devs · 03:00 갱신`.
 * 두 파일의 시각이 다르면 각각 적는다. 시각을 알 수 없으면 만들지 않는다.
 */
export function dataSourceFooter(
  orbitFetchedAt: string | null,
  launchFetchedAt: string | null,
  locale: Locale = "ko",
): string {
  const orbit = clockFromFetchedAt(orbitFetchedAt);
  const launch = clockFromFetchedAt(launchFetchedAt);
  if (orbit && launch && orbit !== launch) {
    return translate(locale, "footerSplit", { orbit, launch });
  }
  if (orbit || launch) {
    return translate(locale, "footerBoth", { time: orbit ?? launch ?? "" });
  }
  return translate(locale, "footerPlain");
}

/** 24시간 이상 지난 시각 중 가장 오래된 것을 `N시간 전 데이터`로. 신선하면 null. */
export function staleDataNotice(
  fetchedAts: ReadonlyArray<string | null>,
  now: Date,
  locale: Locale = "ko",
): string | null {
  const nowMs = now.getTime();
  if (Number.isNaN(nowMs)) {
    return null;
  }
  let oldestHours: number | null = null;
  for (const fetchedAt of fetchedAts) {
    if (!fetchedAt) {
      continue;
    }
    const then = Date.parse(fetchedAt);
    if (Number.isNaN(then)) {
      continue;
    }
    const age = nowMs - then;
    if (age < STALE_DATA_MS) {
      continue;
    }
    const hours = Math.floor(age / (60 * 60 * 1000));
    if (oldestHours === null || hours > oldestHours) {
      oldestHours = hours;
    }
  }
  if (oldestHours === null) {
    return null;
  }
  return translate(locale, "staleData", { hours: oldestHours });
}
