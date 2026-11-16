'use client';

import { Checkbox } from '@/components/ui/checkbox';
import { messages } from '@/lib/messages';

/** "I agree to the Terms and the Privacy Policy" — required before confirming or paying. */
export function TermsAgreement({ agreed, error, onChange }: { agreed: boolean; error: boolean; onChange: (agreed: boolean) => void }) {
  return (
    <div>
      <label className="flex min-h-11 cursor-pointer items-center gap-3 text-sm">
        <Checkbox
          checked={agreed}
          aria-invalid={error || undefined}
          aria-describedby={error ? 'agree-error' : undefined}
          onCheckedChange={(c) => onChange(c === true)}
        />
        <span>
          {messages.review.agree}{' '}
          <a href="/terms" target="_blank" rel="noopener" className="font-medium text-primary underline underline-offset-4">
            {messages.review.terms}
          </a>{' '}
          {messages.review.and}{' '}
          <a href="/privacy" target="_blank" rel="noopener" className="font-medium text-primary underline underline-offset-4">
            {messages.review.privacy}
          </a>
        </span>
      </label>
      {error && (
        <p id="agree-error" className="text-sm font-medium text-destructive">
          {messages.review.agreeRequired}
        </p>
      )}
    </div>
  );
}
