import { translate, type Locale } from "./i18n";
import { formatKstTime } from "./sky";

/** `fetched_at`을 한국시간 `HH:MM`으로. 없거나 해석할 수 없으면 null. */
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
