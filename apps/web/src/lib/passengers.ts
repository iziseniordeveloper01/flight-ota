import { MAX_SEATED_PASSENGERS } from '@ota/contracts';
import { messages } from './messages';

// Same rules as searchFlightsSchema (adults 1..9, infants <= adults, adults + children <= 9),
// applied while the user taps so they can never build an invalid combination.

export interface Passengers {
  adults: number;
  children: number;
  infants: number;
}

export type PassengerField = keyof Passengers;

export interface StepperState {
  canAdd: boolean;
  canRemove: boolean;
  /** Why "+" is disabled, shown inline next to the stepper. */
  limitHint?: string;
}

export function stepperState(p: Passengers): Record<PassengerField, StepperState> {
  const seatsFull = p.adults + p.children >= MAX_SEATED_PASSENGERS;
  const seatHint = messages.pax.maxSeated(MAX_SEATED_PASSENGERS);
  return {
    adults: {
      canAdd: !seatsFull,
      canRemove: p.adults > 1,
      limitHint: seatsFull ? seatHint : undefined,
    },
    children: {
      canAdd: !seatsFull,
      canRemove: p.children > 0,
      limitHint: seatsFull ? seatHint : undefined,
    },
    infants: {
      canAdd: p.infants < p.adults,
      canRemove: p.infants > 0,
      limitHint: p.infants >= p.adults ? messages.pax.infantsPerAdult : undefined,
    },
  };
}

/** Apply +1/-1 if allowed. Removing an adult also drops an infant who would lose their lap. */
export function stepPassengers(p: Passengers, field: PassengerField, delta: 1 | -1): Passengers {
  const state = stepperState(p)[field];
  if (delta === 1 ? !state.canAdd : !state.canRemove) return p;
  const next = { ...p, [field]: p[field] + delta };
  if (next.infants > next.adults) next.infants = next.adults;
  return next;
}

export function totalTravellers(p: Passengers): number {
  return p.adults + p.children + p.infants;
}
