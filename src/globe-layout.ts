import {
  FILTER_GROUPS,
  defaultGlobeFilter,
  isSatelliteShown,
  type FilterGroup,
  type FilterableSatellite,
  type GlobeFilter,
} from "./catalog";
import { ISS_NORAD_CATALOG_ID } from "./satellites";
import type { Locale } from "./i18n";

/** 1년 뒤 시안의 지구본 보기. 한 번에 하나만 고른다. */
export const GLOBE_VIEWS = ["all", "korea", "starlink", "nav", "geo"] as const;

export type GlobeView = (typeof GLOBE_VIEWS)[number];

export type CountableSatellite = FilterableSatellite & { noradId?: number };

/**
 * 공식 생중계가 있는 위성만 링크를 둔다.
 * ISS는 NASA Live (https://www.nasa.gov/live/). 페이지 안에 영상을 넣지 않는다.
 */
export const ISS_LIVE_URL = "https://www.nasa.gov/live/";

/** 위성을 고른 뒤 카메라가 그쪽으로 도는 시간. */
export const SELECTION_LOOK_MS = 900;

const KOREAN_NAMES: Record<string, string> = {
  "ISS (ZARYA)": "국제우주정거장",
  "CSS (TIANHE)": "톈궁",
  HST: "허블 우주망원경",
  "GEO-KOMPSAT-2A": "천리안 2A",
  "GEO-KOMPSAT-2B": "천리안 2B",
  "KOMPSAT-3": "아리랑 3",
  "KOMPSAT-3A": "아리랑 3A",
  "KOMPSAT-5": "아리랑 5",
  "CAS500-1": "차세대중형위성 1호",
};

function blankEnabled(): Record<FilterGroup, boolean> {
  return {
    stations: false,
    starlink: false,
    "gps-ops": false,
    galileo: false,
    geo: false,
    weather: false,
    science: false,
    korea: false,
  };
}

export function isGlobeView(value: string): value is GlobeView {
  return (GLOBE_VIEWS as readonly string[]).includes(value);
}

export function filterForView(view: GlobeView): GlobeFilter {
  if (view === "all") {
    return defaultGlobeFilter();
  }
  if (view === "korea") {
    return { enabled: defaultGlobeFilter().enabled, koreaOnly: true };
  }
  const enabled = blankEnabled();
  if (view === "starlink") {
    enabled.starlink = true;
  } else if (view === "nav") {
    enabled["gps-ops"] = true;
    enabled.galileo = true;
  } else {
    enabled.geo = true;
  }
  return { enabled, koreaOnly: false };
}

export function viewFromFilter(filter: GlobeFilter): GlobeView | null {
  if (filter.koreaOnly) {
    return "korea";
  }
  const enabled = FILTER_GROUPS.filter((group) => filter.enabled[group]);
  if (enabled.length === FILTER_GROUPS.length) {
    return "all";
  }
  if (enabled.length === 1 && enabled[0] === "starlink") {
    return "starlink";
  }
  if (enabled.length === 1 && enabled[0] === "geo") {
    return "geo";
  }
  if (enabled.length === 2 && enabled.every((group) => group === "gps-ops" || group === "galileo")) {
    return "nav";
  }
  return null;
}

export function countGlobeViews(satellites: readonly CountableSatellite[]): Record<GlobeView, number> {
  const unique: CountableSatellite[] = [];
  const seen = new Set<number>();
  for (const satellite of satellites) {
    if (typeof satellite.noradId === "number") {
      if (seen.has(satellite.noradId)) {
        continue;
      }
      seen.add(satellite.noradId);
    }
    unique.push(satellite);
  }

  const counts: Record<GlobeView, number> = {
    all: unique.length,
    korea: 0,
    starlink: 0,
    nav: 0,
    geo: 0,
  };
  for (const satellite of unique) {
    if (satellite.korean === true || satellite.group === "korea") {
      counts.korea += 1;
    }
    if (satellite.group === "starlink") {
      counts.starlink += 1;
    }
    if (satellite.group === "gps-ops" || satellite.group === "galileo") {
      counts.nav += 1;
    }
    if (satellite.group === "geo") {
      counts.geo += 1;
    }
  }
  return counts;
}

export function satelliteShownInView(satellite: FilterableSatellite, view: GlobeView): boolean {
  return isSatelliteShown(satellite, filterForView(view));
}

/** 카탈로그 이름에 한글 이름이 있으면 한국어에서만 그 이름을 쓴다. */
export function satelliteDisplayName(name: string | undefined, locale: Locale): string {
  const raw = name?.trim() ?? "";
  if (!raw) {
    return "—";
  }
  if (locale !== "ko") {
    return raw;
  }
  return KOREAN_NAMES[raw.toUpperCase()] ?? raw;
}

export function formatSelectionAltitudeKm(altKm: number): string {
  if (!Number.isFinite(altKm)) {
    return "—";
  }
  return `${altKm.toFixed(1)} km`;
}

export function formatSelectionSpeedKms(speedKmh: number): string {
  if (!Number.isFinite(speedKmh)) {
    return "—";
  }
  return `${(speedKmh / 3600).toFixed(2)} km/s`;
}

export function officialLiveUrl(noradId: number | undefined): string | null {
  if (noradId !== ISS_NORAD_CATALOG_ID) {
    return null;
  }
  return ISS_LIVE_URL;
}
