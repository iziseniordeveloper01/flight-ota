import type { NextRequest } from 'next/server';
import { bookingFetch } from '@/server/booking-api';
import { bookingNotFound, passThrough, upstreamFailure } from '@/server/bff';

/** GET /api/bookings/:id (also used for polling while CONFIRMING). */
export async function GET(_request: NextRequest, { params }: RouteContext<'/api/bookings/[id]'>) {
  const { id } = await params;
  try {
    const res = await bookingFetch(id, '');
    return res ? passThrough(res) : bookingNotFound();
  } catch (err) {
    return upstreamFailure(err);
  }
}
