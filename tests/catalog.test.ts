import { describe, expect, it } from "vitest";
import {
  GROUP_COLOR,
  countryMessageKey,
  defaultGlobeFilter,
  groupMessageKey,
  isSatelliteShown,
  toggleFilterGroup,
  toggleKoreaOnly,
} from "../src/catalog";
import { en, ko } from "../src/i18n";
import {
  HUBBLE_NORAD_CATALOG_ID,
  buildSatelliteScene,
  parseCatalogDocument,
} from "../src/satellites";
import stylesSource from "../src/styles.css?raw";
import { CATALOG_COLUMN, KOREAN_NORAD_IDS, compactGpItem } from "../scripts/fetch-data.js";

const EPOCH = "2026-11-11T04:58:00.000000";

function gp(name: string, norad: number) {
  return {
    OBJECT_NAME: name,
    OBJECT_ID: "SHOULD-NOT-SURVIVE",
    EPOCH,
    MEAN_MOTION: 15.06,
    ECCENTRICITY: 0.0002,
    INCLINATION: 53,
    RA_OF_ASC_NODE: 12,
    ARG_OF_PERICENTER: 40,
    MEAN_ANOMALY: 20,
    NORAD_CAT_ID: norad,
    BSTAR: 0.0001,
    MEAN_MOTION_DOT: 0.00001,
    REV_AT_EPOCH: 50,
  };
}

describe("satellite filters", () => {
  const starlink = { group: "starlink", korean: false };
  const geoKorea = { group: "geo", korean: true };
  const korea = { group: "korea", korean: true };
  const station = { group: "stations", korean: false };

  it("hides a group that is turned off and shows only Korean satellites in Korea-only mode", () => {
    const initial = defaultGlobeFilter();
    expect(isSatelliteShown(starlink, initial)).toBe(true);
    expect(isSatelliteShown(geoKorea, initial)).toBe(true);
    expect(isSatelliteShown(station, initial)).toBe(true);

    const withoutStarlink = toggleFilterGroup(initial, "starlink");
    expect(isSatelliteShown(starlink, withoutStarlink)).toBe(false);
    expect(isSatelliteShown(geoKorea, withoutStarlink)).toBe(true);
    expect(withoutStarlink.enabled["gps-ops"]).toBe(true);

    const restored = toggleFilterGroup(withoutStarlink, "starlink");
    expect(isSatelliteShown(starlink, restored)).toBe(true);

    const koreaOnly = toggleKoreaOnly(initial);
    expect(koreaOnly.koreaOnly).toBe(true);
    expect(isSatelliteShown(starlink, koreaOnly)).toBe(false);
    expect(isSatelliteShown(station, koreaOnly)).toBe(false);
    expect(isSatelliteShown(geoKorea, koreaOnly)).toBe(true);
    expect(isSatelliteShown(korea, koreaOnly)).toBe(true);

    const back = toggleKoreaOnly(koreaOnly);
    expect(isSatelliteShown(starlink, back)).toBe(true);
  });
});

describe("catalog document", () => {
  it("reads a compact row and draws Hubble as a model, other satellites as colored dots", () => {
    const hubble = compactGpItem(gp("HST", HUBBLE_NORAD_CATALOG_ID), "science", "", false);
    const starlink = compactGpItem(gp("STARLINK-1008", 44714), "starlink", "US", false);
    const loaded = parseCatalogDocument({
      fetched_at: "2026-11-11T12:00:00.000Z",
      items: [hubble, starlink, ["broken"]],
    });

    expect(loaded.error).toBeNull();
    expect(loaded.satellites).toHaveLength(2);
    expect(loaded.satellites[0]?.marker).toBe("model");
    expect(loaded.satellites[1]?.marker).toBe("dot");
    expect(loaded.satellites[1]?.country).toBe("US");
    expect(JSON.stringify(loaded.satellites[1]?.omm)).not.toContain("SHOULD-NOT-SURVIVE");

    const scene = buildSatelliteScene(loaded.satellites, new Date(EPOCH), { includeOrbit: false });
    const hubblePoint = scene.points.find((point) => point.noradId === HUBBLE_NORAD_CATALOG_ID);
    const starlinkPoint = scene.points.find((point) => point.noradId === 44714);
    expect(hubblePoint?.marker).toBe("model");
    expect(hubblePoint?.iss).toBe(false);
    expect(starlinkPoint?.marker).toBe("dot");
    expect(starlinkPoint?.color).toBe(GROUP_COLOR.starlink);
    expect(starlinkPoint?.velocity).toEqual({ x: 0, y: 0, z: 0 });
    expect(starlinkPoint?.name).toBe("STARLINK-1008");
    expect(starlinkPoint?.group).toBe("starlink");
    expect(typeof starlinkPoint?.altKm).toBe("number");
  });

  it("treats an empty file as no extra satellites and a failed file as an error", () => {
    expect(parseCatalogDocument({})).toEqual({ fetchedAt: null, satellites: [], error: null });
    expect(parseCatalogDocument({ error: "CelesTrak 위성 묶음 요청 실패", items: [] }).error).toBe("failed");
  });

  it("includes the Korean catalog numbers confirmed from CelesTrak", () => {
    expect(KOREAN_NORAD_IDS).toEqual(
      expect.arrayContaining([43823, 45246, 38338, 40536, 39227, 47932, 69013]),
    );
    expect(new Set(KOREAN_NORAD_IDS).size).toBe(KOREAN_NORAD_IDS.length);
    expect(CATALOG_COLUMN.korean).toBe(13);
    expect(groupMessageKey("starlink")).toBe("groupStarlink");
    expect(countryMessageKey("KR")).toBe("countryKR");
    expect(countryMessageKey("")).toBe("countryUnknown");
    expect(ko[groupMessageKey("korea")]).not.toBe(en[groupMessageKey("korea")]);
  });

  it("uses the category colors in the stylesheet", () => {
    for (const color of Object.values(GROUP_COLOR)) {
      expect(stylesSource.toLowerCase()).toContain(color.toLowerCase());
    }
  });
});
