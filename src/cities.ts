/** GeoNames에서 만든 `public/data/cities.json` 한 행. */
export type CityRecord = {
  asciiname: string;
  country: string;
  lat: number;
  lon: number;
  featureCode: string;
  ko: string;
};

const LABEL_MAX_LENGTH = 20;

export function parseCities(payload: unknown): CityRecord[] {
  if (!Array.isArray(payload)) {
    return [];
  }
  const cities: CityRecord[] = [];
  for (const item of payload) {
    const city = parseCity(item);
    if (city) {
      cities.push(city);
    }
  }
  return cities;
}

/**
 * 앞뒤 공백을 버린 검색어가 비어 있으면 빈 목록.
 * 그 외에는 asciiname 또는 ko를 대소문자 구분 없이 포함한다.
 */
export function matchingCities(cities: readonly CityRecord[], query: string): CityRecord[] {
  const needle = query.trim().toLowerCase();
  if (needle.length === 0) {
    return [];
  }
  return cities.filter((city) => {
    if (city.asciiname.length > LABEL_MAX_LENGTH) {
      return false;
    }
    return city.asciiname.toLowerCase().includes(needle) || city.ko.toLowerCase().includes(needle);
  });
}

function parseCity(value: unknown): CityRecord | null {
  if (!value || typeof value !== "object") {
    return null;
  }
  const record = value as Record<string, unknown>;
  if (typeof record.asciiname !== "string") {
    return null;
  }
  if (record.asciiname.length === 0 || record.asciiname.length > LABEL_MAX_LENGTH) {
    return null;
  }
  if (typeof record.country !== "string" || record.country.length === 0) {
    return null;
  }
  if (typeof record.lat !== "number" || typeof record.lon !== "number") {
    return null;
  }
  if (!Number.isFinite(record.lat) || !Number.isFinite(record.lon)) {
    return null;
  }
  if (record.lat < -90 || record.lat > 90 || record.lon < -180 || record.lon > 180) {
    return null;
  }
  if (typeof record.featureCode !== "string" || record.featureCode.length === 0) {
    return null;
  }
  if (record.ko !== undefined && typeof record.ko !== "string") {
    return null;
  }
  return {
    asciiname: record.asciiname,
    country: record.country,
    lat: record.lat,
    lon: record.lon,
    featureCode: record.featureCode,
    ko: typeof record.ko === "string" ? record.ko : "",
  };
}
