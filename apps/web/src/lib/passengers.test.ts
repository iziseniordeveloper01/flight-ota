import { searchDateBounds, searchFlightsSchema } from '@ota/contracts';
import { stepPassengers, stepperState, totalTravellers, type PassengerField, type Passengers } from './passengers';

const start: Passengers = { adults: 1, children: 0, infants: 0 };

describe('stepper rules', () => {
  it('needs at least one adult', () => {
    expect(stepperState(start).adults.canRemove).toBe(false);
    expect(stepPassengers(start, 'adults', -1)).toEqual(start);
  });

  it('allows at most one infant per adult, with a hint', () => {
    const p = stepPassengers(start, 'infants', 1);
    expect(p.infants).toBe(1);
    const s = stepperState(p).infants;
    expect(s.canAdd).toBe(false);
    expect(s.limitHint).toMatch(/one infant per adult/i);
    expect(stepPassengers(p, 'infants', 1)).toEqual(p);
  });

  it('caps adults + children at 9', () => {
    const p = { adults: 5, children: 4, infants: 0 };
    const s = stepperState(p);
    expect(s.adults.canAdd).toBe(false);
    expect(s.children.canAdd).toBe(false);
    expect(s.children.limitHint).toMatch(/9/);
    expect(stepPassengers(p, 'children', 1)).toEqual(p);
  });

  it('removing an adult drops an infant who would lose their lap', () => {
    expect(stepPassengers({ adults: 2, children: 0, infants: 2 }, 'adults', -1)).toEqual({
      adults: 1,
      children: 0,
      infants: 1,
    });
  });

  it('counts all travellers', () => {
    expect(totalTravellers({ adults: 2, children: 1, infants: 1 })).toBe(4);
  });

  it('never produces a combination the shared schema rejects', () => {
    // Explore every state reachable by tapping, and validate each one with the API schema.
    const seen = new Set<string>();
    const queue: Passengers[] = [start];
    const fields: PassengerField[] = ['adults', 'children', 'infants'];
    const base = { origin: 'DEL', destination: 'BOM', departureDate: searchDateBounds().first };
    while (queue.length) {
      const p = queue.pop()!;
      const key = `${p.adults}-${p.children}-${p.infants}`;
      if (seen.has(key)) continue;
      seen.add(key);
      expect(searchFlightsSchema.safeParse({ ...base, ...p }).success, key).toBe(true);
      for (const f of fields) for (const d of [1, -1] as const) queue.push(stepPassengers(p, f, d));
    }
    expect(seen.size).toBeGreaterThan(50);
  });
});
