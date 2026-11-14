// The SDK ships its types as ambient `declare module '@duffel/api/types'` blocks inside one
// typings file. Referencing the package pulls that file into the program so the import below
// resolves under NodeNext. Type-only: nothing from @duffel/api is loaded at runtime.
// INTERNAL to src/duffel/* — never re-export these from the package index.
/// <reference types="@duffel/api" />
export type {
  ApiResponseError,
  CreateOfferRequest,
  CreateOfferRequestPassenger,
  FlightsCondition,
  Offer,
  OfferRequest,
  OfferSlice,
  OfferSliceSegment,
} from '@duffel/api/types';
