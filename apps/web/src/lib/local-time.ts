// Helpers for airport-local "YYYY-MM-DDTHH:mm:ss" strings (no offset) and plain "YYYY-MM-DD" dates.
//
// RULE: these strings are wall-clock times at an airport. Never pass them to `new Date(str)` or
// format them with a timezone; the browser would treat them as local or UTC time and shift them.
// We read the digits by position. Where a calendar is needed (weekday names, adding days) we use
// Date.UTC(...) on the parsed parts and format with timeZone 'UTC', so no offset is ever applied.

import { LOCALE } from './messages';

const LOCAL = /^(\d{4})-(\d{2})-(\d{2})(?:T(\d{2}):(\d{2}))?/;
const DAY_MS = 86_400_000;

interface Parts {
  year: number;
  month: number; // 1-12
  day: number;
  hour: number;
  minute: number;
}

function parse(local: string): Parts {
  const m = LOCAL.exec(local);
  if (!m) throw new Error(`Not an airport-local date/time: "${local}"`);
  return {
    year: Number(m[1]),
    month: Number(m[2]),
    day: Number(m[3]),
    hour: Number(m[4] ?? 0),
    minute: Number(m[5] ?? 0),
  };
}

function utcDay({ year, month, day }: Parts): number {
  return Date.UTC(year, month - 1, day);
}

/** "2026-12-15T06:05:00" → "06:05" (24-hour, as printed on tickets). */
export function formatLocalTime(local: string): string {
  const { hour, minute } = parse(local);
  return `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`;
}

/** Hour of day 0–23 at the airport. */
export function localHour(local: string): number {
  return parse(local).hour;
}

const dateFormats = {
  short: { day: 'numeric', month: 'short', timeZone: 'UTC' },
  weekday: { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'UTC' },
  dow: { weekday: 'short', timeZone: 'UTC' },
} satisfies Record<string, Intl.DateTimeFormatOptions>;

/** "2026-12-15T06:05:00" or "2026-12-15" → "15 Dec" / "Tue, 15 Dec" / "Tue". */
export function formatLocalDate(local: string, style: keyof typeof dateFormats = 'short'): string {
  return new Intl.DateTimeFormat(LOCALE, dateFormats[style]).format(utcDay(parse(local)));
}

/** Calendar days from `from` to `to` by their date parts: 23:30 → 06:10 next day = 1. */
export function dayDiff(from: string, to: string): number {
  return Math.round((utcDay(parse(to)) - utcDay(parse(from))) / DAY_MS);
}

/**
 * Minutes from `from` to `to`. ONLY valid when both are local times at the SAME airport (e.g. a
 * connection: arrival of one segment → departure of the next). Across airports use durationMinutes.
 */
export function minutesBetweenSameAirport(from: string, to: string): number {
  const a = parse(from);
  const b = parse(to);
  return Math.round(
    (Date.UTC(b.year, b.month - 1, b.day, b.hour, b.minute) -
      Date.UTC(a.year, a.month - 1, a.day, a.hour, a.minute)) /
      60_000,
  );
}

/** "2026-12-31" + 1 → "2027-01-01". */
export function addDays(isoDate: string, days: number): string {
  return new Date(utcDay(parse(isoDate)) + days * DAY_MS).toISOString().slice(0, 10);
}

// Calendar widget bridge: react-day-picker works with Date objects at LOCAL midnight of the
// viewer's device. Convert by parts (never toISOString, which would shift to UTC).

/** "2026-12-15" → Date at local midnight of that day. */
export function isoToPickerDate(isoDate: string): Date {
  const { year, month, day } = parse(isoDate);
  return new Date(year, month - 1, day);
}

/** Picker Date → "2026-12-15" from its local calendar parts. */
export function pickerDateToIso(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}
