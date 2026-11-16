import type { Metadata } from 'next';
import { LegalPlaceholder } from '@/components/legal/legal-placeholder';
import { messages } from '@/lib/messages';

// Placeholder until the real terms are supplied: keep it out of search engines.
export const metadata: Metadata = { title: messages.legal.termsTitle, robots: { index: false, follow: false } };

export default function TermsPage() {
  return <LegalPlaceholder title={messages.legal.termsTitle} />;
}
