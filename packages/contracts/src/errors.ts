/** One field problem in a 400 response; `path` is dotted ("returnDate", "passengers.0.name"). */
export interface ValidationIssue {
  path: string;
  message: string;
}

/** Error body shape returned by the API (Nest exception filter + ZodValidationPipe). */
export interface ApiErrorBody {
  statusCode?: number;
  message: string | string[];
  error?: string;
  /** Present on 400 validation failures. */
  issues?: ValidationIssue[];
}
