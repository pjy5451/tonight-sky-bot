export const LOCATION_STORAGE_KEY = "tonight-sky-location";

export type LocationSource = "geolocation" | "region";

export type StoredLocation = {
  latitude: number;
  longitude: number;
  label: string;
  source: LocationSource;
};

export type LocationInput = {
  latitude: number;
  longitude: number;
  label: string;
  source: LocationSource;
};

export type KeyValueStore = {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
};

export type Region = {
  id: string;
  name: string;
  shortName: string;
  latitude: number;
  longitude: number;
};

/**
 * 17개 시·도의 대표 좌표. 각 시·도 청사 위치다.
 * 선택값은 소수점 1자리로 반올림한 뒤 이 기기의 localStorage에만 저장한다.
 *
 * 출처 (2026-11-10 조회):
 * - 한국어 위키백과 MediaWiki coordinates: 서울특별시청사, 부산광역시청, 인천광역시청,
 *   광주광역시청, 대전광역시청, 울산광역시청, 세종특별자치시청, 강원특별자치도청,
 *   충청북도청, 충청남도청, 전북특별자치도청, 전라남도청, 경상남도청, 제주특별자치도청.
 * - OpenStreetMap: 대구광역시청 node 1903901577(중구 공평로),
 *   경기도청 node 9810962059(수원시 영통구 도청로 30, 현 본청.
 *   위키백과 좌표는 팔달구 구청사라 현재 청사를 씀),
 *   경상북도청 way 516927020(안동시 풍천면 신청사).
 */
export const REGIONS: readonly Region[] = [
  { id: "seoul", name: "서울특별시", shortName: "서울", latitude: 37.56640556, longitude: 126.97782222 },
  { id: "busan", name: "부산광역시", shortName: "부산", latitude: 35.1798159, longitude: 129.0750224 },
  { id: "daegu", name: "대구광역시", shortName: "대구", latitude: 35.8715082, longitude: 128.6019174 },
  { id: "incheon", name: "인천광역시", shortName: "인천", latitude: 37.456089, longitude: 126.705918 },
  { id: "gwangju", name: "광주광역시", shortName: "광주", latitude: 35.159611, longitude: 126.852353 },
  { id: "daejeon", name: "대전광역시", shortName: "대전", latitude: 36.350382, longitude: 127.384742 },
  { id: "ulsan", name: "울산광역시", shortName: "울산", latitude: 35.539626, longitude: 129.311528 },
  { id: "sejong", name: "세종특별자치시", shortName: "세종", latitude: 36.480071, longitude: 127.289009 },
  { id: "gyeonggi", name: "경기도", shortName: "경기", latitude: 37.2889375, longitude: 127.0537447 },
  { id: "gangwon", name: "강원특별자치도", shortName: "강원", latitude: 37.88557, longitude: 127.730186 },
  { id: "chungbuk", name: "충청북도", shortName: "충북", latitude: 36.635684, longitude: 127.49139 },
  { id: "chungnam", name: "충청남도", shortName: "충남", latitude: 36.658827, longitude: 126.672835 },
  { id: "jeonbuk", name: "전북특별자치도", shortName: "전북", latitude: 35.820358, longitude: 127.108726 },
  { id: "jeonnam", name: "전라남도", shortName: "전남", latitude: 34.816862, longitude: 126.464532 },
  { id: "gyeongbuk", name: "경상북도", shortName: "경북", latitude: 36.5753909, longitude: 128.5051633 },
  { id: "gyeongnam", name: "경상남도", shortName: "경남", latitude: 35.236591, longitude: 128.690441 },
  { id: "jeju", name: "제주특별자치도", shortName: "제주", latitude: 33.488833, longitude: 126.498079 },
];

const LABEL_MAX_LENGTH = 20;

/**
 * 소수점 1자리 반올림. 절반은 0에서 먼 쪽으로 올린다.
 * `Number#toFixed`는 35.15를 35.1로 만드는 이진 오차가 있어 십진 문자열로 계산한다.
 */
export function roundToTenth(value: number): number {
  if (!Number.isFinite(value)) {
    throw new RangeError("좌표는 유한한 숫자여야 합니다.");
  }

  const negative = value < 0;
  const text = Math.abs(value).toString();
  if (text.includes("e") || text.includes("E")) {
    throw new RangeError("좌표를 소수점 1자리로 반올림할 수 없습니다.");
  }

  const [wholeText, fractionText = ""] = text.split(".");
  const digits = `${fractionText}00`;
  let tenth = Number(digits[0]);
  const hundredth = Number(digits[1]);
  let whole = Number(wholeText);

  if (hundredth >= 5) {
    tenth += 1;
    if (tenth === 10) {
      tenth = 0;
      whole += 1;
    }
  }

  const rounded = whole + tenth / 10;
  return negative ? -rounded : rounded;
}

export function geolocationErrorMessage(code: number): string {
  switch (code) {
    case 1:
      return "위치 권한을 허용하지 않았습니다. 시·도를 선택해 주세요.";
    case 2:
      return "현재 위치를 찾지 못했습니다. 시·도를 선택해 주세요.";
    case 3:
      return "위치 확인 시간이 초과되었습니다. 시·도를 선택해 주세요.";
    default:
      return "위치를 가져오지 못했습니다. 시·도를 선택해 주세요.";
  }
}

export function saveLocation(store: KeyValueStore, input: LocationInput): StoredLocation {
  const latitude = roundToTenth(input.latitude);
  const longitude = roundToTenth(input.longitude);

  if (latitude < -90 || latitude > 90 || longitude < -180 || longitude > 180) {
    throw new RangeError("좌표 범위를 벗어났습니다.");
  }

  const label = input.label.trim();
  if (label.length === 0 || label.length > LABEL_MAX_LENGTH) {
    throw new RangeError("위치 이름이 올바르지 않습니다.");
  }

  if (input.source !== "geolocation" && input.source !== "region") {
    throw new RangeError("위치 출처가 올바르지 않습니다.");
  }

  const stored: StoredLocation = {
    latitude,
    longitude,
    label,
    source: input.source,
  };

  store.setItem(LOCATION_STORAGE_KEY, JSON.stringify(stored));
  return stored;
}

export function loadLocation(store: KeyValueStore): StoredLocation | null {
  const raw = store.getItem(LOCATION_STORAGE_KEY);
  if (!raw) {
    return null;
  }

  try {
    const parsed: unknown = JSON.parse(raw);
    if (!isStoredLocation(parsed)) {
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

function isStoredLocation(value: unknown): value is StoredLocation {
  if (!value || typeof value !== "object") {
    return false;
  }

  const record = value as Record<string, unknown>;
  if (typeof record.latitude !== "number" || typeof record.longitude !== "number") {
    return false;
  }
  if (!Number.isFinite(record.latitude) || !Number.isFinite(record.longitude)) {
    return false;
  }
  if (record.latitude < -90 || record.latitude > 90 || record.longitude < -180 || record.longitude > 180) {
    return false;
  }
  if (record.latitude !== roundToTenth(record.latitude) || record.longitude !== roundToTenth(record.longitude)) {
    return false;
  }
  if (typeof record.label !== "string") {
    return false;
  }

  const label = record.label.trim();
  if (label.length === 0 || label.length > LABEL_MAX_LENGTH || label !== record.label) {
    return false;
  }
  if (record.source !== "geolocation" && record.source !== "region") {
    return false;
  }

  return true;
}
