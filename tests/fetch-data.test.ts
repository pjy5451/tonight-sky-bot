import { describe, expect, it, vi } from "vitest";
import appSource from "../src/app.ts?raw";
import globeSource from "../src/globe-view.ts?raw";
import locationSource from "../src/location.ts?raw";
import mainSource from "../src/main.ts?raw";
import satelliteSource from "../src/satellites.ts?raw";
import stylesSource from "../src/styles.css?raw";
import indexHtml from "../index.html?raw";
import {
  CELESTRAK_STATIONS_URL,
  LAUNCH_LIBRARY_UPCOMING_URL,
  USER_AGENT,
  collectData,
  runFetchData,
  type FetchLike,
  type JsonResponse,
} from "../scripts/fetch-data.js";

const FETCHED_AT = "2026-11-10T21:00:00.000Z";

const station = {
  OBJECT_NAME: "ISS (ZARYA)",
  OBJECT_ID: "1998-067A",
  EPOCH: "2026-11-10T12:00:00.000000",
  MEAN_MOTION: 15.49,
  ECCENTRICITY: 0.0007,
  INCLINATION: 51.64,
  RA_OF_ASC_NODE: 12.3,
  ARG_OF_PERICENTER: 40.1,
  MEAN_ANOMALY: 20.2,
  NORAD_CAT_ID: 25544,
  BSTAR: 0.0001,
};

const launch = {
  id: "launch-1",
  name: "Falcon 9 Block 5 | Test Flight",
  net: "2026-11-11T02:49:00Z",
  status: { name: "Go for Launch" },
  launch_service_provider: { name: "SpaceX" },
  rocket: {
    configuration: {
      name: "Falcon 9",
      full_name: "Falcon 9 Block 5",
    },
  },
  pad: {
    name: "Space Launch Complex 4E",
    location: { name: "Vandenberg SFB, CA, USA" },
  },
  mission: {
    description: "This long description must stay out of the saved file.",
    vid_urls: [
      { url: "https://www.youtube.com/watch?v=abc123" },
      { url: "javascript:alert(1)" },
      "https://www.youtube.com/watch?v=abc123",
    ],
  },
  vidURLs: [{ url: "http://example.com/live" }],
};

function jsonResponse(body: unknown, status = 200): JsonResponse {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  };
}

function createOutput() {
  const files = new Map<string, string>();
  return {
    files,
    dataDir: new URL("file:///tmp/argonova-data/"),
    async writeFile(path: URL, contents: string) {
      files.set(path.pathname.split("/").pop() ?? path.href, contents);
    },
    async mkdir() {},
  };
}

function readSaved(files: Map<string, string>, name: string) {
  const raw = files.get(name);
  expect(raw?.endsWith("\n")).toBe(true);
  return JSON.parse(raw ?? "") as {
    fetched_at?: string;
    error?: string;
    items: unknown[];
  };
}

function mockFetch(payloads: { stations: unknown; launches: unknown }): FetchLike {
  const calls: Array<{ url: string; init?: RequestInit }> = [];
  const fetchImpl: FetchLike = async (url, init) => {
    calls.push({ url, init });
    if (url === CELESTRAK_STATIONS_URL) {
      return jsonResponse(payloads.stations);
    }
    if (url === LAUNCH_LIBRARY_UPCOMING_URL) {
      return jsonResponse(payloads.launches);
    }
    throw new Error(`unexpected url ${url}`);
  };
  return Object.assign(fetchImpl, { calls });
}

async function collectWith(
  fetchImpl: FetchLike,
  output = createOutput(),
  now: () => Date = () => new Date(FETCHED_AT),
) {
  await collectData({
    fetchImpl,
    now,
    dataDir: output.dataDir,
    writeFileImpl: output.writeFile,
    mkdirImpl: output.mkdir,
  });
  return output.files;
}

