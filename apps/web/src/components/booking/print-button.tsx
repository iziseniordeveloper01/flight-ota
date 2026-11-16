'use client';

import { Printer } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { messages } from '@/lib/messages';

export function PrintButton() {
  return (
    <Button variant="outline" size="lg" onClick={() => window.print()} className="print:hidden">
      <Printer aria-hidden />
      {messages.complete.print}
    </Button>
  );
}
