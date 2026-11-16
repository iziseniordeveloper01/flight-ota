'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { lastFlightDate, type BookingWarning, type PublicAncillaries, type PublicBooking, type UpdateBookingDetailsInput } from '@ota/contracts';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { AlertCircle, AlertTriangle } from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useMemo, useRef, useState } from 'react';
import { FormProvider, useForm, type FieldPath } from 'react-hook-form';
import { Button } from '@/components/ui/button';
import { bookingApi } from '@/lib/api';
import { bagSelectionFromBooking, selectedBags, type BagSelection } from '@/lib/bag-selection';
import { mapBookingError } from '@/lib/booking-errors';
import { bookingFormSchema, defaultFormValues, toDetailsBody, type BookingFormValues, type ValidBookingForm } from '@/lib/booking-form';
import { priceBreakdown } from '@/lib/booking-price';
import { passengerLabels, reviewPath, searchUrlForOffer } from '@/lib/booking-steps';
import { messages } from '@/lib/messages';
import { formatMoney } from '@/lib/money-format';
import { selectedSeats, selectionFromBooking, withoutServices, type SeatSelection } from '@/lib/seat-selection';
import { BlockingDialog } from './blocking-dialog';
import { ContactCard } from './contact-card';
import { ExpiredDialog } from './countdown';
import { BaggageSection, InsuranceCard, SeatSection } from './extras';
import { PassengerCard } from './passenger-card';
import { PriceAside, PriceBar } from './price-summary';
import { SeatMapDialog } from './seat-map-dialog';

const FORM_ID = 'booking-details';

interface Props {
  booking: PublicBooking;
  ancillaries: PublicAncillaries;
}

/**
 * Step 1: passengers, contact, extras, live price; Continue = PUT details → POST checkout → review.
 * Passenger data lives only in this form's memory and on our server (encrypted) — never in
 * localStorage/sessionStorage. A refresh restores it from GET booking.
 */
