import { describe, expect, it } from "vitest";
import {
  MAJOR_METEOR_SHOWERS,
  formatMeteorDday,
  nextMeteorShower,
} from "../src/meteors";

/** 한국 표준시 달력의 그 날짜 00:00. */
function kstMidnight(year: number, month: number, day: number): Date {
  return new Date(Date.UTC(year, month - 1, day) - 9 * 60 * 60 * 1000);
}

describe("major meteor shower table", () => {
  it("uses the IMO 2026 calendar maximum dates for the bright annual showers", () => {
    expect(MAJOR_METEOR_SHOWERS.map((shower) => [shower.id, shower.month, shower.day])).toEqual([
      ["qua", 1, 3],
      ["lyr", 4, 22],
      ["eta", 5, 6],
      ["sda", 7, 31],
      ["per", 8, 13],
      ["ori", 10, 21],
      ["leo", 11, 17],
      ["gem", 12, 14],
      ["urs", 12, 22],
    ]);
  });
});

describe("next meteor shower", () => {
  it("counts D-day to the Leonids on the sample night of 12 November", () => {
    const next = nextMeteorShower(new Date("2026-11-12T03:00:00.000Z"));
    expect(next.id).toBe("leo");
    expect(next.peakLabel).toBe("사자자리 유성우 극대");
    expect(next).toMatchObject({ year: 2026, month: 11, day: 17, daysUntil: 5 });
    expect(formatMeteorDday(next.daysUntil)).toBe("D-5");
  });

  it("keeps the peak shower through the whole KST calendar day", () => {
    expect(nextMeteorShower(new Date("2026-11-16T14:59:00.000Z")).daysUntil).toBe(1);
    expect(nextMeteorShower(kstMidnight(2026, 11, 17))).toMatchObject({
      id: "leo",
      daysUntil: 0,
    });
    expect(formatMeteorDday(0)).toBe("D-Day");
    expect(nextMeteorShower(new Date("2026-11-17T14:59:00.000Z"))).toMatchObject({
      id: "leo",
      daysUntil: 0,
    });
    expect(nextMeteorShower(new Date("2026-11-17T15:00:00.000Z"))).toMatchObject({
      id: "gem",
      peakLabel: "쌍둥이자리 유성우 극대",
      year: 2026,
      month: 12,
      day: 14,
      daysUntil: 26,
    });
  });

  it("wraps from the Ursids to the next year's Quadrantids", () => {
    expect(nextMeteorShower(kstMidnight(2026, 12, 22))).toMatchObject({
      id: "urs",
      daysUntil: 0,
    });
    expect(nextMeteorShower(kstMidnight(2026, 12, 23))).toMatchObject({
      id: "qua",
      peakLabel: "사분의자리 유성우 극대",
      year: 2027,
      month: 1,
      day: 3,
      daysUntil: 11,
    });
    expect(nextMeteorShower(kstMidnight(2026, 12, 31))).toMatchObject({
      id: "qua",
      year: 2027,
      daysUntil: 3,
    });
    expect(nextMeteorShower(kstMidnight(2027, 1, 3))).toMatchObject({
      id: "qua",
      year: 2027,
      daysUntil: 0,
    });
  });

  it("includes 29 February when the wait crosses a leap day", () => {
    expect(nextMeteorShower(kstMidnight(2027, 2, 28))).toMatchObject({
      id: "lyr",
      year: 2027,
      daysUntil: 53,
    });
    expect(nextMeteorShower(kstMidnight(2028, 2, 28))).toMatchObject({
      id: "lyr",
      year: 2028,
      daysUntil: 54,
    });
    expect(nextMeteorShower(kstMidnight(2028, 2, 29))).toMatchObject({
      id: "lyr",
      year: 2028,
      daysUntil: 53,
    });
  });

  it("names each shower on its own peak day", () => {
    const peaks = [
      ["qua", 2026, 1, 3],
      ["lyr", 2026, 4, 22],
      ["eta", 2026, 5, 6],
      ["sda", 2026, 7, 31],
      ["per", 2026, 8, 13],
      ["ori", 2026, 10, 21],
      ["leo", 2026, 11, 17],
      ["gem", 2026, 12, 14],
      ["urs", 2026, 12, 22],
    ] as const;

    for (const [id, year, month, day] of peaks) {
      expect(nextMeteorShower(kstMidnight(year, month, day)).id).toBe(id);
    }
  });

  it("rejects a date that is not a time", () => {
    expect(() => nextMeteorShower(new Date("not-a-date"))).toThrow(RangeError);
    expect(() => formatMeteorDday(-1)).toThrow(RangeError);
    expect(() => formatMeteorDday(1.5)).toThrow(RangeError);
  });
});
