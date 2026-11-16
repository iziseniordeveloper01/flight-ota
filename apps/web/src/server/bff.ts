import 'server-only';
import { NextResponse, type NextRequest } from 'next/server';
import { isAllowedOrigin } from './csrf';
import { serverEnv } from './env';

// Response helpers for the /api/bookings route handlers.

const NO_STORE = { 'Cache-Control': 'no-store' };

/** Same status and JSON body as the API (errors included), never cached. */
export async function passThrough(res: Response): Promise<NextResponse> {
  return new NextResponse(await res.text(), {
    status: res.status,
    headers: { ...NO_STORE, 'Content-Type': res.headers.get('content-type') ?? 'application/json' },
  });
}

export function jsonError(status: number, message: string): NextResponse {
  return NextResponse.json({ statusCode: status, message }, { status, headers: NO_STORE });
}

/** Missing cookie looks exactly like an unknown booking (the API answers the same for a bad token). */
export const bookingNotFound = () => jsonError(404, 'Booking not found');

/** 403 for a mutating request from another origin (or without Origin); null when allowed. */
export function rejectCrossOrigin(request: NextRequest): NextResponse | null {
  return isAllowedOrigin(request, serverEnv.WEB_ORIGIN) ? null : jsonError(403, 'Forbidden');
}

/** Upstream unreachable / timed out: answer like the API would (504 / 502). */
export function upstreamFailure(err: unknown): NextResponse {
  const timedOut = err instanceof DOMException && err.name === 'TimeoutError';
  return jsonError(timedOut ? 504 : 502, timedOut ? 'Upstream timeout' : 'Upstream unavailable');
}
