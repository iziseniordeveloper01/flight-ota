import { describe, expect, it } from 'vitest';
import { isoDurationToMinutes } from './iso-duration.js';

describe('isoDurationToMinutes', () => {
  it.each([
    ['PT2H30M', 150],
    ['PT45M', 45],
    ['PT7H', 420],
    ['P1DT2H5M', 1565],
    ['PT1H0M30S', 61], // seconds round to the nearest minute
    ['P0D', 0],
  ])('%s → %i', (input, minutes) => {
    expect(isoDurationToMinutes(input)).toBe(minutes);
  });

  it.each(['', 'P', 'PT', '2H30M', 'P1W', 'P1Y2M', 'PT2H30'])('rejects %j', (input) => {
    expect(() => isoDurationToMinutes(input)).toThrow();
  });
});
