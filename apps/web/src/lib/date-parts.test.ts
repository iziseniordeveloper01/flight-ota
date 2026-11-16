import { daysInMonth, isoDateToParts, partsToIsoDate, yearOptions } from './date-parts';

describe('date selects → ISO date', () => {
  it('pads day and month', () => {
    expect(partsToIsoDate({ day: '5', month: '3', year: '1990' })).toBe('1990-03-05');
    expect(partsToIsoDate({ day: '31', month: '12', year: '2030' })).toBe('2030-12-31');
  });

  it('is empty until complete, and for days that do not exist', () => {
    expect(partsToIsoDate({ day: '', month: '3', year: '1990' })).toBe('');
    expect(partsToIsoDate({ day: '31', month: '4', year: '1990' })).toBe('');
    expect(partsToIsoDate({ day: '29', month: '2', year: '2027' })).toBe('');
    expect(partsToIsoDate({ day: '29', month: '2', year: '2028' })).toBe('2028-02-29');
  });

  it('round-trips through parts (no timezone shift: tests run in America/Los_Angeles)', () => {
    expect(isoDateToParts('2001-01-01')).toEqual({ day: '1', month: '1', year: '2001' });
    expect(partsToIsoDate(isoDateToParts('2001-01-01'))).toBe('2001-01-01');
    expect(isoDateToParts(null)).toEqual({ day: '', month: '', year: '' });
  });

  it('knows month lengths and builds year ranges both ways', () => {
    expect([daysInMonth(2028, 2), daysInMonth(2027, 2), daysInMonth(2026, 4)]).toEqual([29, 28, 30]);
    expect(yearOptions(2026, 2024)).toEqual([2026, 2025, 2024]);
    expect(yearOptions(2026, 2028)).toEqual([2026, 2027, 2028]);
  });
});
