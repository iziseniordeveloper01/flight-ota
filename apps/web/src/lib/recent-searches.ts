import { useSyncExternalStore } from 'react';
import { z } from 'zod';
import { CABIN_CLASSES } from '@ota/contracts';
import type { SearchState } from './search-params';

// Last 5 searches in localStorage. Storage can be missing or throw (private mode, quota, blocked
// cookies) and its contents can be stale or hand-edited, so every access is guarded and validated.

const KEY = 'ota:recent-searches:v1';
const MAX = 5;
const CHANGE_EVENT = 'ota:recent-searches';

const recentSchema = z.object({
  from: z.string().regex(/^[A-Z]{3}$/),
  to: z.string().regex(/^[A-Z]{3}$/),
  fromCity: z.string().max(80).nullable(),
  toCity: z.string().max(80).nullable(),
  depart: z.iso.date(),
  return: z.iso.date().nullable(),
  adults: z.number().int(),
  children: z.number().int(),
  infants: z.number().int(),
  cabin: z.enum(CABIN_CLASSES),
});

export type RecentSearch = z.infer<typeof recentSchema>;

const EMPTY: RecentSearch[] = [];
let cachedRaw: string | null = null;
let cachedList: RecentSearch[] = EMPTY;

function readRaw(): string | null {
  try {
    return window.localStorage.getItem(KEY);
  } catch {
    return null;
  }
}

function parseList(raw: string | null): RecentSearch[] {
  if (!raw) return EMPTY;
  try {
    const parsed = z.array(recentSchema).safeParse(JSON.parse(raw));
    return parsed.success ? parsed.data.slice(0, MAX) : EMPTY;
  } catch {
    return EMPTY;
  }
}

// useSyncExternalStore needs a stable snapshot: re-parse only when the raw string changes.
function getSnapshot(): RecentSearch[] {
  const raw = readRaw();
  if (raw !== cachedRaw) {
    cachedRaw = raw;
    cachedList = parseList(raw);
  }
  return cachedList;
}

function subscribe(onChange: () => void): () => void {
  window.addEventListener('storage', onChange); // other tabs
  window.addEventListener(CHANGE_EVENT, onChange); // this tab
  return () => {
    window.removeEventListener('storage', onChange);
    window.removeEventListener(CHANGE_EVENT, onChange);
  };
}

export function useRecentSearches(): RecentSearch[] {
  // Server snapshot is empty: recent searches only exist in the browser.
  return useSyncExternalStore(subscribe, getSnapshot, () => EMPTY);
}

function sameTrip(a: RecentSearch, b: RecentSearch): boolean {
  return a.from === b.from && a.to === b.to && a.depart === b.depart && a.return === b.return;
}

export function saveRecentSearch(entry: RecentSearch): void {
  try {
    const next = [entry, ...getSnapshot().filter((e) => !sameTrip(e, entry))].slice(0, MAX);
    window.localStorage.setItem(KEY, JSON.stringify(next));
    window.dispatchEvent(new Event(CHANGE_EVENT));
  } catch {
    // Storage unavailable: recent searches are a convenience, never an error.
  }
}

export function recentToState(r: RecentSearch): SearchState {
  const { fromCity: _f, toCity: _t, ...state } = r;
  return state;
}
