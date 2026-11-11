import { kstDayStart } from "./sky";

/**
 * 한국표준시는 UTC+9이고 서머타임을 쓰지 않는다.
 * 극대일 비교는 이 달력 날짜로 한다.
 */
const KST_OFFSET_MS = 9 * 60 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * 주요 유성우 극대일.
 * 출처: International Meteor Organization, 2026 Meteor Shower Calendar,
 * Table 5 Working List of Visual Meteor Showers (2025년 6월 기준, 극대일은 2026년).
 * https://www.imo.net/files/meteor-shower/cal2026.pdf
 *
 * 밤하늘에서 맨눈으로 보는 주요 유성우만 담았다.
 * 조건은 표의 ZHR이 10 이상이고, 극대일이 실제 최대인 유성우다.
 * 낮 유성우와, 극대일이 복사점 기준일뿐인 고물자리-돛자리(Puppid-Velids)는 빼었다.
 * 표의 월·일을 매년 같은 날로 쓴다. 태양 황경 기준 극대는 해마다 하루 정도 달라질 수 있다.
 */
export const METEOR_SHOWERS = [
  { id: "qua", name: "사분의자리 유성우", month: 1, day: 3, zhr: 80 },
  { id: "lyr", name: "거문고자리 유성우", month: 4, day: 22, zhr: 18 },
  { id: "eta", name: "물병자리 에타 유성우", month: 5, day: 6, zhr: 50 },
  { id: "sda", name: "남쪽 물병자리 델타 유성우", month: 7, day: 31, zhr: 25 },
  { id: "per", name: "페르세우스자리 유성우", month: 8, day: 13, zhr: 100 },
  { id: "ori", name: "오리온자리 유성우", month: 10, day: 21, zhr: 20 },
  { id: "leo", name: "사자자리 유성우", month: 11, day: 17, zhr: 15 },
  { id: "gem", name: "쌍둥이자리 유성우", month: 12, day: 14, zhr: 150 },
  { id: "urs", name: "작은곰자리 유성우", month: 12, day: 22, zhr: 10 },
] as const;

export type MeteorShower = (typeof METEOR_SHOWERS)[number];

export type NextMeteorShower = {
  shower: MeteorShower;
  /** 다가오는 극대의 한국 달력 날짜. `YYYY-MM-DD`. */
  peakDate: string;
  /** 오늘(한국 날짜)부터 극대일까지 남은 날. 0이면 오늘이 극대일이다. */
  daysUntil: number;
};

function kstCalendar(date: Date): { year: number; month: number; day: number } {
  const shifted = new Date(kstDayStart(date).getTime() + KST_OFFSET_MS);
  return {
    year: shifted.getUTCFullYear(),
    month: shifted.getUTCMonth() + 1,
    day: shifted.getUTCDate(),
  };
}

function calendarDayNumber(year: number, month: number, day: number): number {
  return Math.round(Date.UTC(year, month - 1, day) / DAY_MS);
}

function formatIsoDate(year: number, month: number, day: number): string {
  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

/** 화면의 극대 한 줄. 목업의 "사자자리 유성우 극대"와 같은 형식. */
export function meteorPeakLabel(name: string): string {
  return `${name} 극대`;
}

/** 0일은 `D-Day`, 그 외는 `D-5`처럼 적는다. */
export function formatMeteorDday(daysUntil: number): string {
  if (!Number.isInteger(daysUntil) || daysUntil < 0) {
    throw new RangeError("D-day는 0 이상의 정수여야 합니다.");
  }
  return daysUntil === 0 ? "D-Day" : `D-${daysUntil}`;
}

/**
 * 한국 날짜 기준으로 아직 지나지 않은 가장 가까운 극대.
 * 극대일이 오늘이면 그 유성우를 고르고, 모두 지났으면 다음 해 첫 극대로 넘어간다.
 */
export function nextMeteorShower(date: Date): NextMeteorShower {
  if (Number.isNaN(date.getTime())) {
    throw new RangeError("시각이 올바르지 않습니다.");
  }

  const today = kstCalendar(date);
  const todayNumber = calendarDayNumber(today.year, today.month, today.day);
  let best: NextMeteorShower | null = null;

  for (const shower of METEOR_SHOWERS) {
    let year = today.year;
    let peakNumber = calendarDayNumber(year, shower.month, shower.day);
    if (peakNumber < todayNumber) {
      year += 1;
      peakNumber = calendarDayNumber(year, shower.month, shower.day);
    }
    const daysUntil = peakNumber - todayNumber;
    if (!best || daysUntil < best.daysUntil) {
      best = {
        shower,
        peakDate: formatIsoDate(year, shower.month, shower.day),
        daysUntil,
      };
    }
  }

  if (!best) {
    throw new Error("유성우 목록이 비어 있습니다.");
  }
  return best;
}