export function BookingForm({ booking, ancillaries }: Props) {
  const router = useRouter();
  const queryClient = useQueryClient();
  const { offer } = booking;
  const searchUrl = searchUrlForOffer(offer);
  const labels = useMemo(() => passengerLabels(offer.passengers), [offer.passengers]);
  const segments = useMemo(() => offer.slices.flatMap((s) => s.segments), [offer.slices]);
  const ctx = useMemo(
    () => ({
      lastFlightDate: lastFlightDate(offer),
      documentRequired: ancillaries.passengerRequirements.identityDocumentRequired,
      maxNameLength: ancillaries.passengerRequirements.maxNameLength,
    }),
    [offer, ancillaries],
  );

  const form = useForm<BookingFormValues, unknown, ValidBookingForm>({
    defaultValues: defaultFormValues(booking, ctx),
    // Values have the API body's shape; the resolver hands onValid the parsed (normalised) body.
    resolver: zodResolver(bookingFormSchema(ctx)),
    mode: 'onTouched',
  });

  const [bags, setBags] = useState<BagSelection>(() => bagSelectionFromBooking(booking.ancillaries, ancillaries.bags));
  const [seats, setSeats] = useState<SeatSelection>(() => selectionFromBooking(booking.ancillaries));
  const quote = booking.insurance.quotes[0];
  const [insured, setInsured] = useState(Boolean(quote && booking.insurance.selectedQuoteId === quote.quoteId));
  const [seatDialog, setSeatDialog] = useState<string | null>(null);

  const [submitting, setSubmitting] = useState(false);
  const [banner, setBanner] = useState<string | null>(null);
  const [warnings, setWarnings] = useState<BookingWarning[]>([]);
  const acknowledgedWarnings = useRef<string | null>(null);
  const [unavailableBags, setUnavailableBags] = useState<Set<string>>(new Set());
  const [unavailableSeats, setUnavailableSeats] = useState<Set<string>>(new Set());
  const [insuranceError, setInsuranceError] = useState(false);
  const [priceChange, setPriceChange] = useState<{ previous: string; next: string } | null>(null);
  const [expired, setExpired] = useState(false);
  const bannerRef = useRef<HTMLDivElement>(null);

  // Seat maps load after first paint (prefetch), so the dialog usually opens instantly.
  const seatMaps = useQuery({
    queryKey: ['seat-maps', booking.id],
    queryFn: ({ signal }) => bookingApi.seatMaps(booking.id, signal),
    enabled: ancillaries.seatsAvailable,
    staleTime: Infinity,
  });

  const price = priceBreakdown({
    fare: booking.displayPrice.fare,
    bags: selectedBags(bags, ancillaries.bags).map((b) => b.displayPrice),
    seats: selectedSeats(seats).map((s) => s.price),
    insurance: insured && quote ? quote.total : null,
  });
  const warningByPath = useMemo(() => new Map(warnings.map((w) => [w.path, w.message])), [warnings]);
  const adults = offer.passengers.filter((p) => p.type === 'adult').map((p) => ({ ref: p.ref, label: labels.get(p.ref) ?? '' }));
  const savedPassports = new Map(booking.passengers.map((p) => [p.ref, p.document?.numberMasked ?? null]));
  const originCountry = booking.airports[offer.slices[0].origin]?.countryCode ?? 'US';

  const showBanner = (message: string) => {
    setBanner(message);
    requestAnimationFrame(() => bannerRef.current?.scrollIntoView({ block: 'center', behavior: 'smooth' }));
  };

  async function checkout(body: UpdateBookingDetailsInput | null) {
    try {
      await bookingApi.checkout(booking.id);
      router.push(reviewPath(booking.id));
    } catch (err) {
      handleError(err, body);
      setSubmitting(false);
    }
  }

  function handleError(err: unknown, body: UpdateBookingDetailsInput | null) {
    const mapped = mapBookingError(err, body);
    if (mapped.expired) return setExpired(true);
    if (mapped.priceChange) {
      return setPriceChange({ previous: formatMoney(mapped.priceChange.previous), next: formatMoney(mapped.priceChange.next) });
    }
    if (mapped.serviceIds.length) {
      const gone = new Set(mapped.serviceIds);
      const goneBagGroups = Object.entries(bags).filter(([, id]) => gone.has(id)).map(([key]) => key);
      setBags((b) => Object.fromEntries(Object.entries(b).filter(([, id]) => !gone.has(id))));
      setUnavailableBags(new Set(goneBagGroups));
      setUnavailableSeats(new Set(Object.entries(seats).filter(([, byPax]) => Object.values(byPax).some((s) => gone.has(s.serviceId))).map(([seg]) => seg)));
      setSeats((s) => withoutServices(s, mapped.serviceIds));
      void queryClient.invalidateQueries({ queryKey: ['seat-maps', booking.id] });
    }
    if (mapped.insurance) {
      setInsured(false);
      setInsuranceError(true);
    }
    for (const f of mapped.fields) form.setError(f.path as FieldPath<BookingFormValues>, { type: 'server', message: f.message });
    if (mapped.fields[0]) form.setFocus(mapped.fields[0].path as FieldPath<BookingFormValues>, { shouldSelect: false });
    if (mapped.banner) {
      if (mapped.fields.length) setBanner(mapped.banner);
      else showBanner(mapped.banner);
    }
  }

  async function onValid(valid: ValidBookingForm) {
    setSubmitting(true);
    setBanner(null);
    setUnavailableBags(new Set());
    setUnavailableSeats(new Set());
    setInsuranceError(false);
    const serviceIds = [...selectedBags(bags, ancillaries.bags).map((b) => b.serviceId), ...selectedSeats(seats).map((s) => s.serviceId)];
    const body = toDetailsBody(valid, serviceIds, insured && quote ? quote.quoteId : null);
    try {
      const { meta } = await bookingApi.updateDetails(booking.id, body);
      // Passport expiring soon: show it once and let the customer continue on the next press.
      const key = JSON.stringify(meta.warnings);
      setWarnings(meta.warnings);
      if (meta.warnings.length && acknowledgedWarnings.current !== key) {
        acknowledgedWarnings.current = key;
        setSubmitting(false);
        showBanner(messages.booking.checkWarnings);
        return;
      }
    } catch (err) {
      handleError(err, body);
      setSubmitting(false);
      return;
    }
    await checkout(body);
  }

  function onInvalid() {
    setBanner(messages.booking.fixErrors);
  }

  return (
    <FormProvider {...form}>
      <div className="flex flex-col gap-4 lg:grid lg:grid-cols-[minmax(0,1fr)_22rem] lg:items-start lg:gap-6">
        <form id={FORM_ID} noValidate onSubmit={(e) => void form.handleSubmit(onValid, onInvalid)(e)} className="flex min-w-0 flex-col gap-4">
          <h2 className="text-xl font-bold">{messages.booking.passengers}</h2>
          <p role="note" className="flex items-start gap-2 rounded-lg bg-warning p-3 text-sm text-warning-foreground">
            <AlertTriangle aria-hidden className="mt-0.5 size-4 shrink-0" />
            {messages.booking.nameWarning}
          </p>
          {offer.passengers.map((slot, i) => (
            <PassengerCard
              key={slot.ref}
              index={i}
              slot={slot}
              label={labels.get(slot.ref) ?? ''}
              adults={adults}
              lastFlightDate={ctx.lastFlightDate}
              maxNameLength={ctx.maxNameLength}
              savedPassport={savedPassports.get(slot.ref) ?? null}
              warnings={warningByPath}
              searchUrl={searchUrl}
            />
          ))}

          <ContactCard defaultCountry={originCountry} />

          <h2 className="mt-2 text-xl font-bold">{messages.booking.extras}</h2>
          <BaggageSection
            bags={ancillaries.bags}
            passengers={offer.passengers}
            labels={labels}
            segments={segments}
            value={bags}
            onChange={(next) => {
              setBags(next);
              setUnavailableBags(new Set());
            }}
            unavailable={unavailableBags}
          />
          {ancillaries.seatsAvailable && (
            <SeatSection
              segments={segments}
              passengers={offer.passengers}
              labels={labels}
              selection={seats}
              onOpen={setSeatDialog}
              unavailableSegments={unavailableSeats}
            />
          )}
          {quote && (
            <InsuranceCard
              quote={quote}
              checked={insured}
              error={insuranceError}
              onChange={(checked) => {
                setInsured(checked);
                setInsuranceError(false);
              }}
            />
          )}

          <div ref={bannerRef} aria-live="assertive">
            {banner && (
              <p role="alert" className="flex items-start gap-2 rounded-lg border border-destructive bg-card p-3 text-sm font-medium text-destructive">
                <AlertCircle aria-hidden className="mt-0.5 size-4 shrink-0" />
                {banner}
              </p>
            )}
          </div>
        </form>

        <PriceAside price={price} travellers={offer.passengers.length} submitting={submitting} formId={FORM_ID} />
      </div>
      <PriceBar price={price} travellers={offer.passengers.length} submitting={submitting} formId={FORM_ID} />

      {ancillaries.seatsAvailable && (
        <SeatMapDialog
          open={seatDialog !== null}
          onOpenChange={(open) => !open && setSeatDialog(null)}
          segments={segments}
          initialSegmentRef={seatDialog ?? undefined}
          passengers={offer.passengers}
          labels={labels}
          maps={seatMaps.data?.data}
          loading={seatMaps.isPending}
          error={seatMaps.error}
          onRetry={() => void seatMaps.refetch()}
          selection={seats}
          onChange={(next) => {
            setSeats(next);
            setUnavailableSeats(new Set());
          }}
        />
      )}

      <BlockingDialog
        open={priceChange !== null}
        title={messages.booking.priceChangedTitle}
        description={priceChange ? messages.booking.priceChangedBody(priceChange.previous, priceChange.next) : ''}
        footer={
          <>
            <Button
              size="lg"
              className="w-full"
              disabled={submitting}
              onClick={() => {
                setPriceChange(null);
                setSubmitting(true);
                // Checkout again = accept: the booking now holds the new price.
                void checkout(null);
              }}
            >
              {messages.booking.acceptPrice}
            </Button>
            <Button asChild size="lg" variant="outline" className="w-full">
              <Link href={searchUrl}>{messages.booking.backToResults}</Link>
            </Button>
          </>
        }
      />
      <ExpiredDialog open={expired} searchUrl={searchUrl} />
    </FormProvider>
  );
}
