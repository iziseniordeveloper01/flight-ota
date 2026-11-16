'use client';

import type { OfferPassenger } from '@ota/contracts';
import { AlertTriangle } from 'lucide-react';
import Link from 'next/link';
import { Controller, get, useFormContext, useWatch } from 'react-hook-form';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { ageCategoryError, emptyPassport, genderForTitle, titlesFor, type BookingFormValues, type Title } from '@/lib/booking-form';
import { yearOptions } from '@/lib/date-parts';
import { messages } from '@/lib/messages';
import { CountrySelect } from './country-select';
import { DateSelects } from './date-selects';
import { Field, invalidProps, NativeSelect, SectionCard } from './field';

const THIS_YEAR = new Date().getUTCFullYear();
const BIRTH_YEARS = {
  adult: yearOptions(THIS_YEAR - 11, THIS_YEAR - 110),
  child: yearOptions(THIS_YEAR - 1, THIS_YEAR - 13),
  infant: yearOptions(THIS_YEAR, THIS_YEAR - 3),
};
const EXPIRY_YEARS = yearOptions(THIS_YEAR, THIS_YEAR + 20);

interface Props {
  index: number;
  slot: OfferPassenger;
  label: string;
  adults: Array<{ ref: string; label: string }>;
  lastFlightDate: string;
  maxNameLength: number | null;
  savedPassport: string | null;
  /** Non-blocking notes from the API (PASSPORT_EXPIRES_SOON) by field path. */
  warnings: Map<string, string>;
  searchUrl: string;
}

