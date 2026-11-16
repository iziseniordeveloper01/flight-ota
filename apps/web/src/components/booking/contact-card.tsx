'use client';

import { useEffect, useState } from 'react';
import { Controller, get, useFormContext, useWatch } from 'react-hook-form';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { titlesFor, type BookingFormValues } from '@/lib/booking-form';
import { messages } from '@/lib/messages';
import { Field, invalidProps, NativeSelect, SectionCard } from './field';
import { PhoneField } from './phone-field';

export function ContactCard({ defaultCountry }: { defaultCountry: string }) {
  const { register, control, setValue, formState } = useFormContext<BookingFormValues>();
  const [sameAsAdult, setSameAsAdult] = useState(false);
  const lead = useWatch({ control, name: 'passengers.0' });

  // While ticked, follow Adult 1's title and names.
  useEffect(() => {
    if (!sameAsAdult || !lead) return;
    const opts = { shouldValidate: formState.isSubmitted };
    setValue('contact.title', lead.title, opts);
    setValue('contact.givenName', lead.givenName, opts);
    setValue('contact.familyName', lead.noFamilyName ? '' : lead.familyName, opts);
  }, [sameAsAdult, lead, setValue, formState.isSubmitted]);

  const error = (field: string) => (get(formState.errors, `contact.${field}`) as { message?: string } | undefined)?.message;

  return (
    <SectionCard id="contact" title={messages.booking.contact} description={messages.booking.contactNote}>
      <label className="mb-3 flex min-h-11 cursor-pointer items-center gap-3 text-sm font-medium">
        <Checkbox checked={sameAsAdult} onCheckedChange={(c) => setSameAsAdult(c === true)} />
        {messages.booking.sameAsAdult}
      </label>
      <div className="grid gap-4 md:grid-cols-2">
        <Field id="c-title" label={messages.booking.titleLabel} error={error('title') ? messages.booking.selectRequired : undefined}>
          <NativeSelect {...invalidProps('c-title', Boolean(error('title')))} {...register('contact.title')}>
            <option value="">{messages.booking.select}</option>
            {titlesFor('adult').map((t) => (
              <option key={t} value={t}>
                {messages.booking.titles[t]}
              </option>
            ))}
          </NativeSelect>
        </Field>
        <div className="hidden md:block" />
        <Field id="c-given" label={messages.booking.givenName} error={error('givenName')}>
          <Input {...invalidProps('c-given', Boolean(error('givenName')))} readOnly={sameAsAdult} autoComplete="given-name" className="bg-card" {...register('contact.givenName')} />
        </Field>
        <Field id="c-family" label={messages.booking.familyName} error={error('familyName')}>
          <Input {...invalidProps('c-family', Boolean(error('familyName')))} readOnly={sameAsAdult} autoComplete="family-name" className="bg-card" {...register('contact.familyName')} />
        </Field>
        <Field id="c-email" label={messages.booking.email} error={error('email')}>
          <Input
            {...invalidProps('c-email', Boolean(error('email')))}
            type="email"
            inputMode="email"
            autoComplete="email"
            spellCheck={false}
            className="bg-card"
            {...register('contact.email')}
          />
        </Field>
        <Controller
          control={control}
          name="contact.phone"
          render={({ field }) => (
            <PhoneField
              id="c-phone"
              ref={field.ref}
              value={field.value}
              onChange={field.onChange}
              onBlur={field.onBlur}
              defaultCountry={defaultCountry}
              error={error('phone') ? messages.booking.phoneInvalid : undefined}
            />
          )}
        />
      </div>
    </SectionCard>
  );
}
