'use client';

import type { ReactNode } from 'react';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';

/**
 * A decision the customer must make (fare expired, price changed): no close button, Escape and
 * outside clicks do nothing — only the actions in `footer` leave it. role="alertdialog".
 */
export function BlockingDialog({
  open,
  title,
  description,
  footer,
  children,
}: {
  open: boolean;
  title: string;
  description: string;
  footer: ReactNode;
  children?: ReactNode;
}) {
  return (
    <Dialog open={open}>
      <DialogContent
        role="alertdialog"
        showCloseButton={false}
        onEscapeKeyDown={(e) => e.preventDefault()}
        onPointerDownOutside={(e) => e.preventDefault()}
        onInteractOutside={(e) => e.preventDefault()}
        className="sm:max-w-md"
      >
        <DialogHeader>
          <DialogTitle className="text-lg">{title}</DialogTitle>
          <DialogDescription className="text-base">{description}</DialogDescription>
        </DialogHeader>
        {children}
        <DialogFooter className="flex-col gap-2 sm:flex-col">{footer}</DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