export function PassengerCard({ index, slot, label, adults, lastFlightDate, maxNameLength, savedPassport, warnings, searchUrl }: Props) {
  const { register, control, setValue, formState } = useFormContext<BookingFormValues>();
  const base = `passengers.${index}` as const;
  const pid = `p${index}`;
  const [noFamilyName, dateOfBirth, document, passengers] = useWatch({
    control,
    name: [`${base}.noFamilyName`, `${base}.dateOfBirth`, `${base}.document`, 'passengers'],
  });

  const error = (field: string) => (get(formState.errors, `${base}.${field}`) as { message?: string } | undefined)?.message;
  // Selects/pickers with nothing chosen: one clear message instead of the schema's enum text.
  const selectError = (field: string, value: unknown) => (error(field) ? (value ? error(field) : messages.booking.selectRequired) : undefined);
  const mismatch = ageCategoryError(dateOfBirth, slot.type, lastFlightDate);
  const maxLength = maxNameLength ?? 50;
  const takenAdults = new Set(passengers.filter((p, i) => i !== index && p.type === 'infant').map((p) => p.associatedAdultRef));
  const current = passengers[index];

  return (
    <SectionCard id={`passenger-${index}`} title={label}>
      <div className="grid gap-4 md:grid-cols-2">
        <Field id={`${pid}-title`} label={messages.booking.titleLabel} error={selectError('title', current?.title)}>
          <NativeSelect
            {...invalidProps(`${pid}-title`, Boolean(error('title')))}
            {...register(`${base}.title`, {
              onChange: (e: { target: { value: string } }) => {
                if (e.target.value) setValue(`${base}.gender`, genderForTitle(e.target.value as Title), { shouldValidate: formState.isSubmitted });
              },
            })}
          >
            <option value="">{messages.booking.select}</option>
            {titlesFor(slot.type).map((t) => (
              <option key={t} value={t}>
                {messages.booking.titles[t]}
              </option>
            ))}
          </NativeSelect>
        </Field>

        <Field id={`${pid}-gender`} label={messages.booking.gender} error={selectError('gender', current?.gender)}>
          <NativeSelect {...invalidProps(`${pid}-gender`, Boolean(error('gender')))} {...register(`${base}.gender`)}>
            <option value="">{messages.booking.select}</option>
            <option value="m">{messages.booking.genders.m}</option>
            <option value="f">{messages.booking.genders.f}</option>
          </NativeSelect>
        </Field>

        <Field id={`${pid}-given`} label={messages.booking.givenName} hint={messages.booking.givenNameHint} error={error('givenName')}>
          <Input
            {...invalidProps(`${pid}-given`, Boolean(error('givenName')))}
            autoComplete="off"
            autoCapitalize="words"
            spellCheck={false}
            maxLength={maxLength}
            className="bg-card"
            {...register(`${base}.givenName`)}
          />
        </Field>

        <div className="flex flex-col gap-2">
          <Field id={`${pid}-family`} label={messages.booking.familyName} error={error('familyName')}>
            <Input
              {...invalidProps(`${pid}-family`, Boolean(error('familyName')))}
              autoComplete="off"
              autoCapitalize="words"
              spellCheck={false}
              maxLength={maxLength}
              // readOnly, not disabled: React Hook Form drops disabled fields from the values.
              readOnly={noFamilyName}
              aria-readonly={noFamilyName || undefined}
              className="bg-card read-only:bg-muted read-only:text-muted-foreground"
              {...register(`${base}.familyName`)}
            />
          </Field>
          <Controller
            control={control}
            name={`${base}.noFamilyName`}
            render={({ field }) => (
              <label className="flex min-h-11 cursor-pointer items-center gap-3 text-sm">
                <Checkbox
                  checked={field.value}
                  onCheckedChange={(checked) => {
                    field.onChange(checked === true);
                    if (checked === true) setValue(`${base}.familyName`, '', { shouldValidate: formState.isSubmitted });
                  }}
                />
                {messages.booking.noFamilyName}
              </label>
            )}
          />
        </div>

        <Controller
          control={control}
          name={`${base}.dateOfBirth`}
          render={({ field }) => (
            <div className="flex flex-col gap-1">
              <DateSelects
                id={`${pid}-dob`}
                ref={field.ref}
                label={messages.booking.dateOfBirth}
                value={field.value}
                onChange={field.onChange}
                onBlur={field.onBlur}
                years={BIRTH_YEARS[slot.type]}
                error={error('dateOfBirth') ? (field.value || mismatch ? error('dateOfBirth') : messages.booking.chooseDate) : undefined}
              />
              {mismatch && (
                <Link href={searchUrl} className="min-h-11 py-2 text-sm font-medium text-primary underline underline-offset-4">
                  {messages.booking.searchAgain}
                </Link>
              )}
            </div>
          )}
        />

        <Controller
          control={control}
          name={`${base}.nationality`}
          render={({ field }) => (
            <Field id={`${pid}-nat`} label={messages.booking.nationality} error={selectError('nationality', field.value)}>
              <CountrySelect id={`${pid}-nat`} ref={field.ref} label={messages.booking.nationality} value={field.value} onChange={field.onChange} onBlur={field.onBlur} invalid={Boolean(error('nationality'))} />
            </Field>
          )}
        />

        {slot.type === 'infant' && (
          <Field id={`${pid}-adult`} label={messages.booking.travelsWith} error={selectError('associatedAdultRef', current?.associatedAdultRef)}>
            <NativeSelect
              {...invalidProps(`${pid}-adult`, Boolean(error('associatedAdultRef')))}
              {...register(`${base}.associatedAdultRef`, { setValueAs: (v: string) => v || null })}
            >
              <option value="">{messages.booking.select}</option>
              {adults.map((a) => (
                <option key={a.ref} value={a.ref} disabled={takenAdults.has(a.ref)}>
                  {a.label}
                  {takenAdults.has(a.ref) ? ` — ${messages.booking.infantLinkTaken}` : ''}
                </option>
              ))}
            </NativeSelect>
          </Field>
        )}
      </div>

      {document && (
        <fieldset className="mt-5 flex flex-col gap-4 border-t pt-4">
          <legend className="sr-only">{messages.booking.passport}</legend>
          <p className="font-semibold" aria-hidden>
            {messages.booking.passport}
          </p>
          {'keepExisting' in document ? (
            <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg bg-muted px-3 py-2">
              <span className="text-sm">{messages.booking.passportSaved(savedPassport ?? '')}</span>
              <Button type="button" variant="outline" onClick={() => setValue(`${base}.document`, emptyPassport())}>
                {messages.booking.passportChange}
              </Button>
            </div>
          ) : (
            <div className="grid gap-4 md:grid-cols-2">
              <Field id={`${pid}-passport`} label={messages.booking.passportNumber} error={error('document.number')}>
                <Input
                  {...invalidProps(`${pid}-passport`, Boolean(error('document.number')))}
                  autoComplete="off"
                  autoCapitalize="characters"
                  spellCheck={false}
                  className="bg-card"
                  {...register(`${base}.document.number`)}
                />
              </Field>
              <Controller
                control={control}
                name={`${base}.document.issuingCountry`}
                render={({ field }) => (
                  <Field id={`${pid}-issuer`} label={messages.booking.issuingCountry} error={selectError('document.issuingCountry', field.value)}>
                    <CountrySelect
                      id={`${pid}-issuer`}
                      ref={field.ref}
                      label={messages.booking.issuingCountry}
                      value={field.value}
                      onChange={field.onChange}
                      onBlur={field.onBlur}
                      invalid={Boolean(error('document.issuingCountry'))}
                    />
                  </Field>
                )}
              />
              <Controller
                control={control}
                name={`${base}.document.expiryDate`}
                render={({ field }) => (
                  <DateSelects
                    id={`${pid}-expiry`}
                    ref={field.ref}
                    label={messages.booking.passportExpiry}
                    value={field.value}
                    onChange={field.onChange}
                    onBlur={field.onBlur}
                    years={EXPIRY_YEARS}
                    error={error('document.expiryDate') ? (field.value ? error('document.expiryDate') : messages.booking.chooseDate) : undefined}
                  />
                )}
              />
            </div>
          )}
          {warnings.get(`${base}.document.expiryDate`) && (
            <output className="flex items-start gap-2 rounded-lg bg-warning p-3 text-sm text-warning-foreground">
              <AlertTriangle aria-hidden className="mt-0.5 size-4 shrink-0" />
              {warnings.get(`${base}.document.expiryDate`)}
            </output>
          )}
        </fieldset>
      )}
    </SectionCard>
  );
}
