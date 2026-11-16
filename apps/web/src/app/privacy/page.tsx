import type { Metadata } from 'next';
import { LegalPlaceholder } from '@/components/legal/legal-placeholder';
import { messages } from '@/lib/messages';

// Placeholder until the real policy is supplied: keep it out of search engines.
export const metadata: Metadata = { title: messages.legal.privacyTitle, robots: { index: false, follow: false } };

export default function PrivacyPage() {
  return <LegalPlaceholder title={messages.legal.privacyTitle} />;
}