describe("fetch-data", () => {
  it("writes stations and the next 20 launches with fetched_at", async () => {
    const extraLaunches = Array.from({ length: 20 }, (_, index) => ({
      id: `extra-${index}`,
      name: `Extra ${index}`,
      net: `2026-12-${String(index + 1).padStart(2, "0")}T00:00:00Z`,
      rocket: { configuration: { name: "Rocket" } },
      mission: { description: "hidden" },
    }));
    const fetchImpl = mockFetch({
      stations: [station],
      launches: { count: 21, results: [launch, ...extraLaunches] },
    });

    const files = await collectWith(fetchImpl);
    const calls = (fetchImpl as FetchLike & { calls: Array<{ url: string; init?: RequestInit }> }).calls;

    expect(CELESTRAK_STATIONS_URL).toContain("GROUP=stations");
    expect(CELESTRAK_STATIONS_URL).toContain("FORMAT=json");
    expect(LAUNCH_LIBRARY_UPCOMING_URL).toContain("limit=20");
    expect(LAUNCH_LIBRARY_UPCOMING_URL).toContain("mode=detailed");
    expect(calls.map((call) => call.url).sort()).toEqual(
      [CELESTRAK_STATIONS_URL, LAUNCH_LIBRARY_UPCOMING_URL].sort(),
    );
    for (const call of calls) {
      expect(call.init?.headers).toMatchObject({
        accept: "application/json",
        "user-agent": USER_AGENT,
      });
      expect(call.init?.signal).toBeInstanceOf(AbortSignal);
    }

    const tle = readSaved(files, "tle.json");
    const launches = readSaved(files, "launches.json");

    expect(Object.keys(tle)).toEqual(["fetched_at", "items"]);
    expect(tle.fetched_at).toBe(FETCHED_AT);
    expect(tle.items).toEqual([station]);

    expect(launches.fetched_at).toBe(FETCHED_AT);
    expect(launches.items).toHaveLength(20);
    expect(launches.items[0]).toEqual({
      id: "launch-1",
      name: "Falcon 9 Block 5 | Test Flight",
      net: "2026-11-11T02:49:00Z",
      status: "Go for Launch",
      provider: "SpaceX",
      rocket: "Falcon 9 Block 5",
      pad: "Space Launch Complex 4E",
      location: "Vandenberg SFB, CA, USA",
      webcast_urls: ["http://example.com/live", "https://www.youtube.com/watch?v=abc123"],
    });
    expect(JSON.stringify(launches)).not.toContain("long description");
    expect(JSON.stringify(launches)).not.toContain("javascript:");
    expect(launches.items[19]).toMatchObject({ id: "extra-18" });
  });

  it("writes an error document and still finishes when a request fails", async () => {
    const fetchImpl: FetchLike = async (url) => {
      if (url === CELESTRAK_STATIONS_URL) {
        return jsonResponse({ error: "unavailable" }, 503);
      }
      if (url === LAUNCH_LIBRARY_UPCOMING_URL) {
        throw new Error("network down");
      }
      throw new Error(`unexpected url ${url}`);
    };
    const output = createOutput();
    const errorLog = vi.spyOn(console, "error").mockImplementation(() => {});

    const exitCode = await runFetchData({
      fetchImpl,
      now: () => new Date(FETCHED_AT),
      dataDir: output.dataDir,
      writeFileImpl: output.writeFile,
      mkdirImpl: output.mkdir,
    });

    const tle = readSaved(output.files, "tle.json");
    const launches = readSaved(output.files, "launches.json");

    expect(exitCode).toBe(0);
    expect(Object.keys(tle)).toEqual(["error", "items"]);
    expect(tle).toEqual({
      error: "CelesTrak 요청 실패: HTTP 503",
      items: [],
    });
    expect(launches).toEqual({
      error: "Launch Library 2 요청 실패: network down",
      items: [],
    });
    expect(tle.fetched_at).toBeUndefined();

    errorLog.mockRestore();
  });

  it("keeps a successful file when the other source fails", async () => {
    const fetchImpl: FetchLike = async (url) => {
      if (url === CELESTRAK_STATIONS_URL) {
        return jsonResponse([station]);
      }
      if (url === LAUNCH_LIBRARY_UPCOMING_URL) {
        return jsonResponse({ count: 0 }, 200);
      }
      throw new Error(`unexpected url ${url}`);
    };

    const files = await collectWith(fetchImpl);

    expect(readSaved(files, "tle.json").items).toEqual([station]);
    expect(readSaved(files, "launches.json")).toEqual({
      error: "Launch Library 2 요청 실패: 응답에 발사 목록이 없습니다.",
      items: [],
    });
  });

  it("rejects a station list that is not GP JSON", async () => {
    const files = await collectWith(
      mockFetch({
        stations: { OBJECT_NAME: "ISS (ZARYA)" },
        launches: { results: [] },
      }),
    );

    expect(readSaved(files, "tle.json")).toEqual({
      error: "CelesTrak 요청 실패: 응답이 위성 목록이 아닙니다.",
      items: [],
    });
    expect(readSaved(files, "launches.json")).toEqual({
      fetched_at: FETCHED_AT,
      items: [],
    });
  });

  it("rejects a station record missing orbital elements", async () => {
    const files = await collectWith(
      mockFetch({
        stations: [{ ...station, MEAN_MOTION: "15.49" }],
        launches: { results: [] },
      }),
    );

    expect(readSaved(files, "tle.json").error).toBe(
      "CelesTrak 요청 실패: 위성 항목에 MEAN_MOTION 값이 없습니다.",
    );
  });

  it("returns 0 when the data directory cannot be created", async () => {
    const errorLog = vi.spyOn(console, "error").mockImplementation(() => {});

    const exitCode = await runFetchData({
      fetchImpl: vi.fn(),
      mkdirImpl: async () => {
        throw new Error("disk full");
      },
    });

    expect(exitCode).toBe(0);
    errorLog.mockRestore();
  });

  it("does not call CelesTrak or Launch Library from browser source", () => {
    const browserSource = [
      indexHtml,
      appSource,
      mainSource,
      locationSource,
      globeSource,
      satelliteSource,
      stylesSource,
    ].join("\n");

    expect(browserSource).not.toContain("celestrak.org");
    expect(browserSource).not.toContain("thespacedevs.com");
    expect(browserSource).not.toContain("innerHTML");
    expect(browserSource).not.toContain("unpkg.com");
    expect(globeSource).toContain("textures/earth.png");
    expect(globeSource).not.toMatch(/https?:\/\//);
  });
});
