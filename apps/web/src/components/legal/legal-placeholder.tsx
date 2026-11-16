import Link from 'next/link';
import { env } from '@/env';
import { messages } from '@/lib/messages';

/** Placeholder for a legal document the business still has to supply (Terms, Privacy). */
export function LegalPlaceholder({ title }: { title: string }) {
  return (
    <div className="mx-auto max-w-2xl px-4 py-10">
      <h1 className="text-2xl font-bold">{title}</h1>
      <p className="mt-4 text-muted-foreground">{messages.legal.placeholder(title, env.NEXT_PUBLIC_BRAND_NAME)}</p>
      <Link href="/" className="mt-6 inline-flex min-h-11 items-center font-medium text-primary underline-offset-4 hover:underline">
        {messages.legal.back}
      </Link>
    </div>
  );
}
