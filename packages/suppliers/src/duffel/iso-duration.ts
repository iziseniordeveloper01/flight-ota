// Duffel durations look like "PT2H30M" or "P1DT2H5M". Years/months/weeks never appear in flight
// durations (and have no fixed length in minutes), so they are rejected.
const ISO_DURATION = /^P(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+(?:\.\d+)?)S)?)?$/;

export function isoDurationToMinutes(value: string): number {
  const match = ISO_DURATION.exec(value);
  // "P" or "PT" alone match the regex but carry no value.
  if (!match || value === 'P' || value.endsWith('T')) {
    throw new Error(`Unsupported ISO 8601 duration: "${value}"`);
  }
  const [, days = '0', hours = '0', minutes = '0', seconds = '0'] = match;
  return (
    Number(days) * 1440 + Number(hours) * 60 + Number(minutes) + Math.round(Number(seconds) / 60)
  );
}
