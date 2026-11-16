import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ApiError, bookingApi } from '@/lib/api';
import { CheckoutButton } from './checkout-button';

const push = vi.fn();
vi.mock('next/navigation', () => ({ useRouter: () => ({ push, refresh: vi.fn() }) }));

const SEARCH_URL = '/flights/search?from=LHR&to=JFK&depart=2026-12-20&adults=1&children=0&infants=0&cabin=economy';

describe('CheckoutButton', () => {
  afterEach(() => vi.restoreAllMocks());

  it('410 FARE_NO_LONGER_AVAILABLE → message + "Search again" with the original search', async () => {
    vi.spyOn(bookingApi, 'create').mockRejectedValue(
      new ApiError('expired', 410, 'This fare is no longer available. Please search again.', [], {
        statusCode: 410,
        code: 'FARE_NO_LONGER_AVAILABLE',
        message: 'This fare is no longer available. Please search again.',
      }),
    );
    render(<CheckoutButton offerId="mock:abc" searchUrl={SEARCH_URL} />);
    await userEvent.setup().click(screen.getByRole('button', { name: 'Checkout' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('This fare is no longer available. Please search again.');
    expect(screen.getByRole('link', { name: 'Search again' })).toHaveAttribute('href', SEARCH_URL);
    expect(screen.queryByRole('button', { name: 'Checkout' })).not.toBeInTheDocument();
    expect(push).not.toHaveBeenCalled();
  });

  it('success → opens step 1 (with ?was= when the price changed)', async () => {
    vi.spyOn(bookingApi, 'create').mockResolvedValue({
      data: { id: 'b1' },
      meta: { priceChanged: true, previousTotal: { amount: '100.00', currency: 'USD' } },
    } as Awaited<ReturnType<typeof bookingApi.create>>);
    render(<CheckoutButton offerId="mock:abc" searchUrl={SEARCH_URL} />);
    await userEvent.setup().click(screen.getByRole('button', { name: 'Checkout' }));
    expect(push).toHaveBeenCalledWith('/booking/b1?was=100.00');
  });
});
