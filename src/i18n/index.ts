import { zonedParts } from "../clock";
import { en } from "./en";
import { ko, type MessageKey } from "./ko";

export type { MessageKey } from "./ko";
export { en, ko };

export type Locale = "ko" | "en";

export const LANGUAGE_STORAGE_KEY = "tonight-sky-language";

const DICTIONARIES = { ko, en } as const;

export type LanguageStore = {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
};

export function isLocale(value: string | null): value is Locale {
  return value === "ko" || value === "en";
}

/**
 * 저장된 선택이 있으면 그 언어, 없으면 브라우저 언어.
 * 브라우저 언어가 한국어(ko)로 시작하면 한국어, 그 외에는 영어.
 */
export function resolveLanguage(store: LanguageStore, browserLanguage: string): Locale {
  const saved = store.getItem(LANGUAGE_STORAGE_KEY);
  if (isLocale(saved)) {
    return saved;
  }
  return browserLanguage.toLowerCase().startsWith("ko") ? "ko" : "en";
}

export function saveLanguage(store: LanguageStore, locale: Locale): void {
  store.setItem(LANGUAGE_STORAGE_KEY, locale);
}

export function translate(
  locale: Locale,
  key: MessageKey,
  values?: Record<string, string | number>,
): string {
  const template = DICTIONARIES[locale][key];
  if (!values) {
    return template;
  }
  return template.replace(/\{(\w+)\}/g, (match, token: string) => {
    const value = values[token];
    return value === undefined ? match : String(value);
  });
}

/**
 * 첫 화면 제목. 장소가 있으면 `11월 12일 (목) · 서울`, 없으면 날짜만.
 * 날짜는 기기 시간대 달력이다. Asia/Seoul에서는 한국 날짜와 같다.
 * 슬로건을 붙이지 않는다.
 */
export function formatDatePlace(date: Date, place: string, locale: Locale, timeZone?: string): string {
  const parts = zonedParts(date, timeZone);
  const weekday = weekdayLabel(parts.weekday, locale);
  const values = { month: parts.month, day: parts.day, weekday, place };
  return place ? translate(locale, "datePlace", values) : translate(locale, "dateLine", values);
}

const WEEKDAY_KEYS = [
  "weekdaySun",
  "weekdayMon",
  "weekdayTue",
  "weekdayWed",
  "weekdayThu",
  "weekdayFri",
  "weekdaySat",
] as const satisfies readonly MessageKey[];

/** 요일 이름. 날짜 숫자는 기기 시간대이고, 이름만 언어를 따른다. */
export function weekdayLabel(dayIndex: number, locale: Locale): string {
  const key = WEEKDAY_KEYS[dayIndex] ?? "weekdaySun";
  return translate(locale, key);
}

const REGION_NAME_KEYS = {
  seoul: "regionSeoulName",
  busan: "regionBusanName",
  daegu: "regionDaeguName",
  incheon: "regionIncheonName",
  gwangju: "regionGwangjuName",
  daejeon: "regionDaejeonName",
  ulsan: "regionUlsanName",
  sejong: "regionSejongName",
  gyeonggi: "regionGyeonggiName",
  gangwon: "regionGangwonName",
  chungbuk: "regionChungbukName",
  chungnam: "regionChungnamName",
  jeonbuk: "regionJeonbukName",
  jeonnam: "regionJeonnamName",
  gyeongbuk: "regionGyeongbukName",
  gyeongnam: "regionGyeongnamName",
  jeju: "regionJejuName",
} as const satisfies Record<string, MessageKey>;

const REGION_SHORT_KEYS = {
  seoul: "regionSeoulShort",
  busan: "regionBusanShort",
  daegu: "regionDaeguShort",
  incheon: "regionIncheonShort",
  gwangju: "regionGwangjuShort",
  daejeon: "regionDaejeonShort",
  ulsan: "regionUlsanShort",
  sejong: "regionSejongShort",
  gyeonggi: "regionGyeonggiShort",
  gangwon: "regionGangwonShort",
  chungbuk: "regionChungbukShort",
  chungnam: "regionChungnamShort",
  jeonbuk: "regionJeonbukShort",
  jeonnam: "regionJeonnamShort",
  gyeongbuk: "regionGyeongbukShort",
  gyeongnam: "regionGyeongnamShort",
  jeju: "regionJejuShort",
} as const satisfies Record<string, MessageKey>;

const METEOR_NAME_KEYS = {
  qua: "meteorQua",
  lyr: "meteorLyr",
  eta: "meteorEta",
  sda: "meteorSda",
  per: "meteorPer",
  ori: "meteorOri",
  leo: "meteorLeo",
  gem: "meteorGem",
  urs: "meteorUrs",
} as const satisfies Record<string, MessageKey>;

const PLANET_NAME_KEYS = {
  venus: "planetVenus",
  mars: "planetMars",
  jupiter: "planetJupiter",
  saturn: "planetSaturn",
} as const satisfies Record<string, MessageKey>;

export function regionNameKey(id: string): MessageKey | null {
  return REGION_NAME_KEYS[id as keyof typeof REGION_NAME_KEYS] ?? null;
}

export function regionShortKey(id: string): MessageKey | null {
  return REGION_SHORT_KEYS[id as keyof typeof REGION_SHORT_KEYS] ?? null;
}

export function meteorNameKey(id: string): MessageKey | null {
  return METEOR_NAME_KEYS[id as keyof typeof METEOR_NAME_KEYS] ?? null;
}

export function planetNameKey(id: string): MessageKey | null {
  return PLANET_NAME_KEYS[id as keyof typeof PLANET_NAME_KEYS] ?? null;
}
