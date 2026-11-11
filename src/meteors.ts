/**
 * 주요 유성우의 극대일.
 *
 * 출처: International Meteor Organization, 2026 Meteor Shower Calendar,
 * Table 5 "Working List of Visual Meteor Showers"
 * (2025년 6월까지 반영, 극대 날짜는 2026년용).
 * https://www.imo.net/files/meteor-shower/cal2026.pdf
 *
 * 표의 Maximum Date를 매년 같은 달·날로 반복한다. 시각은 표에 없고,
 * 같은 문서가 일부 극대는 태양황경 1°(약 하루)보다 정확히 알기 어렵다고 하므로
 * D-day는 그 달력 날짜를 한국 표준시 날짜로 보고 센다.
 * 밤하늘에서 맨눈으로 보는 유성우만 넣었다. 주간 유성우와,
 * 표가 극대가 아니라고 적은 날짜(Puppid-Velids)는 빼었다.
 */
const KST_OFFSET_MS = 9 * 60 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;

export type MeteorShower = {
  id: string;
  name: string;
  month: number;
  day: number;
};

export const MAJOR_METEOR_SHOWERS: readonly MeteorShower[] = [
  { id: "qua", name: "사분의자리 유성우", month: 1, day: 3 },
  { id: "lyr", name: "거문고자리 유성우", month: 4, day: 22 },
  { id: "eta", name: "물병자리 에타 유성우", month: 5, day: 6 },
  { id: "sda", name: "남쪽 물병자리 델타 유성우", month: 7, day: 31 },
  { id: "per", name: "페르세우스자리 유성우", month: 8, day: 13 },
  { id: "ori", name: "오리온자리 유성우", month: 10, day: 21 },
  { id: "leo", name: "사자자리 유성우", month: 11, day: 17 },
  { id: "gem", name: "쌍둥이자리 유성우", month: 12, day: 14 },
  { id: "urs", name: "작은곰자리 유성우", month: 12, day: 22 },
];

export type NextMeteorShower = {
  id: string;
  name: string;
  peakLabel: string;
  year: number;
  month: number;
  day: number;
  daysUntil: number;
};

function assertValidDate(date: Date): void {
  if (Number.isNaN(date.getTime())) {
    throw new RangeError("시각이 올바르지 않습니다.");
  }
}

export function kstCalendarParts(date: Date): { year: number; month: number; day: number } {
  assertValidDate(date);
  const shifted = new Date(date.getTime() + KST_OFFSET_MS);
  return {
    year: shifted.getUTCFullYear(),
    month: shifted.getUTCMonth() + 1,
    day: shifted.getUTCDate(),
  };
}

function calendarDayIndex(year: number, month: number, day: number): number {
  return Math.floor(Date.UTC(year, month - 1, day) / DAY_MS);
}

/** 한국 표준시 달력 기준. 당일은 D-Day, 미래는 D-N. */
export function formatMeteorDday(daysUntil: number): string {
  if (!Number.isInteger(daysUntil) || daysUntil < 0) {
    throw new RangeError("남은 날짜가 올바르지 않습니다.");
  }
  if (daysUntil === 0) {
    return "D-Day";
  }
  return `D-${daysUntil}`;
}

/**
 * 오늘(한국 날짜)이거나 그 다음으로 가까운 극대.
 * 같은 날 극대가 겹치면 표에서 앞에 있는 유성우를 고른다.
 */
export function nextMeteorShower(now: Date): NextMeteorShower {
  const today = kstCalendarParts(now);
  const todayIndex = calendarDayIndex(today.year, today.month, today.day);
  let best: NextMeteorShower | null = null;

  for (const shower of MAJOR_METEOR_SHOWERS) {
    for (const year of [today.year, today.year + 1]) {
      const daysUntil = calendarDayIndex(year, shower.month, shower.day) - todayIndex;
      if (daysUntil < 0) {
        continue;
      }
      if (best === null || daysUntil < best.daysUntil) {
        best = {
          id: shower.id,
          name: shower.name,
          peakLabel: `${shower.name} 극대`,
          year,
          month: shower.month,
          day: shower.day,
          daysUntil,
        };
      }
      break;
    }
  }

  if (!best) {
    throw new Error("다음 유성우를 찾지 못했습니다.");
  }
  return best;
}
