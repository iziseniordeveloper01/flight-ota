// Day / month / year selects ⇄ ISO "YYYY-MM-DD". Three selects beat a calendar for birth and expiry
// dates on phones (no paging through decades). Pure calendar maths, no Date parsing of strings.

export interface DateParts {
  day: string;
  month: string;
  year: string;
}

const pad = (n: number) => String(n).padStart(2, '0');

export function daysInMonth(year: number, month: number): number {
  // Day 0 of the next month = last day of this one (UTC, so no timezone can shift it).
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

/** "" until all three parts form a real date (31 April, 29 Feb 2027 → ""). */
export function partsToIsoDate({ day, month, year }: DateParts): string {
  const d = Number(day);
  const m = Number(month);
  const y = Number(year);
  if (!Number.isInteger(d) || !Number.isInteger(m) || !Number.isInteger(y) || !day || !month || !year) return '';
  if (m < 1 || m > 12 || d < 1 || y < 1000 || d > daysInMonth(y, m)) return '';
  return `${y}-${pad(m)}-${pad(d)}`;
}

export function isoDateToParts(iso: string | null | undefined): DateParts {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso ?? '');
  if (!m) return { day: '', month: '', year: '' };
  return { year: m[1], month: String(Number(m[2])), day: String(Number(m[3])) };
}

/** Inclusive, newest first (birth dates) or oldest first (expiry dates). */
export function yearOptions(from: number, to: number): number[] {
  const step = from <= to ? 1 : -1;
  const years: number[] = [];
  for (let y = from; step > 0 ? y <= to : y >= to; y += step) years.push(y);
  return years;
}
