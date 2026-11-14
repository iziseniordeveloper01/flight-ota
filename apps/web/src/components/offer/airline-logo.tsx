'use client';

import type { Carrier } from '@ota/contracts';
import Image from 'next/image';
import { useState } from 'react';
import { cn } from '@/lib/utils';

/**
 * 24px airline mark. Decorative: the airline name is always shown as text next to it, so the image
 * has alt="" and the fallback is aria-hidden. Missing URL or a failed load → neutral circle with the
 * 2-letter code. Remote hosts must be allowed in next.config.ts `images.remotePatterns`.
 */
export function AirlineLogo({ carrier, className }: { carrier: Carrier; className?: string }) {
  // Remember WHICH url failed, so a different logo for the same component instance still gets a try.
  const [failedUrl, setFailedUrl] = useState<string | null>(null);
  const url = carrier.logoUrl;

  if (url && url !== failedUrl) {
    return (
      <Image
        src={url}
        alt=""
        width={24}
        height={24}
        className={cn('size-6 shrink-0 object-contain', className)}
        onError={() => setFailedUrl(url)}
      />
    );
  }
  return (
    <span
      aria-hidden
      data-testid="airline-logo-fallback"
      className={cn(
        'flex size-6 shrink-0 items-center justify-center rounded-full bg-muted text-[10px] font-semibold text-muted-foreground',
        className,
      )}
    >
      {(carrier.code || carrier.name).slice(0, 2).toUpperCase()}
    </span>
  );
}
