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
 * 종류별 점 색. styles.css의 디자인 토큰과 같은 값이다.
 * 한국·스타링크·항법·정지궤도는 DESIGN.md 5장, 그 외는 시안·본문색.
 */
export const GROUP_COLOR: Record<FilterGroup, string> = {
  stations: "#7FD3FF",
  starlink: "#A9B8D6",
  "gps-ops": "#7BD88F",
  galileo: "#7BD88F",
  geo: "#C59BFF",
  weather: "#7FD3FF",
  science: "#E9EDF5",
  korea: "#FF7A59",
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
