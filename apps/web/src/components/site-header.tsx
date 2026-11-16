import { PlaneTakeoff } from 'lucide-react';
import Link from 'next/link';
import { env } from '@/env';

export function SiteHeader() {
  return (
    <header className="border-b bg-card print:hidden">
      <div className="mx-auto flex h-14 max-w-6xl items-center px-4">
        <Link
          href="/"
          className="flex min-h-11 items-center gap-2 rounded-md text-lg font-bold text-primary"
        >
          <PlaneTakeoff aria-hidden className="size-6" />
          {env.NEXT_PUBLIC_BRAND_NAME}
        </Link>
      </div>
    </header>
  );
}
