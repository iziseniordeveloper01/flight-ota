import { passengerLabels, searchUrlForOffer, stepPathFor } from './booking-steps';

const ID = '01936d7e-0000-7000-8000-000000000000';

describe('stepPathFor', () => {
  it.each([
    ['DRAFT', `/booking/${ID}`],
    ['EXPIRED', `/booking/${ID}`],
    ['PENDING_PAYMENT', `/booking/${ID}/review`],
    ['PAID', `/booking/${ID}/review`], // "confirming" screen
    ['CONFIRMING', `/booking/${ID}/review`],
    ['FAILED', `/booking/${ID}/review`], // refund message
    ['REFUND_PENDING', `/booking/${ID}/review`],
    ['REFUNDED', `/booking/${ID}/review`],
    ['CONFIRMED', `/booking/${ID}/complete`],
    ['CANCELLED', `/booking/${ID}/complete`],
  ] as const)('%s → %s', (status, path) => {
    expect(stepPathFor(ID, status)).toBe(path);
  });
});

describe('searchUrlForOffer / passengerLabels', () => {
  const seg = { cabin: 'business' };
  const offer = {
    slices: [
      { origin: 'DEL', destination: 'DXB', departureAt: '2026-12-15T06:00:00', segments: [seg] },
      { origin: 'DXB', destination: 'DEL', departureAt: '2026-12-22T23:30:00', segments: [seg] },
    ],
    passengers: [
      { ref: 'a1', type: 'adult' },
      { ref: 'a2', type: 'adult' },
      { ref: 'c1', type: 'child' },
      { ref: 'i1', type: 'infant' },
    ],
  } as never;

  it('rebuilds the results URL of the same trip', () => {
    expect(searchUrlForOffer(offer)).toBe(
      '/flights/search?from=DEL&to=DXB&depart=2026-12-15&return=2026-12-22&adults=2&children=1&infants=1&cabin=business',
    );
  });

  it('numbers passengers per type', () => {
    expect([...passengerLabels((offer as { passengers: never }).passengers).values()]).toEqual(['Adult 1', 'Adult 2', 'Child 1', 'Infant 1']);
  });
});
