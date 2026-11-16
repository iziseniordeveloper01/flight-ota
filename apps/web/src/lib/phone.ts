import {
  getCountries,
  getCountryCallingCode,
  parsePhoneNumberFromString,
  type CountryCode,
} from 'libphonenumber-js/min';

// Phone number helpers. This module pulls in libphonenumber metadata (~80 kB), so components load
// it with import() only when the contact form is shown.

/** "IN" + "98765 43210" → "+919876543210"; null when not a valid number for that country. */
export function toE164(country: string, national: string): string | null {
  const digits = national.trim();
  if (!digits) return null;
  const parsed = parsePhoneNumberFromString(digits, country as CountryCode);
  return parsed?.isValid() ? parsed.number : null;
}

/** "+919876543210" → { country: "IN", national: "9876543210" } (for restoring a saved number). */
export function fromE164(e164: string): { country: string; national: string } | null {
  const parsed = parsePhoneNumberFromString(e164);
  if (!parsed?.country) return null;
  return { country: parsed.country, national: parsed.nationalNumber };
}

export function isPhoneCountry(code: string): boolean {
  return (getCountries() as string[]).includes(code);
}

/** Every country libphonenumber knows, with its calling code ("IN" → "91"). */
export function callingCodes(): Array<{ country: string; code: string }> {
  return getCountries().map((country) => ({ country, code: getCountryCallingCode(country) }));
}
