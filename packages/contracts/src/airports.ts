import { z } from 'zod';

export const searchAirportsQuerySchema = z.object({
  // Min 2: a single letter matches thousands of rows and is useless as a suggestion.
  q: z.string().trim().min(2, 'Type at least 2 characters').max(50),
  // Query strings are always strings, so coerce "3" → 3.
  limit: z.coerce.number().int().min(1).max(20).default(8),
});

export type SearchAirportsQuery = z.infer<typeof searchAirportsQuerySchema>;

export interface AirportSuggestion {
  iataCode: string;
  name: string;
  city: string | null;
  countryCode: string;
  type: string;
}

/** GET /v1/airports */
export interface AirportSearchResponse {
  data: AirportSuggestion[];
}
