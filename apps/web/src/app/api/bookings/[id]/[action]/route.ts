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
  'payment-order': 'POST',
  'payment-verify': 'POST',
} as const;
type Action = keyof typeof ACTIONS;
// Actions whose JSON body is passed through (validated by the API with the contract schema).
const WITH_BODY: ReadonlySet<Action> = new Set(['details', 'payment-verify']);

// Confirming can take ~2 minutes at the airline.
export const maxDuration = 180;

async function handle(request: NextRequest, { params }: RouteContext<'/api/bookings/[id]/[action]'>) {
  const { id, action } = await params;
  if (!Object.hasOwn(ACTIONS, action)) return jsonError(404, 'Not found');
  if (ACTIONS[action as Action] !== request.method) return jsonError(405, 'Method not allowed');
  const forbidden = rejectCrossOrigin(request);
  if (forbidden) return forbidden;

  const withBody = WITH_BODY.has(action as Action);
  const headers: Record<string, string> = {};
  if (withBody) headers['Content-Type'] = 'application/json';
  // Generated here, never by the browser: the same booking always confirms with the same key.
  if (action === 'confirm-demo') headers['Idempotency-Key'] = confirmIdempotencyKey(id);

  try {
    const res = await bookingFetch(id, `/${action as Action}`, {
      method: request.method,
      headers,
      body: withBody ? await request.text() : undefined,
      timeoutMs: action === 'confirm-demo' ? CONFIRM_TIMEOUT_MS : undefined,
    });
    return res ? passThrough(res) : bookingNotFound();
  } catch (err) {
    return upstreamFailure(err);
  }
}

export { handle as GET, handle as POST, handle as PUT };
