// Helpers for airport-local "YYYY-MM-DDTHH:mm:ss" strings (no offset).
// The trailing "Z" below is ONLY a trick to use Date as a calendar calculator — the values are
// wall-clock times and no timezone conversion ever happens.

export function addMinutesLocal(local: string, minutes: number): string {
  const ms = Date.parse(`${local}Z`) + minutes * 60_000;
  return new Date(ms).toISOString().slice(0, 19);
}

/** Normalize "2026-12-01T10:05" or "2026-12-01T10:05:00.000" to "2026-12-01T10:05:00". */
export function normalizeLocal(local: string): string {
  const base = local.slice(0, 19);
  return base.length === 16 ? `${base}:00` : base;
}
