// Searches carry passenger COUNTS, but suppliers price by age. These are the representative ages
// we search with.
// Fares depend on age category (infant <2, child 2–11). At booking (Step 6) real DOBs are
// collected; if a passenger's category differs from the searched one, the offer must be re-searched.
export const SEARCH_CHILD_AGE = 10;
export const SEARCH_INFANT_AGE = 1;
