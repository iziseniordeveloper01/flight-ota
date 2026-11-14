export interface AirportValue {
  iataCode: string;
  city: string | null;
}

/** "Delhi (DEL)", or just the code when the city is unknown (e.g. opened from a URL). */
export function airportLabel(a: AirportValue): string {
  return a.city ? `${a.city} (${a.iataCode})` : a.iataCode;
}
