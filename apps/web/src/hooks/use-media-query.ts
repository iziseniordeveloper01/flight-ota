'use client';

import { useCallback, useSyncExternalStore } from 'react';

/**
 * Live CSS media query match. Server render and first client render assume "false" (mobile first);
 * components using it render closed overlays at that point, so there is no visible mismatch.
 */
export function useMediaQuery(query: string): boolean {
  const subscribe = useCallback(
    (onChange: () => void) => {
      const mql = window.matchMedia(query);
      mql.addEventListener('change', onChange);
      return () => mql.removeEventListener('change', onChange);
    },
    [query],
  );
  return useSyncExternalStore(
    subscribe,
    () => window.matchMedia(query).matches,
    () => false,
  );
}

/** md breakpoint (768px): popovers/dialogs instead of full-screen sheets. */
export function useIsDesktop(): boolean {
  return useMediaQuery('(min-width: 768px)');
}
