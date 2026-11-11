import { describe, expect, it } from "vitest";
import {
  METEOR_SHOWERS,
  formatMeteorDday,
  meteorPeakLabel,
  nextMeteorShower,
} from "../src/meteors";

/** 한국표준시 달력의 정오. 날짜 경계 테스트는 시각을 따로 준다. */
function kstNoon(year: number, month: number, day: number): Date {
  return new Date(Date.UTC(year, month - 1, day, 3, 0, 0));
}

describe("meteor shower table", () => {
  it("keeps the IMO 2026 major-shower peak dates", () => {
    expect(METEOR_SHOWERS.map((shower) => [shower.id, shower.month, shower.day, shower.zhr])).toEqual([
      ["qua", 1, 3, 80],
      ["lyr", 4, 22, 18],
      ["eta", 5, 6, 50],
      ["sda", 7, 31, 25],
      ["per", 8, 13, 100],
      ["ori", 10, 21, 20],
      ["leo", 11, 17, 15],
      ["gem", 12, 14, 150],
      ["urs", 12, 22, 10],
    ]);
    expect(METEOR_SHOWERS.every((shower) => shower.zhr >= 10)).toBe(true);
  });
});

describe("next meteor shower", () => {
  it("counts calendar days until the next peak in KST", () => {
    expect(nextMeteorShower(kstNoon(2026, 1, 1))).toMatchObject({
      shower: { id: "qua" },
      peakDate: "2026-01-03",
      daysUntil: 2,
    });
    expect(nextMeteorShower(kstNoon(2026, 1, 4))).toMatchObject({
      shower: { id: "lyr" },
      peakDate: "2026-04-22",
      daysUntil: 108,
    });
    expect(nextMeteorShower(kstNoon(2026, 5, 7))).toMatchObject({
      shower: { id: "sda" },
      peakDate: "2026-07-31",
      daysUntil: 85,
    });
    expect(nextMeteorShower(kstNoon(2026, 8, 1))).toMatchObject({
      shower: { id: "per" },
      peakDate: "2026-08-13",
      daysUntil: 12,
    });
    expect(nextMeteorShower(kstNoon(2026, 8, 14))).toMatchObject({
      shower: { id: "ori" },
      peakDate: "2026-10-21",
      daysUntil: 68,
    });
    expect(nextMeteorShower(kstNoon(2026, 10, 22))).toMatchObject({
      shower: { id: "leo" },
      peakDate: "2026-11-17",
      daysUntil: 26,
    });
    expect(nextMeteorShower(kstNoon(2026, 11, 12))).toMatchObject({
      shower: { id: "leo", name: "사자자리 유성우" },
      peakDate: "2026-11-17",
      daysUntil: 5,
    });
    expect(nextMeteorShower(kstNoon(2026, 11, 18))).toMatchObject({
      shower: { id: "gem" },
      peakDate: "2026-12-14",
      daysUntil: 26,
    });
    expect(nextMeteorShower(kstNoon(2026, 12, 15))).toMatchObject({
      shower: { id: "urs" },
      peakDate: "2026-12-22",
      daysUntil: 7,
    });
  });

  it("treats the peak date itself as D-Day and rolls to next year after the last shower", () => {
    expect(nextMeteorShower(kstNoon(2026, 1, 3)).daysUntil).toBe(0);
    expect(nextMeteorShower(kstNoon(2026, 11, 17))).toMatchObject({
      shower: { id: "leo" },
      peakDate: "2026-11-17",
      daysUntil: 0,
    });
    expect(nextMeteorShower(kstNoon(2026, 12, 22))).toMatchObject({
      shower: { id: "urs" },
      daysUntil: 0,
    });
    expect(nextMeteorShower(kstNoon(2026, 12, 23))).toMatchObject({
      shower: { id: "qua" },
      peakDate: "2027-01-03",
      daysUntil: 11,
    });
    expect(nextMeteorShower(kstNoon(2027, 4, 22))).toMatchObject({
      shower: { id: "lyr" },
      peakDate: "2027-04-22",
      daysUntil: 0,
    });
  });

  it("uses the Korean calendar date around midnight", () => {
    expect(nextMeteorShower(new Date("2026-11-16T14:59:59.000Z"))).toMatchObject({
      shower: { id: "leo" },
      peakDate: "2026-11-17",
      daysUntil: 1,
    });
    expect(nextMeteorShower(new Date("2026-11-16T15:00:00.000Z"))).toMatchObject({
      shower: { id: "leo" },
      peakDate: "2026-11-17",
      daysUntil: 0,
    });
  });

  it("counts February 29 when the year is a leap year", () => {
    expect(nextMeteorShower(kstNoon(2026, 2, 28))).toMatchObject({
      shower: { id: "lyr" },
      peakDate: "2026-04-22",
      daysUntil: 53,
    });
    expect(nextMeteorShower(kstNoon(2028, 2, 28))).toMatchObject({
      shower: { id: "lyr" },
      peakDate: "2028-04-22",
      daysUntil: 54,
    });
  });

  it("rejects an invalid instant", () => {
    expect(() => nextMeteorShower(new Date(Number.NaN))).toThrow(RangeError);
  });
});

describe("meteor labels", () => {
  it("formats the peak line and the D-day", () => {
    expect(meteorPeakLabel("사자자리 유성우")).toBe("사자자리 유성우 극대");
    expect(formatMeteorDday(0)).toBe("D-Day");
    expect(formatMeteorDday(5)).toBe("D-5");
    expect(() => formatMeteorDday(-1)).toThrow(RangeError);
    expect(() => formatMeteorDday(1.5)).toThrow(RangeError);
  });
});
