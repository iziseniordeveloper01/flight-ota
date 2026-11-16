import type { CreateBookingResponse } from '@ota/contracts';
import { NextResponse, type NextRequest } from 'next/server';
import { apiFetch } from '@/server/booking-api';
import { bookingCookieName, bookingCookieOptions } from '@/server/booking-cookie';
import { passThrough, rejectCrossOrigin, upstreamFailure } from '@/server/bff';
import { serverEnv } from '@/server/env';

/**
 * POST /api/bookings { offerId } → API create. The guest token goes into an httpOnly cookie and is
 * removed from the body: browser JS never sees it.
 */
export async function POST(request: NextRequest) {
  const forbidden = rejectCrossOrigin(request);
  if (forbidden) return forbidden;

  let res: Response;
  try {
    res = await apiFetch('/bookings', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: await request.text(), // the API validates it (createBookingSchema)
    });
  } catch (err) {
    return upstreamFailure(err);
  }
  if (res.status !== 201) return passThrough(res);

  const { data, meta } = (await res.json()) as CreateBookingResponse;
  const { guestToken, ...publicMeta } = meta;
  const response = NextResponse.json({ data, meta: publicMeta }, { status: 201, headers: { 'Cache-Control': 'no-store' } });
  response.cookies.set(bookingCookieName(data.id), guestToken, bookingCookieOptions(serverEnv.NODE_ENV === 'production'));
  return response;
}
