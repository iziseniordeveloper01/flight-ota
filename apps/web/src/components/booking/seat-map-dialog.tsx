'use client';

import type { OfferPassenger, PublicSeatMap, Segment } from '@ota/contracts';
import { useState, type ReactNode } from 'react';
import { ErrorState } from '@/components/results/result-states';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { Skeleton } from '@/components/ui/skeleton';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { useIsDesktop } from '@/hooks/use-media-query';
import { messages } from '@/lib/messages';
import { formatMoney } from '@/lib/money-format';
import { clearSeat, findSeat, isFree, seatChoosers, toggleSeat, type SeatSelection } from '@/lib/seat-selection';
import { cn } from '@/lib/utils';
import { SeatGrid, SeatLegend } from './seat-grid';

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  segments: Segment[];
  /** First segment to show. */
  initialSegmentRef?: string;
  passengers: OfferPassenger[];
  labels: Map<string, string>;
  maps: PublicSeatMap[] | undefined;
  loading: boolean;
  error: unknown;
  onRetry: () => void;
  selection: SeatSelection;
  onChange: (next: SeatSelection) => void;
}

/** Full-screen sheet on phones, large dialog from md. Tabs per flight, chips per passenger. */
export function SeatMapDialog(props: Props) {
  const isDesktop = useIsDesktop();
  const { open, onOpenChange } = props;
  const body = <SeatPicker {...props} />;
  if (isDesktop) {
    return (
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="flex h-[90dvh] flex-col gap-0 p-0 sm:max-w-3xl">
          <DialogHeader className="border-b p-4 pr-14">
            <DialogTitle className="text-lg">{messages.seats.title}</DialogTitle>
            <DialogDescription className="sr-only">{messages.booking.seatsNote}</DialogDescription>
          </DialogHeader>
          {body}
        </DialogContent>
      </Dialog>
    );
  }
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="bottom" className="h-dvh max-h-dvh gap-0 p-0">
        <SheetHeader className="border-b pr-14">
          <SheetTitle className="text-lg">{messages.seats.title}</SheetTitle>
          <SheetDescription className="sr-only">{messages.booking.seatsNote}</SheetDescription>
        </SheetHeader>
        {body}
      </SheetContent>
    </Sheet>
  );
}

function SeatPicker({ segments, initialSegmentRef, passengers, labels, maps, loading, error, onRetry, selection, onChange, onOpenChange }: Props) {
  const choosers = seatChoosers(passengers);
  const hasInfants = choosers.length < passengers.length;
  const [segmentRef, setSegmentRef] = useState(initialSegmentRef ?? segments[0]?.ref);
  const [passengerRef, setPassengerRef] = useState(choosers[0]?.ref);
  const passenger = choosers.find((p) => p.ref === passengerRef) ?? choosers[0];
  const current = selection[segmentRef ?? '']?.[passenger?.ref ?? ''];
  const currentMap = maps?.find((m) => m.segmentRef === segmentRef);
  const currentSeat = current && currentMap ? findSeat(currentMap, current.serviceId) : null;

  let content: ReactNode;
  if (loading) {
    content = (
      <output className="flex flex-col items-center gap-3 py-8">
        <span className="text-sm text-muted-foreground">{messages.seats.loading}</span>
        <Skeleton className="h-64 w-64" />
      </output>
    );
  } else if (error) {
    content = <ErrorState error={error} onRetry={onRetry} compact />;
  }

  return (
    <>
      <Tabs value={segmentRef} onValueChange={setSegmentRef} className="flex min-h-0 flex-1 flex-col gap-0">
        <div className="flex flex-col gap-3 border-b p-4 pb-3">
          {segments.length > 1 && (
            <TabsList aria-label={messages.seats.flightTabs} className="w-full justify-start overflow-x-auto">
              {segments.map((s) => (
                <TabsTrigger key={s.ref} value={s.ref} className="min-h-11 flex-none px-3">
                  {s.origin} → {s.destination}
                </TabsTrigger>
              ))}
            </TabsList>
          )}
          <fieldset className="flex flex-wrap gap-2">
            <legend className="sr-only">{messages.seats.choosingFor}</legend>
            {choosers.map((p) => {
              const seat = selection[segmentRef ?? '']?.[p.ref];
              const active = p.ref === passenger?.ref;
              return (
                <button
                  key={p.ref}
                  type="button"
                  aria-pressed={active}
                  onClick={() => setPassengerRef(p.ref)}
                  className={cn(
                    'min-h-11 rounded-full border px-4 text-sm font-medium transition-colors',
                    active ? 'border-primary bg-primary text-primary-foreground' : 'border-input bg-card hover:bg-muted',
                  )}
                >
                  {labels.get(p.ref)}
                  {seat ? ` · ${seat.label}` : ''}
                </button>
              );
            })}
          </fieldset>
          {hasInfants && <p className="text-xs text-muted-foreground">{messages.seats.infantNote}</p>}
          <SeatLegend />
        </div>
        {/* A bounded flex column: the seat grid scrolls inside it (both axes, sticky labels). */}
        <div className="flex min-h-0 flex-1 flex-col overflow-y-auto px-2 pt-3 pb-1 md:p-4 md:pb-2">
          {content ??
            segments.map((s) => {
              const map = maps?.find((m) => m.segmentRef === s.ref);
              return (
                <TabsContent key={s.ref} value={s.ref} className="mt-0 flex min-h-0 flex-col">
                  {!map || !passenger ? (
                    <p className="py-8 text-center text-sm text-muted-foreground">{messages.seats.noMap}</p>
                  ) : (
                    <SeatGrid map={map} passenger={passenger} selection={selection} onToggle={(seat) => onChange(toggleSeat(selection, s.ref, passenger, seat))} />
                  )}
                </TabsContent>
              );
            })}
        </div>
      </Tabs>
      <div className="flex items-center gap-2 border-t p-4 md:gap-3">
        <p aria-live="polite" data-testid="seat-footer" className="min-w-0 flex-1 text-sm font-medium">
          {passenger &&
            messages.seats.footer(
              labels.get(passenger.ref) ?? '',
              current
                ? {
                    label: current.label,
                    position: currentSeat ? messages.seats.positionTitle[currentSeat.position] : null,
                    price: isFree(current.price) ? messages.seats.free : formatMoney(current.price),
                  }
                : null,
            )}
        </p>
        {current && segmentRef && passenger && (
          <Button variant="ghost" onClick={() => onChange(clearSeat(selection, segmentRef, passenger.ref))}>
            {messages.seats.clear}
          </Button>
        )}
        <Button onClick={() => onOpenChange(false)}>{messages.seats.done}</Button>
      </div>
    </>
  );
}
