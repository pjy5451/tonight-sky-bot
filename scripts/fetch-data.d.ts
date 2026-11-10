export const CELESTRAK_STATIONS_URL: string;
export const LAUNCH_LIBRARY_UPCOMING_URL: string;
export const USER_AGENT: string;

export interface JsonResponse {
  ok: boolean;
  status: number;
  json: () => Promise<unknown>;
}

export type FetchLike = (url: string, init?: RequestInit) => Promise<JsonResponse>;

export type DataWriter = (path: URL, contents: string) => Promise<void>;

export type DataDirectoryMaker = (path: URL, options?: { recursive?: boolean }) => Promise<void>;

export interface CollectDataOptions {
  fetchImpl?: FetchLike;
  now?: () => Date;
  dataDir?: URL;
  writeFileImpl?: DataWriter;
  mkdirImpl?: DataDirectoryMaker;
}

export function parseStationItems(payload: unknown): unknown[];

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
