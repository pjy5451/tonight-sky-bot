import type { MessageKey } from "./i18n";

/** CelesTrak에서 2026-11-11에 확인한 허블 우주망원경(HST). */
export const HUBBLE_NORAD_CATALOG_ID = 20580;

/** CelesTrak stations 그룹에서 2026-11-11에 확인한 톈궁 본체 CSS (TIANHE). */
export const TIANGONG_NORAD_CATALOG_ID = 48274;

export const FILTER_GROUPS = [
  "stations",
  "starlink",
  "gps-ops",
  "galileo",
  "geo",
  "weather",
  "science",
  "korea",
] as const;

export type FilterGroup = (typeof FILTER_GROUPS)[number];

/**
 * 종류별 점 색. 디자인 토큰(#F5B544, #6CC4FF, #FFD58A, #A9B3C7, #F2F4F8)과
 * 같은 남색 배경 위의 하늘색·회색 계열만 쓴다.
 */
export const GROUP_COLOR: Record<FilterGroup, string> = {
  stations: "#6CC4FF",
  starlink: "#D5DDEA",
  "gps-ops": "#F5B544",
  galileo: "#FFD58A",
  geo: "#A9B3C7",
  weather: "#9FD4FF",
  science: "#F2F4F8",
  korea: "#6CC4FF",
};

export type GlobeFilter = {
  enabled: Record<FilterGroup, boolean>;
  koreaOnly: boolean;
};

export type FilterableSatellite = {
  group?: string;
  korean?: boolean;
};

export function defaultGlobeFilter(): GlobeFilter {
  return {
    enabled: {
      stations: true,
      starlink: true,
      "gps-ops": true,
      galileo: true,
      geo: true,
      weather: true,
      science: true,
      korea: true,
    },
    koreaOnly: false,
  };
}

export function isFilterGroup(value: string): value is FilterGroup {
  return (FILTER_GROUPS as readonly string[]).includes(value);
}

export function isSatelliteShown(satellite: FilterableSatellite, filter: GlobeFilter): boolean {
  if (filter.koreaOnly) {
    return satellite.korean === true;
  }
  const group = satellite.group && isFilterGroup(satellite.group) ? satellite.group : "stations";
  return filter.enabled[group];
}

export function toggleFilterGroup(filter: GlobeFilter, group: FilterGroup): GlobeFilter {
  return {
    koreaOnly: filter.koreaOnly,
    enabled: { ...filter.enabled, [group]: !filter.enabled[group] },
  };
}

export function toggleKoreaOnly(filter: GlobeFilter): GlobeFilter {
  return {
    enabled: filter.enabled,
    koreaOnly: !filter.koreaOnly,
  };
}

export function groupMessageKey(group: string | undefined): MessageKey {
  switch (group) {
    case "stations":
      return "groupStations";
    case "starlink":
      return "groupStarlink";
    case "gps-ops":
      return "groupGps";
    case "galileo":
      return "groupGalileo";
    case "geo":
      return "groupGeo";
    case "weather":
      return "groupWeather";
    case "science":
      return "groupScience";
    case "korea":
      return "groupKorea";
    default:
      return "groupOther";
  }
}

export function countryMessageKey(country: string | undefined): MessageKey {
  if (country === "US") {
    return "countryUS";
  }
  if (country === "EU") {
    return "countryEU";
  }
  if (country === "KR") {
    return "countryKR";
  }
  return "countryUnknown";
}
