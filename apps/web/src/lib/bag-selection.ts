import type { BagOption, PublicBookingAncillary } from '@ota/contracts';

/** One "extra baggage" choice: a passenger × the flights one bag covers (e.g. the outbound slice). */
export interface BagGroup {
  key: string;
  passengerRef: string;
  segmentRefs: string[];
  options: BagOption[];
}

/** groupKey → chosen serviceId (absent = "No additional baggage"). One option per group, quantity 1. */
export type BagSelection = Record<string, string>;

const groupKey = (bag: Pick<BagOption, 'passengerRef' | 'segmentRefs'>) => `${bag.passengerRef}|${bag.segmentRefs.join(',')}`;

/** Bag options grouped per passenger and flight group, in the order of `passengerRefs`. */
export function bagGroups(bags: BagOption[], passengerRefs: string[]): BagGroup[] {
  const groups = new Map<string, BagGroup>();
  for (const bag of bags) {
    const key = groupKey(bag);
    const group = groups.get(key) ?? { key, passengerRef: bag.passengerRef, segmentRefs: bag.segmentRefs, options: [] };
    group.options.push(bag);
    groups.set(key, group);
  }
  const order = new Map(passengerRefs.map((ref, i) => [ref, i]));
  return [...groups.values()].sort((a, b) => (order.get(a.passengerRef) ?? 99) - (order.get(b.passengerRef) ?? 99));
}

/** Saved bags of a booking (after a refresh), matched to today's options by service id. */
export function bagSelectionFromBooking(ancillaries: PublicBookingAncillary[], bags: BagOption[]): BagSelection {
  const byId = new Map(bags.map((b) => [b.serviceId, b]));
  const selection: BagSelection = {};
  for (const a of ancillaries) {
    const bag = a.type === 'bag' && a.serviceId ? byId.get(a.serviceId) : undefined;
    if (bag) selection[groupKey(bag)] = bag.serviceId;
  }
  return selection;
}

export function selectedBags(selection: BagSelection, bags: BagOption[]): BagOption[] {
  const chosen = new Set(Object.values(selection));
  return bags.filter((b) => chosen.has(b.serviceId));
}
