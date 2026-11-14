'use client';

import type { PublicFlightOffer } from '@ota/contracts';
import { useWindowVirtualizer } from '@tanstack/react-virtual';
import { useLayoutEffect, useRef, useState } from 'react';
import { OfferCard } from '@/components/offer/offer-card';

interface Props {
  offers: PublicFlightOffer[];
  travellers: number;
  onSelect: (offer: PublicFlightOffer) => void;
}

/**
 * Window-scrolled virtual list: only the cards near the viewport are in the DOM. Uses the page
 * scroll (not an inner scroll box) so mobile browsers keep their native scrolling and URL-bar
 * collapse. Cards have different heights (stops, round trips), so each row is measured.
 */
export function OfferList({ offers, travellers, onSelect }: Props) {
  const listRef = useRef<HTMLUListElement>(null);
  const [scrollMargin, setScrollMargin] = useState(0);
  const roundTrip = (offers[0]?.slices.length ?? 1) > 1;

  // Distance from the top of the document to the list; content above it (banners) can change.
  useLayoutEffect(() => {
    const el = listRef.current;
    if (el) setScrollMargin(el.getBoundingClientRect().top + window.scrollY);
  }, [offers.length]);

  // This rule is about the React Compiler, which this app does not enable; TanStack Virtual
  // is the requested virtualiser and works correctly without compiler memoisation.
  // oxlint-disable-next-line react/incompatible-library
  const virtualizer = useWindowVirtualizer({
    count: offers.length,
    estimateSize: () => (roundTrip ? 290 : 210),
    overscan: 4,
    scrollMargin,
    getItemKey: (i) => offers[i].id,
  });

  return (
    <ul ref={listRef} className="relative" style={{ height: virtualizer.getTotalSize() }}>
      {virtualizer.getVirtualItems().map((item) => (
        <li
          key={item.key}
          data-index={item.index}
          ref={virtualizer.measureElement}
          // Virtualised: tell assistive tech the real list size and position.
          aria-setsize={offers.length}
          aria-posinset={item.index + 1}
          className="absolute top-0 left-0 w-full pb-3"
          style={{ transform: `translateY(${item.start - virtualizer.options.scrollMargin}px)` }}
        >
          <OfferCard offer={offers[item.index]} travellers={travellers} onSelect={onSelect} />
        </li>
      ))}
    </ul>
  );
}
