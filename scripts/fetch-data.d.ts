export const CELESTRAK_STATIONS_URL: string;
export const LAUNCH_LIBRARY_UPCOMING_URL: string;
export const USER_AGENT: string;
export const DATA_MIRROR_BASE: string;
export const DATA_FILES: readonly string[];

export type FetchMode = "upstream" | "refresh" | "mirror";

export function mirrorFileUrl(filename: string): string;
export function fetchModeFromEnv(env?: Record<string, string | undefined>): FetchMode;
export const CATALOG_BYTE_BUDGET: number;
export const CATALOG_GROUPS: readonly string[];
export const GROUP_COUNTRY: Record<string, string>;
export const KOREAN_NAME_QUERIES: readonly string[];
export const KOREAN_NORAD_IDS: readonly number[];
export const CATALOG_COLUMN: {
  name: number;
  norad: number;
  group: number;
  country: number;
  epoch: number;
  meanMotion: number;
  eccentricity: number;
  inclination: number;
  raan: number;
  argp: number;
  anomaly: number;
  bstar: number;
  meanMotionDot: number;
  korean: number;
};

export function celestrakGroupUrl(group: string): string;
export function celestrakNameUrl(name: string): string;
export function catalogRequestPlan(): Array<{ id: string; url: string; name?: string }>;

export interface JsonResponse {
  ok: boolean;
  status: number;
  json: () => Promise<unknown>;
}

export type FetchLike = (url: string, init?: RequestInit) => Promise<JsonResponse>;

export type DataWriter = (path: URL, contents: string) => Promise<void>;

export type DataDirectoryMaker = (path: URL, options?: { recursive?: boolean }) => Promise<void>;

export type DataReader = (path: URL, encoding?: string) => Promise<string>;

export interface CollectDataOptions {
  fetchImpl?: FetchLike;
  now?: () => Date;
  dataDir?: URL;
  writeFileImpl?: DataWriter;
  readFileImpl?: DataReader;
  mkdirImpl?: DataDirectoryMaker;
  mode?: FetchMode;
}

export function parseStationItems(payload: unknown): unknown[];

export function parseCatalogGroupItems(payload: unknown): unknown[];

export function compactGpItem(
  item: {
    OBJECT_NAME?: string;
    NORAD_CAT_ID?: number | string;
    EPOCH?: string;
    MEAN_MOTION?: number;
    ECCENTRICITY?: number;
    INCLINATION?: number;
    RA_OF_ASC_NODE?: number;
    ARG_OF_PERICENTER?: number;
    MEAN_ANOMALY?: number;
    BSTAR?: number;
    MEAN_MOTION_DOT?: number;
  },
  group: string,
  country: string,
  korean: boolean,
): unknown[];

export function serializeCatalog(document: unknown): string;

export function mergeCatalogWithPrevious<T>(next: T, previous: unknown): T;

export function collectCatalog(fetchImpl: FetchLike): Promise<{
  fetched_at?: string;
  error?: string;
  groups: Record<string, { ok: boolean; count?: number; error?: string; warnings?: string[] }>;
  items: unknown[][];
}>;

export function parseLaunchItems(payload: unknown): Array<{
  id: string | null;
  name: string | null;
  net: string | null;
  status: string | null;
  provider: string | null;
  rocket: string | null;
  pad: string | null;
  location: string | null;
  webcast_urls: string[];
}>;

export function collectData(options?: CollectDataOptions): Promise<void>;

export function runFetchData(options?: CollectDataOptions): Promise<0>;
