import { Controller, Get, Query, Res } from '@nestjs/common';
import type { Response } from 'express';
import { ZodValidationPipe } from '../common/zod-validation.pipe.js';
import {
  searchAirportsQuerySchema,
  type AirportSuggestion,
  type SearchAirportsQuery,
} from './airports.schema.js';
import { AirportsService } from './airports.service.js';

@Controller('airports')
export class AirportsController {
  constructor(private readonly airports: AirportsService) {}

  // GET /v1/airports?q=del&limit=8 — origin/destination autocomplete.
  @Get()
  async search(
    @Query(new ZodValidationPipe(searchAirportsQuerySchema)) query: SearchAirportsQuery,
    // passthrough: Nest still serialises the return value; we only need the response for a header.
    @Res({ passthrough: true }) res: Response,
  ): Promise<{ data: AirportSuggestion[] }> {
    const data = await this.airports.search(query);
    // Public, user-independent data: browsers/CDN may reuse it for an hour. Set here rather than
    // with @Header(), which Nest also applies to 400/500 responses — those must never be cached.
    res.setHeader('Cache-Control', 'public, max-age=3600');
    return { data };
  }
}
