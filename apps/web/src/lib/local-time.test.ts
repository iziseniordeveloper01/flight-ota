import {
  addDays,
  dayDiff,
  formatLocalDate,
  formatLocalTime,
  isoToPickerDate,
  localHour,
  minutesBetweenSameAirport,
  pickerDateToIso,
} from './local-time';

// vitest.config sets TZ=America/Los_Angeles (UTC-8): a naive `new Date(str)` would shift these.

describe('formatLocalTime', () => {
  it('reads the wall-clock time from the string, never shifting it', () => {
    expect(formatLocalTime('2026-12-15T06:05:00')).toBe('06:05');
    expect(formatLocalTime('2026-12-15T23:59:00')).toBe('23:59');
    expect(formatLocalTime('2026-12-15T00:00')).toBe('00:00');
  });

  it('rejects strings that are not airport-local times', () => {
    expect(() => formatLocalTime('15/12/2026')).toThrow();
  });
});

describe('formatLocalDate', () => {
  it('formats the date parts without timezone conversion', () => {
    // 23:30 local would be the next day in UTC; must still read 15 Dec.
    expect(formatLocalDate('2026-12-15T23:30:00')).toBe('15 Dec');
    // 00:30 local would be the previous day in Los Angeles; must still read 15 Dec.
    expect(formatLocalDate('2026-12-15T00:30:00')).toBe('15 Dec');
    expect(formatLocalDate('2026-12-15', 'weekday')).toBe('Tue, 15 Dec');
    expect(formatLocalDate('2026-12-15', 'dow')).toBe('Tue');
  });
});

describe('dayDiff (+1 day marker)', () => {
  it('is 0 for same-day arrival', () => {
    expect(dayDiff('2026-12-15T08:00:00', '2026-12-15T23:59:00')).toBe(0);
  });
  it('is 1 for an overnight flight', () => {
    expect(dayDiff('2026-12-15T23:30:00', '2026-12-16T06:10:00')).toBe(1);
  });
  it('handles month/year rollover and multi-day', () => {
    expect(dayDiff('2026-12-31T22:00:00', '2027-01-01T05:00:00')).toBe(1);
    expect(dayDiff('2026-12-30T22:00:00', '2027-01-01T05:00:00')).toBe(2);
  });
  it('is negative when crossing the date line westbound', () => {
    expect(dayDiff('2026-12-15T09:00:00', '2026-12-14T22:00:00')).toBe(-1);
  });
});

describe('other helpers', () => {
  it('localHour', () => {
    expect(localHour('2026-12-15T18:00:00')).toBe(18);
  });
  it('addDays across a leap day and year', () => {
    expect(addDays('2028-02-28', 1)).toBe('2028-02-29');
    expect(addDays('2026-12-31', 1)).toBe('2027-01-01');
    expect(addDays('2026-01-01', -1)).toBe('2025-12-31');
  });
  it('connection minutes at one airport', () => {
    expect(minutesBetweenSameAirport('2026-12-15T22:40:00', '2026-12-16T01:05:00')).toBe(145);
  });
  it('round-trips picker dates by local parts', () => {
    expect(pickerDateToIso(isoToPickerDate('2026-03-08'))).toBe('2026-03-08'); // US DST start
    expect(pickerDateToIso(isoToPickerDate('2026-11-01'))).toBe('2026-11-01'); // US DST end
  });
});
