import type { CallOptions } from './types.js';

export const DEFAULT_TIMEOUT_MS = 30_000;

/**
 * One signal that fires on caller abort OR when the deadline passes. Pass it straight to fetch()
 * so the HTTP request is actually cancelled, not just abandoned.
 * A timeout aborts with a DOMException named "TimeoutError"; a caller abort with "AbortError".
 */
export function callSignal(opts: CallOptions = {}): AbortSignal {
  const timeout = AbortSignal.timeout(opts.timeoutMs ?? DEFAULT_TIMEOUT_MS);
  return opts.signal ? AbortSignal.any([opts.signal, timeout]) : timeout;
}

/** True for errors produced by an aborted/timed-out signal (fetch rethrows the signal's reason). */
export function isAbortError(err: unknown): boolean {
  return err instanceof Error && (err.name === 'AbortError' || err.name === 'TimeoutError');
}
