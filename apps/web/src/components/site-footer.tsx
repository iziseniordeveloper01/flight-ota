import Link from 'next/link';
import { env } from '@/env';
import { messages } from '@/lib/messages';

// Module scope, not render: the pages are statically prerendered, so this is the build year.
const YEAR = new Date().getFullYear();

export function SiteFooter() {
  return (
    <footer className="mt-12 border-t bg-card print:hidden">
      <div className="mx-auto flex max-w-6xl flex-col gap-1 px-4 py-6 text-sm text-muted-foreground md:flex-row md:items-center md:justify-between">
        <p>{messages.footer.rights(YEAR, env.NEXT_PUBLIC_BRAND_NAME)}</p>
        <nav aria-label={messages.footer.legal}>
          <ul className="flex gap-4">
            <li>
              <Link href="/terms" className="inline-flex min-h-11 items-center underline-offset-4 hover:text-foreground hover:underline">
                {messages.footer.terms}
              </Link>
            </li>
            <li>
              <Link href="/privacy" className="inline-flex min-h-11 items-center underline-offset-4 hover:text-foreground hover:underline">
                {messages.footer.privacy}
              </Link>
            </li>
          </ul>
        </nav>
        <p>{messages.footer.note}</p>
      </div>
    </footer>
  );
}
