import { offer } from '@/test/fixtures';
import { isOperatedByOther, otherOperators } from './codeshare';

const AA = { code: 'AA', name: 'American Airlines' };
const IB = { code: 'IB', name: 'Iberia' };

describe('isOperatedByOther', () => {
  it('is true only when the operating carrier differs from the marketing carrier', () => {
    const own = offer().slices[0].segments[0];
    expect(isOperatedByOther(own)).toBe(false);
    expect(isOperatedByOther({ ...own, operatingCarrier: AA })).toBe(true);
  });

  it('compares names when a carrier has no IATA code', () => {
    const seg = offer().slices[0].segments[0];
    const noCode = { code: '', name: 'Mock Air One' };
    expect(isOperatedByOther({ ...seg, operatingCarrier: noCode })).toBe(false);
    expect(isOperatedByOther({ ...seg, operatingCarrier: { code: '', name: 'Other Air' } })).toBe(true);
  });
});

describe('otherOperators', () => {
  it('is empty when the owner flies every segment', () => {
    expect(otherOperators(offer({ slices: [{ via: ['DXB'] }, {}] }))).toEqual([]);
  });

  it('lists each other operator once, in journey order', () => {
    const o = offer({ slices: [{ via: ['DXB'], operatedBy: AA }, { operatedBy: IB }, { operatedBy: AA }] });
    expect(otherOperators(o)).toEqual(['American Airlines', 'Iberia']);
  });

  it('ignores segments operated by the owner even when another airline markets them', () => {
    const o = offer({ owner: 'AA', slices: [{ operatedBy: { code: 'AA', name: 'Airline AA' } }] });
    expect(otherOperators(o)).toEqual([]);
  });
});
