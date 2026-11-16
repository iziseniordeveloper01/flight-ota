import type { NextRequest } from 'next/server';
import { bookingFetch, CONFIRM_TIMEOUT_MS } from '@/server/booking-api';
import { confirmIdempotencyKey } from '@/server/booking-cookie';
import { bookingNotFound, jsonError, passThrough, rejectCrossOrigin, upstreamFailure } from '@/server/bff';

// Closed allow-list: only these booking endpoints are proxied, each with exactly one method.
const ACTIONS = {
  ancillaries: 'GET',
  'seat-maps': 'GET',
  details: 'PUT',
  checkout: 'POST',
  'confirm-demo': 'POST',
} as const;
type Action = keyof typeof ACTIONS;

// Confirming can take ~2 minutes at the airline.
export const maxDuration = 180;

async function handle(request: NextRequest, { params }: RouteContext<'/api/bookings/[id]/[action]'>) {
  const { id, action } = await params;
  if (!Object.hasOwn(ACTIONS, action)) return jsonError(404, 'Not found');
  if (ACTIONS[action as Action] !== request.method) return jsonError(405, 'Method not allowed');
  const forbidden = rejectCrossOrigin(request);
  if (forbidden) return forbidden;

  const headers: Record<string, string> = {};
  if (request.method === 'PUT') headers['Content-Type'] = 'application/json';
  // Generated here, never by the browser: the same booking always confirms with the same key.
  if (action === 'confirm-demo') headers['Idempotency-Key'] = confirmIdempotencyKey(id);

  try {
    const res = await bookingFetch(id, `/${action as Action}`, {
      method: request.method,
      headers,
      body: request.method === 'PUT' ? await request.text() : undefined,
      timeoutMs: action === 'confirm-demo' ? CONFIRM_TIMEOUT_MS : undefined,
    });
    return res ? passThrough(res) : bookingNotFound();
  } catch (err) {
    return upstreamFailure(err);
  }
}

export { handle as GET, handle as POST, handle as PUT };
