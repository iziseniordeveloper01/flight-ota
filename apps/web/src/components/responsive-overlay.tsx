'use client';

import type { ReactElement, ReactNode } from 'react';
import { cn } from '@/lib/utils';
import { useIsDesktop } from '@/hooks/use-media-query';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from '@/components/ui/sheet';

interface PickerProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** The field button. Must forward refs/props (Radix asChild). */
  trigger: ReactElement;
  title: string;
  children: ReactNode;
  footer?: ReactNode;
  popoverClassName?: string;
}

/**
 * Form-field picker: full-screen sheet on phones (room for the keyboard and big tap targets),
 * anchored popover from md up.
 */
export function ResponsivePicker({
  open,
  onOpenChange,
  trigger,
  title,
  children,
  footer,
  popoverClassName,
}: PickerProps) {
  const isDesktop = useIsDesktop();

  if (isDesktop) {
    return (
      <Popover open={open} onOpenChange={onOpenChange}>
        <PopoverTrigger asChild>{trigger}</PopoverTrigger>
        <PopoverContent align="start" aria-label={title} className={cn('w-auto p-3', popoverClassName)}>
          {children}
          {footer}
        </PopoverContent>
      </Popover>
    );
  }

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetTrigger asChild>{trigger}</SheetTrigger>
      <SheetContent side="bottom" className="h-dvh max-h-dvh gap-0 p-0">
        <SheetHeader className="border-b pr-14">
          <SheetTitle>{title}</SheetTitle>
          <SheetDescription className="sr-only">{title}</SheetDescription>
        </SheetHeader>
        <div className="flex-1 overflow-y-auto p-4">{children}</div>
        {footer && <div className="border-t p-4">{footer}</div>}
      </SheetContent>
    </Sheet>
  );
}

interface DialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description?: string;
  children: ReactNode;
  footer?: ReactNode;
  className?: string;
}

/** Content overlay: bottom sheet on phones, centred dialog from md up. Body scrolls, footer stays. */
export function ResponsiveDialog({
  open,
  onOpenChange,
  title,
  description,
  children,
  footer,
  className,
}: DialogProps) {
  const isDesktop = useIsDesktop();

  if (isDesktop) {
    return (
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className={cn('flex max-h-[85dvh] flex-col gap-0 p-0 sm:max-w-lg', className)}>
          <DialogHeader className="border-b p-4 pr-14">
            <DialogTitle className="text-lg">{title}</DialogTitle>
            <DialogDescription className={description ? undefined : 'sr-only'}>
              {description ?? title}
            </DialogDescription>
          </DialogHeader>
          <div className="flex-1 overflow-y-auto p-4">{children}</div>
          {footer && <div className="border-t p-4">{footer}</div>}
        </DialogContent>
      </Dialog>
    );
  }

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="bottom" className={cn('max-h-[92dvh] gap-0 rounded-t-2xl p-0', className)}>
        <SheetHeader className="border-b pr-14">
          <SheetTitle className="text-lg">{title}</SheetTitle>
          <SheetDescription className={description ? undefined : 'sr-only'}>
            {description ?? title}
          </SheetDescription>
        </SheetHeader>
        <div className="flex-1 overflow-y-auto p-4">{children}</div>
        {footer && <div className="border-t p-4">{footer}</div>}
      </SheetContent>
    </Sheet>
  );
}
