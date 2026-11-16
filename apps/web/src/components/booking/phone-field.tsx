'use client';

import { useEffect, useMemo, useState, type Ref } from 'react';
import { Input } from '@/components/ui/input';
import { countryName } from '@/lib/countries';
import { messages } from '@/lib/messages';
import { errorId, FieldError, NativeSelect } from './field';

type PhoneLib = typeof import('@/lib/phone');

interface Props {
  id: string;
  /** E.164, or "" while the number is empty / not valid for the chosen country. */
  value: string;
  onChange: (e164: string) => void;
  onBlur?: () => void;
  defaultCountry: string;
  error?: string;
  ref?: Ref<HTMLInputElement>;
}

/** Country calling code + national number → E.164. libphonenumber is loaded only when this mounts. */
export function PhoneField({ id, value, onChange, onBlur, defaultCountry, error, ref }: Props) {
  const [lib, setLib] = useState<PhoneLib | null>(null);
  const [country, setCountry] = useState(defaultCountry);
  const [national, setNational] = useState('');

  useEffect(() => {
    let alive = true;
    void import('@/lib/phone').then((mod) => {
      if (!alive) return;
      setLib(mod);
      // Restore a saved number (after a refresh), else keep the default country if it has a code.
      const saved = value ? mod.fromE164(value) : null;
      if (saved) {
        setCountry(saved.country);
        setNational(saved.national);
      } else if (!mod.isPhoneCountry(defaultCountry)) {
        setCountry('US');
      }
    });
    return () => {
      alive = false;
    };
    // Only on mount: later `value` changes come from this component itself.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const options = useMemo(
    () =>
      lib
        ?.callingCodes()
        .map((c) => ({ ...c, name: countryName(c.country) }))
        .sort((a, b) => a.name.localeCompare(b.name)) ?? [],
    [lib],
  );

  const emit = (nextCountry: string, nextNational: string) => {
    onChange(lib ? (lib.toE164(nextCountry, nextNational) ?? '') : '');
  };

  const invalid = Boolean(error);
  return (
    <fieldset className="flex min-w-0 flex-col gap-1.5">
      <legend className="mb-1.5 text-sm font-medium">{messages.booking.mobile}</legend>
      <div className="grid grid-cols-[minmax(0,8.5rem)_1fr] gap-2">
        <NativeSelect
          aria-label={messages.booking.countryCode}
          value={country}
          disabled={!lib}
          onChange={(e) => {
            setCountry(e.target.value);
            emit(e.target.value, national);
          }}
        >
          {lib ? (
            options.map((o) => (
              <option key={o.country} value={o.country}>
                {`+${o.code} ${o.name}`}
              </option>
            ))
          ) : (
            <option value={country}>{country}</option>
          )}
        </NativeSelect>
        <Input
          id={id}
          ref={ref}
          type="tel"
          inputMode="tel"
          autoComplete="tel-national"
          aria-label={messages.booking.mobile}
          aria-invalid={invalid || undefined}
          aria-describedby={invalid ? errorId(id) : undefined}
          value={national}
          onChange={(e) => {
            setNational(e.target.value);
            emit(country, e.target.value);
          }}
          onBlur={onBlur}
          className="bg-card"
        />
      </div>
      <FieldError id={errorId(id)}>{error}</FieldError>
    </fieldset>
  );
}
