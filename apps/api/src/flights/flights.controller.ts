import { Body, Controller, Get, Header, HttpCode, Param, Post } from '@nestjs/common';
import {
  offerIdSchema,
  searchFlightsSchema,
  type OfferResponse,
  type SearchFlightsBody,
  type SearchFlightsResponse,
} from '@ota/contracts';
import { ZodValidationPipe } from '../common/zod-validation.pipe.js';
import { PricingService } from '../pricing/pricing.service.js';
import { FlightsService } from './flights.service.js';

// Prices are volatile and per-request: every handler sends Cache-Control: no-store
// (@Header is also applied to error responses, which is what we want here).
const NO_STORE = ['Cache-Control', 'no-store'] as const;

@Controller('flights')
export class FlightsController {
  constructor(
    private readonly flights: FlightsService,
    private readonly pricing: PricingService,
  ) {}

  // POST because the search has a structured body; it creates nothing, so 200 not 201.
  // Offers carry `displayPrice` (charge currency) and are sorted by it; 503 FX_UNAVAILABLE when a
  // supplier currency can't be converted.
  @Post('search')
  @HttpCode(200)
  @Header(...NO_STORE)
  async search(
    @Body(new ZodValidationPipe(searchFlightsSchema)) body: SearchFlightsBody,
  ): Promise<SearchFlightsResponse> {
    const { offers, cached, currency } = await this.flights.search(body);
    return {
      data: await this.pricing.publicOffers(offers),
      meta: {
        supplier: this.flights.supplier,
        cached,
        count: offers.length,
        currency,
        displayCurrency: this.pricing.chargeCurrency,
        demo: this.isDemo(),
      },
    };
  }

  // Re-prices a previously returned offer with the supplier.
  @Get('offers/:id')
  @Header(...NO_STORE)
  async getOffer(
    @Param('id', new ZodValidationPipe(offerIdSchema)) id: string,
  ): Promise<OfferResponse> {
    const offer = await this.flights.getOffer(id);
    return {
      data: await this.pricing.publicPricedOffer(offer),
      meta: { supplier: this.flights.supplier, demo: this.isDemo() },
    };
  }

  // Mock and Duffel test mode are not bookable for real; only TBO (later) is production inventory.
  private isDemo(): boolean {
    return this.flights.supplier !== 'tbo';
  }
}
