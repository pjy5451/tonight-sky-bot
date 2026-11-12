import { mkdir, readFile, writeFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";

// Build-time fetch only. The browser reads public/data JSON and does not call these APIs.
// A failed request still exits 0 so `npm run fetch-data && npm run build` can continue.
//
// Cloudflare 빌드(기본, FETCH_DATA_MODE 없음)는 CelesTrak·Launch Library를 부르지 않고
// data 브랜치의 raw JSON을 받아 쓴다. 받지 못하면 저장소에 있는 파일을 그대로 둔다.
// 원본 요청은 data-refresh 워크플로가 FETCH_DATA_MODE=refresh 로만 한다.

export const CELESTRAK_STATIONS_URL =
  "https://celestrak.org/NORAD/elements/gp.php?GROUP=stations&FORMAT=json";

// mode=detailed includes launch vid_urls. normal mode omits those livestream links.
export const LAUNCH_LIBRARY_UPCOMING_URL =
  "https://ll.thespacedevs.com/2.3.0/launches/upcoming/?limit=20&mode=detailed";

export const USER_AGENT = "Argonova/0.1 (tonight-sky-bot; +https://argonova.pages.dev)";

/** Cloudflare 빌드가 읽는 data 브랜치. 묶음당 원본 요청은 워크플로가 6시간에 한 번 한다. */
export const DATA_MIRROR_BASE =
  "https://raw.githubusercontent.com/pjy5451/tonight-sky-bot/data/public/data/";

export const DATA_FILES = ["tle.json", "launches.json", "catalog.json"];

export function mirrorFileUrl(filename) {
  return `${DATA_MIRROR_BASE}${filename}`;
}

/** 환경 변수가 없으면 빌드용 미러. refresh·upstream만 원본을 부른다. */
export function fetchModeFromEnv(env = process.env) {
  const mode = env?.FETCH_DATA_MODE;
  if (mode === "refresh" || mode === "upstream") {
    return mode;
  }
  return "mirror";
}

/** 브라우저용 위성 목록은 이 크기를 넘기지 않는다. */
export const CATALOG_BYTE_BUDGET = 3 * 1024 * 1024;

/** 하루 한 번, 묶음마다 한 번만 요청하는 CelesTrak GP 그룹. */
export const CATALOG_GROUPS = ["starlink", "gps-ops", "galileo", "geo", "weather", "science"];

/** 그룹만으로 국가가 정해지는 별자리. 나머지는 빈 값이고, 한국 목록은 KR이다. */
export const GROUP_COUNTRY = {
  starlink: "US",
  "gps-ops": "US",
  galileo: "EU",
  geo: "",
  weather: "",
  science: "",
};

/**
 * 한국 위성을 한 번에 찾기 위한 NAME 검색. 각 이름은 요청 한 번.
 * 2026-11-11 CelesTrak GP에서 아래 번호를 확인했다.
 */
export const KOREAN_NAME_QUERIES = ["KOMPSAT", "CAS500", "NEONSAT", "NEXTSAT", "KOREASAT"];

/**
 * CelesTrak GP NAME 검색(2026-11-11)으로 확인한 NORAD 번호.
 * 천리안 2A·2B는 GEO-KOMPSAT-2A/2B, 아리랑 3·3A·5, 차세대중형위성(CAS500)을 포함한다.
 */
export const KOREAN_NORAD_IDS = [
  26032, 29268, 38338, 39227, 40536, 43823, 45246, 66820,
  47932, 66655, 69013, 69869,
  59587, 67614, 100955, 100961, 100962, 100963, 100968,
  43811, 56743,
  23639, 29349, 37265, 42691, 42984, 45920, 61910,
];

/** compactGpItem 배열의 칸. 브라우저 파서와 같은 순서다. */
export const CATALOG_COLUMN = {
  name: 0,
  norad: 1,
  group: 2,
  country: 3,
  epoch: 4,
  meanMotion: 5,
  eccentricity: 6,
  inclination: 7,
  raan: 8,
  argp: 9,
  anomaly: 10,
  bstar: 11,
  meanMotionDot: 12,
  korean: 13,
};

export function celestrakGroupUrl(group) {
  return `https://celestrak.org/NORAD/elements/gp.php?GROUP=${encodeURIComponent(group)}&FORMAT=json`;
}

export function celestrakNameUrl(name) {
  return `https://celestrak.org/NORAD/elements/gp.php?NAME=${encodeURIComponent(name)}&FORMAT=json`;
}

export function catalogRequestPlan() {
  return [
    ...CATALOG_GROUPS.map((group) => ({ id: group, url: celestrakGroupUrl(group) })),
    ...KOREAN_NAME_QUERIES.map((name) => ({ id: "korea", name, url: celestrakNameUrl(name) })),
  ];
}

const LAUNCH_LIMIT = 20;
const REQUEST_TIMEOUT_MS = 20_000;

const STATION_NUMBER_FIELDS = [
  "MEAN_MOTION",
  "ECCENTRICITY",
  "INCLINATION",
  "RA_OF_ASC_NODE",
  "ARG_OF_PERICENTER",
  "MEAN_ANOMALY",
];

const defaultDataDir = new URL("../public/data/", import.meta.url);

function defaultDataDirectory() {
  return defaultDataDir;
}

function errorMessage(error) {
  if (error instanceof Error && error.message.trim()) {
    return error.message.trim();
  }
  return "알 수 없는 오류";
}

function failureDocument(label, error) {
  return {
    error: `${label} 요청 실패: ${errorMessage(error)}`,
    items: [],
  };
}

function readText(value) {
  if (typeof value !== "string") {
    return null;
  }
  const trimmed = value.trim();
  return trimmed ? trimmed : null;
}

function readStatus(status) {
  if (typeof status === "string") {
    return readText(status);
  }
  if (status && typeof status === "object") {
    return readText(status.name);
  }
  return null;
}

function isHttpUrl(value) {
  return typeof value === "string" && /^https?:\/\//i.test(value.trim());
}

function appendWebcastUrls(urls, bucket) {
  if (!Array.isArray(bucket)) {
    return;
  }
  for (const entry of bucket) {
    const candidate = typeof entry === "string" ? entry : entry?.url;
    if (!isHttpUrl(candidate)) {
      continue;
    }
    const url = candidate.trim();
    if (!urls.includes(url)) {
      urls.push(url);
    }
  }
}

function readWebcastUrls(launch) {
  const urls = [];
  appendWebcastUrls(urls, launch.vid_urls);
  appendWebcastUrls(urls, launch.vidURLs);
  const mission = launch.mission;
  if (mission && typeof mission === "object") {
    appendWebcastUrls(urls, mission.vid_urls);
    appendWebcastUrls(urls, mission.vidURLs);
  }
  return urls;
}

function assertStation(item) {
  if (!item || typeof item !== "object" || Array.isArray(item)) {
    throw new Error("위성 항목 형식이 올바르지 않습니다.");
  }
  if (!readText(item.OBJECT_NAME) || (typeof item.NORAD_CAT_ID !== "number" && typeof item.NORAD_CAT_ID !== "string")) {
    throw new Error("위성 항목에 이름 또는 카탈로그 번호가 없습니다.");
  }
  if (!readText(item.EPOCH)) {
    throw new Error("위성 항목에 EPOCH 값이 없습니다.");
  }
  for (const field of STATION_NUMBER_FIELDS) {
    if (typeof item[field] !== "number" || !Number.isFinite(item[field])) {
      throw new Error(`위성 항목에 ${field} 값이 없습니다.`);
    }
  }
}

export function parseStationItems(payload) {
  if (!Array.isArray(payload)) {
    throw new Error("응답이 위성 목록이 아닙니다.");
  }
  for (const item of payload) {
    assertStation(item);
  }
  return payload;
}

/** 묶음 하나가 통째로 깨지지 않게, 형식이 잘못된 행만 건너뛴다. */
export function parseCatalogGroupItems(payload) {
  if (!Array.isArray(payload)) {
    throw new Error("응답이 위성 목록이 아닙니다.");
  }
  const items = [];
  for (const item of payload) {
    try {
      assertStation(item);
      items.push(item);
    } catch {
      // 한 행이 깨져도 나머지 위성은 남긴다.
    }
  }
  return items;
}

function finiteOrZero(value) {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

/** 화면에 필요한 궤도 값만 남긴 배열. 이름·설명 같은 나머지 필드는 넣지 않는다. */
export function compactGpItem(item, group, country, korean) {
  const norad = typeof item.NORAD_CAT_ID === "number" ? item.NORAD_CAT_ID : Number(item.NORAD_CAT_ID);
  return [
    readText(item.OBJECT_NAME),
    norad,
    group,
    country,
    readText(item.EPOCH),
    item.MEAN_MOTION,
    item.ECCENTRICITY,
    item.INCLINATION,
    item.RA_OF_ASC_NODE,
    item.ARG_OF_PERICENTER,
    item.MEAN_ANOMALY,
    finiteOrZero(item.BSTAR),
    finiteOrZero(item.MEAN_MOTION_DOT),
    korean ? 1 : 0,
  ];
}

export function serializeCatalog(document) {
  return `${JSON.stringify(document)}\n`;
}

function compactLaunch(launch) {
  if (!launch || typeof launch !== "object" || Array.isArray(launch)) {
    throw new Error("발사 항목 형식이 올바르지 않습니다.");
  }

  const configuration = launch.rocket?.configuration;
  const item = {
    id: readText(launch.id),
    name: readText(launch.name),
    net: readText(launch.net),
    status: readStatus(launch.status),
    provider: readText(launch.launch_service_provider?.name),
    rocket: readText(configuration?.full_name) ?? readText(configuration?.name),
    pad: readText(launch.pad?.name),
    location: readText(launch.pad?.location?.name),
    webcast_urls: readWebcastUrls(launch),
  };

  if (!item.id && !item.name && !item.net) {
    throw new Error("발사 항목에 식별 정보가 없습니다.");
  }

  return item;
}

export function parseLaunchItems(payload) {
  if (!payload || typeof payload !== "object" || Array.isArray(payload) || !Array.isArray(payload.results)) {
    throw new Error("응답에 발사 목록이 없습니다.");
  }
  return payload.results.slice(0, LAUNCH_LIMIT).map(compactLaunch);
}

function requestSignal(timeoutMs) {
  if (typeof AbortSignal !== "undefined" && typeof AbortSignal.timeout === "function") {
    return AbortSignal.timeout(timeoutMs);
  }
  const controller = new AbortController();
  setTimeout(() => controller.abort(), timeoutMs);
  return controller.signal;
}

async function requestJson(url, fetchImpl) {
  const response = await fetchImpl(url, {
    headers: {
      accept: "application/json",
      "user-agent": USER_AGENT,
    },
    signal: requestSignal(REQUEST_TIMEOUT_MS),
  });
  if (!response.ok) {
    throw new Error(`HTTP ${response.status}`);
  }
  return response.json();
}

async function writeDocument(writeFileImpl, dataDir, filename, document) {
  await writeFileImpl(new URL(filename, dataDir), `${JSON.stringify(document, null, 2)}\n`);
}

async function readExistingDocument(readFileImpl, dataDir, filename) {
  try {
    const text = await readFileImpl(new URL(filename, dataDir), "utf8");
    const document = JSON.parse(text);
    if (!document || typeof document !== "object" || Array.isArray(document)) {
      return null;
    }
    return document;
  } catch {
    return null;
  }
}

/** 오류 문서가 아닌, 이전에 받아 둔 목록. 빈 목록도 성공이다. */
function isSuccessDocument(document) {
  return Boolean(document) && Array.isArray(document.items) && typeof document.error !== "string";
}

/**
 * 이번에 실패한 묶음의 위성만 이전 성공본에서 다시 붙인다.
 * 묶음이 모두 실패하면 이전 파일 전체를 그대로 돌려준다.
 */
export function mergeCatalogWithPrevious(next, previous) {
  if (!isSuccessDocument(previous)) {
    return next;
  }
  const groups = next?.groups && typeof next.groups === "object" ? next.groups : {};
  const failedGroups = Object.keys(groups).filter((name) => groups[name]?.ok === false);
  if (failedGroups.length === 0) {
    return next;
  }

  const tracked = [...CATALOG_GROUPS, "korea"];
  const allFailed = tracked.every((name) => groups[name]?.ok !== true);
  if (allFailed) {
    return previous;
  }

  const failed = new Set(failedGroups);
  const nextItems = Array.isArray(next.items) ? next.items : [];
  const seen = new Set();
  for (const row of nextItems) {
    if (Array.isArray(row)) {
      seen.add(row[CATALOG_COLUMN.norad]);
    }
  }

  const restored = [];
  for (const row of previous.items) {
    if (!Array.isArray(row)) {
      continue;
    }
    const group = row[CATALOG_COLUMN.group];
    if (!failed.has(group)) {
      continue;
    }
    const norad = row[CATALOG_COLUMN.norad];
    if (seen.has(norad)) {
      continue;
    }
    seen.add(norad);
    restored.push(row);
  }

  if (restored.length === 0) {
    return next;
  }

  const mergedGroups = { ...groups };
  for (const name of failed) {
    const count = restored.filter((row) => row[CATALOG_COLUMN.group] === name).length;
    if (count > 0) {
      mergedGroups[name] = { ok: true, count, preserved: true };
    }
  }

  const items = [...restored, ...nextItems];
  const document = { ...next, groups: mergedGroups, items };
  if (document.error && items.length > 0) {
    delete document.error;
  }
  return document;
}

async function readCatalogGroup(url, fetchImpl) {
  const payload = await requestJson(url, fetchImpl);
  return parseCatalogGroupItems(payload);
}

export async function collectCatalog(fetchImpl) {
  const koreanIds = new Set(KOREAN_NORAD_IDS);
  const byNorad = new Map();
  const groups = {};

  for (const group of CATALOG_GROUPS) {
    try {
      const items = await readCatalogGroup(celestrakGroupUrl(group), fetchImpl);
      let count = 0;
      for (const item of items) {
        const norad = Number(item.NORAD_CAT_ID);
        if (byNorad.has(norad)) {
          continue;
        }
        const korean = koreanIds.has(norad);
        const country = korean ? "KR" : (GROUP_COUNTRY[group] ?? "");
        byNorad.set(norad, compactGpItem(item, group, country, korean));
        count += 1;
      }
      groups[group] = { ok: true, count };
    } catch (error) {
      groups[group] = {
        ok: false,
        error: `CelesTrak ${group} 요청 실패: ${errorMessage(error)}`,
      };
      console.error(groups[group].error);
    }
  }

  const koreaErrors = [];
  for (const name of KOREAN_NAME_QUERIES) {
    try {
      const items = await readCatalogGroup(celestrakNameUrl(name), fetchImpl);
      for (const item of items) {
        const norad = Number(item.NORAD_CAT_ID);
        if (!koreanIds.has(norad)) {
          continue;
        }
        const existing = byNorad.get(norad);
        if (existing) {
          existing[CATALOG_COLUMN.country] = "KR";
          existing[CATALOG_COLUMN.korean] = 1;
          continue;
        }
        byNorad.set(norad, compactGpItem(item, "korea", "KR", true));
      }
    } catch (error) {
      const message = `CelesTrak korea ${name} 요청 실패: ${errorMessage(error)}`;
      koreaErrors.push(message);
      console.error(message);
    }
  }

  let koreanCount = 0;
  for (const row of byNorad.values()) {
    if (row[CATALOG_COLUMN.korean] === 1) {
      koreanCount += 1;
    }
  }
  if (koreaErrors.length === KOREAN_NAME_QUERIES.length && koreanCount === 0) {
    groups.korea = {
      ok: false,
      error: koreaErrors[0] ?? "CelesTrak korea 요청 실패",
    };
  } else {
    groups.korea = { ok: true, count: koreanCount };
    if (koreaErrors.length > 0) {
      groups.korea.warnings = koreaErrors;
    }
  }

  const items = [...byNorad.values()];
  const document = { groups, items };
  const allFailed = [...CATALOG_GROUPS, "korea"].every((group) => groups[group]?.ok === false);
  if (allFailed) {
    document.error = "CelesTrak 위성 묶음 요청 실패";
  }
  return document;
}

async function saveCatalog({ fetchImpl, writeFileImpl, readFileImpl, dataDir, fetchedAt, preservePrevious }) {
  const previous = preservePrevious ? await readExistingDocument(readFileImpl, dataDir, "catalog.json") : null;
  let document;
  try {
    document = await collectCatalog(fetchImpl);
    document.fetched_at = fetchedAt;
  } catch (error) {
    document = {
      error: `CelesTrak 위성 묶음 요청 실패: ${errorMessage(error)}`,
      groups: {},
      items: [],
    };
    console.error(document.error);
  }

  if (preservePrevious) {
    const merged = mergeCatalogWithPrevious(document, previous);
    if (merged === previous && previous) {
      console.error("catalog.json 이전 성공본을 유지합니다.");
      return;
    }
    document = merged;
  }

  const text = serializeCatalog(document);
  if (Buffer.byteLength(text) > CATALOG_BYTE_BUDGET) {
    console.error(`catalog.json 용량이 ${CATALOG_BYTE_BUDGET}바이트를 넘습니다.`);
  }

  try {
    await writeFileImpl(new URL("catalog.json", dataDir), text);
  } catch (error) {
    console.error(`catalog.json 저장 실패: ${errorMessage(error)}`);
  }
}

async function saveSource({
  label,
  filename,
  url,
  parse,
  fetchImpl,
  writeFileImpl,
  readFileImpl,
  dataDir,
  fetchedAt,
  preservePrevious,
}) {
  let document;
  let failed = false;
  try {
    document = {
      fetched_at: fetchedAt,
      items: parse(await requestJson(url, fetchImpl)),
    };
  } catch (error) {
    failed = true;
    document = failureDocument(label, error);
    console.error(document.error);
  }

  if (failed && preservePrevious) {
    const previous = await readExistingDocument(readFileImpl, dataDir, filename);
    if (isSuccessDocument(previous)) {
      console.error(`${filename} 이전 성공본을 유지합니다.`);
      return;
    }
  }

  try {
    await writeDocument(writeFileImpl, dataDir, filename, document);
  } catch (error) {
    console.error(`${filename} 저장 실패: ${errorMessage(error)}`);
  }
}

async function saveMirrorFile({ filename, fetchImpl, writeFileImpl, readFileImpl, dataDir }) {
  try {
    const payload = await requestJson(mirrorFileUrl(filename), fetchImpl);
    if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
      throw new Error("응답이 JSON 객체가 아닙니다.");
    }
    await writeDocument(writeFileImpl, dataDir, filename, payload);
  } catch (error) {
    const previous = await readExistingDocument(readFileImpl, dataDir, filename);
    if (previous) {
      console.error(`${filename} 미러를 받지 못해 저장소 파일을 유지합니다: ${errorMessage(error)}`);
      return;
    }
    console.error(`${filename} 미러와 저장소 파일이 모두 없습니다: ${errorMessage(error)}`);
  }
}

async function collectMirror(options) {
  const fetchImpl = options.fetchImpl ?? globalThis.fetch;
  const dataDir = options.dataDir ?? defaultDataDirectory();
  const writeFileImpl = options.writeFileImpl ?? writeFile;
  const readFileImpl = options.readFileImpl ?? readFile;
  const mkdirImpl = options.mkdirImpl ?? mkdir;

  await mkdirImpl(dataDir, { recursive: true });
  await Promise.all(
    DATA_FILES.map((filename) =>
      saveMirrorFile({ filename, fetchImpl, writeFileImpl, readFileImpl, dataDir }),
    ),
  );
}

export async function collectData(options = {}) {
  const mode = options.mode ?? "upstream";
  if (mode === "mirror") {
    await collectMirror(options);
    return;
  }

  const fetchImpl = options.fetchImpl ?? globalThis.fetch;
  const now = options.now ?? (() => new Date());
  const dataDir = options.dataDir ?? defaultDataDirectory();
  const writeFileImpl = options.writeFileImpl ?? writeFile;
  const readFileImpl = options.readFileImpl ?? readFile;
  const mkdirImpl = options.mkdirImpl ?? mkdir;
  const preservePrevious = mode === "refresh";

  await mkdirImpl(dataDir, { recursive: true });
  const fetchedAt = now().toISOString();

  await Promise.all([
    saveSource({
      label: "CelesTrak",
      filename: "tle.json",
      url: CELESTRAK_STATIONS_URL,
      parse: parseStationItems,
      fetchImpl,
      writeFileImpl,
      readFileImpl,
      dataDir,
      fetchedAt,
      preservePrevious,
    }),
    saveSource({
      label: "Launch Library 2",
      filename: "launches.json",
      url: LAUNCH_LIBRARY_UPCOMING_URL,
      parse: parseLaunchItems,
      fetchImpl,
      writeFileImpl,
      readFileImpl,
      dataDir,
      fetchedAt,
      preservePrevious,
    }),
    saveCatalog({ fetchImpl, writeFileImpl, readFileImpl, dataDir, fetchedAt, preservePrevious }),
  ]);
}

export async function runFetchData(options = {}) {
  try {
    await collectData(options);
  } catch (error) {
    console.error(errorMessage(error));
  }
  return 0;
}

function isDirectRun() {
  const entry = process.argv[1];
  if (!entry) {
    return false;
  }
  return import.meta.url === pathToFileURL(entry).href;
}

if (isDirectRun()) {
  process.exitCode = await runFetchData({ mode: fetchModeFromEnv(process.env) });
}
