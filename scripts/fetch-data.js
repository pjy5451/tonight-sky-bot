import { mkdir, writeFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";

// Build-time fetch only. The browser reads public/data JSON and does not call these APIs.
// A failed request still exits 0 so `npm run fetch-data && npm run build` can continue.

export const CELESTRAK_STATIONS_URL =
  "https://celestrak.org/NORAD/elements/gp.php?GROUP=stations&FORMAT=json";

// mode=detailed includes launch vid_urls. normal mode omits those livestream links.
export const LAUNCH_LIBRARY_UPCOMING_URL =
  "https://ll.thespacedevs.com/2.3.0/launches/upcoming/?limit=20&mode=detailed";

export const USER_AGENT = "Argonova/0.1 (tonight-sky-bot; +https://argonova.pages.dev)";

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

async function saveSource({ label, filename, url, parse, fetchImpl, writeFileImpl, dataDir, fetchedAt }) {
  let document;
  try {
    document = {
      fetched_at: fetchedAt,
      items: parse(await requestJson(url, fetchImpl)),
    };
  } catch (error) {
    document = failureDocument(label, error);
    console.error(document.error);
  }

  try {
    await writeDocument(writeFileImpl, dataDir, filename, document);
  } catch (error) {
    console.error(`${filename} 저장 실패: ${errorMessage(error)}`);
  }
}

export async function collectData(options = {}) {
  const fetchImpl = options.fetchImpl ?? globalThis.fetch;
  const now = options.now ?? (() => new Date());
  const dataDir = options.dataDir ?? defaultDataDirectory();
  const writeFileImpl = options.writeFileImpl ?? writeFile;
  const mkdirImpl = options.mkdirImpl ?? mkdir;

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
      dataDir,
      fetchedAt,
    }),
    saveSource({
      label: "Launch Library 2",
      filename: "launches.json",
      url: LAUNCH_LIBRARY_UPCOMING_URL,
      parse: parseLaunchItems,
      fetchImpl,
      writeFileImpl,
      dataDir,
      fetchedAt,
    }),
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
  process.exitCode = await runFetchData();
}
