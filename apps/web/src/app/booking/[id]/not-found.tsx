import { SearchX } from 'lucide-react';
import Link from 'next/link';
import { Button } from '@/components/ui/button';
import { messages } from '@/lib/messages';

/** Unknown booking, wrong token, or no `bk_<id>` cookie in this browser — all look the same. */
export default function BookingNotFound() {
  return (
    <div className="mx-auto max-w-xl px-4 py-12">
      <div role="alert" className="flex flex-col items-center gap-3 rounded-xl border bg-card px-4 py-10 text-center">
        <SearchX aria-hidden className="size-8 text-muted-foreground" />
        <h1 className="text-xl font-semibold">{messages.booking.notFoundTitle}</h1>
        <p className="text-sm text-muted-foreground">{messages.booking.notFoundBody}</p>
        <Button asChild className="mt-2">
          <Link href="/">{messages.booking.backHome}</Link>
        </Button>
      </div>
    </div>
  );
}
