// Business dates are plain "YYYY-MM-DD" strings. The bank's date only moves when end of day runs, so
// it is never read from the clock; all arithmetic is done in UTC to keep away from time zones.

const DAY = 86_400_000;

const parse = (d: string) => Date.UTC(Number(d.slice(0, 4)), Number(d.slice(5, 7)) - 1, Number(d.slice(8, 10)));
const fmt = (t: number) => new Date(t).toISOString().slice(0, 10);

export const addDays = (d: string, n: number) => fmt(parse(d) + n * DAY);
export const daysBetween = (from: string, to: string) => Math.round((parse(to) - parse(from)) / DAY);

/** Same day n months later, clamped to the month's end (31 Jan + 1 month = 28/29 Feb) */
export function addMonths(d: string, n: number) {
  const y = Number(d.slice(0, 4));
  const m = Number(d.slice(5, 7)) - 1 + n;
  const day = Number(d.slice(8, 10));
  const yy = y + Math.floor(m / 12);
  const mm = ((m % 12) + 12) % 12;
  const last = new Date(Date.UTC(yy, mm + 1, 0)).getUTCDate();
  return fmt(Date.UTC(yy, mm, Math.min(day, last)));
}

/** Whole months from one date to another (a month counts once its day is reached) */
export function monthsBetween(from: string, to: string) {
  let n = (Number(to.slice(0, 4)) - Number(from.slice(0, 4))) * 12 + Number(to.slice(5, 7)) - Number(from.slice(5, 7));
  if (addMonths(from, n) > to) n--;
  return Math.max(0, n);
}

export const isMonthEnd = (d: string) => addDays(d, 1).slice(8, 10) === "01";

/** Indian banks credit savings interest at the end of each quarter of the financial year */
export const isQuarterEnd = (d: string) => isMonthEnd(d) && ["03", "06", "09", "12"].includes(d.slice(5, 7));

/** The financial year (April to March) a date falls in, as "2026-27" */
export function financialYear(d: string) {
  const y = Number(d.slice(0, 4));
  const start = Number(d.slice(5, 7)) >= 4 ? y : y - 1;
  return `${start}-${String((start + 1) % 100).padStart(2, "0")}`;
}

export function ageOn(dob: string, on: string) {
  let age = Number(on.slice(0, 4)) - Number(dob.slice(0, 4));
  if (on.slice(5) < dob.slice(5)) age--;
  return age;
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
/** 31 Oct 2026 */
export const formatDate = (d: string) => (d ? `${Number(d.slice(8, 10))} ${MONTHS[Number(d.slice(5, 7)) - 1]} ${d.slice(0, 4)}` : "");

export function tenureLabel(days: number) {
  if (days < 30) return `${days} days`;
  const y = Math.floor(days / 365);
  const m = Math.round((days % 365) / 30.4);
  if (!y) return `${m} month${m === 1 ? "" : "s"}`;
  return m ? `${y}y ${m}m` : `${y} year${y === 1 ? "" : "s"}`;
}
