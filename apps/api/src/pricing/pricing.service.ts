import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { OfferDisplayPrice, PublicOffer } from '@ota/contracts';
import { compareMoney, type FlightOffer, type Money, type PricedOffer } from '@ota/suppliers';
import type { Env } from '../config/env.js';
import { toPublicOffer } from '../flights/public-offer.js';
import { FxService } from './fx.service.js';
import { priceQuote, type FxSnapshot, type Markup, type PriceQuote } from './pricing.js';

/**
 * Supplier Money → what the customer pays (CHARGE_CURRENCY). Markup and FX buffer come from config.
 * Every price that leaves the API in the charge currency is computed here.
 */
@Injectable()
export class PricingService {
  constructor(
    private readonly fx: FxService,
    private readonly config: ConfigService<Env, true>,
  ) {}

  get chargeCurrency(): string {
    return this.config.get('CHARGE_CURRENCY', { infer: true });
  }

  private get markup(): Markup {
    return {
      fixedMinor: BigInt(this.config.get('MARKUP_FIXED_MINOR', { infer: true })),
      percent: this.config.get('MARKUP_PERCENT', { infer: true }),
    };
  }

  /** A quote at today's rate for amounts in `supplierCurrency` (503 FX_UNAVAILABLE when none). */
  async quote(supplierCurrency: string): Promise<PriceQuote> {
    return priceQuote(await this.fx.snapshot(supplierCurrency, this.chargeCurrency), this.markup, this.chargeCurrency);
  }

  /** A quote from a stored snapshot (a booking's): no FX lookup. */
  fromSnapshot(fx: FxSnapshot): PriceQuote {
    return priceQuote(fx, this.markup, this.chargeCurrency);
  }

  /** Offers as they leave the API (supplierRef stripped, displayPrice added), sorted by displayPrice. */
  async publicOffers<T extends FlightOffer>(offers: T[]): Promise<Array<PublicOffer<T>>> {
    const quotes = new Map<string, PriceQuote>();
    for (const currency of new Set(offers.map((o) => o.price.total.currency))) {
      quotes.set(currency, await this.quote(currency));
    }
    const priced = offers.map((offer) => this.publicOffer(offer, quotes.get(offer.price.total.currency)!));
    // Stable: equal display prices keep the supplier order. All in one currency, so comparable.
    return priced.sort((a, b) => compareMoney(a.displayPrice.total, b.displayPrice.total));
  }

  async publicPricedOffer(offer: PricedOffer): Promise<PublicOffer<PricedOffer>> {
    const quote = await this.quote(offer.price.total.currency);
    const previous = offer.previousTotal ? await this.displayFare(offer.previousTotal, quote) : undefined;
    return this.publicOffer(offer, quote, previous);
  }

  /** A fare in the charge currency (e.g. the total the customer saw before a re-price). */
  async displayFare(amount: Money, quote?: PriceQuote): Promise<Money> {
    const q = quote && quote.fx.base === amount.currency ? quote : await this.quote(amount.currency);
    return q.fare(amount).charge;
  }

  private publicOffer<T extends FlightOffer>(offer: T, quote: PriceQuote, previousTotal?: Money): PublicOffer<T> {
    const displayPrice: OfferDisplayPrice = {
      total: quote.fare(offer.price.total).charge,
      ...(previousTotal ? { previousTotal } : {}),
    };
    return { ...toPublicOffer(offer), displayPrice };
  }
}
