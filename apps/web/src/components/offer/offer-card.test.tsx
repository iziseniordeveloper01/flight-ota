import { render, screen } from '@testing-library/react';
import { offer } from '@/test/fixtures';
import { OfferCard } from './offer-card';

describe('OfferCard', () => {
  it('shows local times, the +1 day marker and stops', () => {
    const o = offer({
      amount: '402.00',
      slices: [{ depart: '2026-12-15T23:30:00', arrive: '2026-12-16T06:10:00', via: ['DXB'] }],
    });
    render(<OfferCard offer={o} travellers={1} onSelect={() => {}} />);
    expect(screen.getByText('23:30')).toBeInTheDocument();
    expect(screen.getByText('06:10')).toBeInTheDocument();
    expect(screen.getByText('+1')).toBeInTheDocument();
    expect(screen.getByText(/1 stop · via DXB/)).toBeInTheDocument();
    expect(screen.getByText('· total price')).toBeInTheDocument();
  });

  it('labels the total for multiple travellers', () => {
    render(<OfferCard offer={offer({ amount: '402.00' })} travellers={3} onSelect={() => {}} />);
    expect(screen.getByText('₹402.00')).toBeInTheDocument(); // the INR display price
    expect(screen.getByText('· total for 3 travellers')).toBeInTheDocument();
  });

  it('shows both slices of a round trip', () => {
    const o = offer({ slices: [{}, { from: 'BOM', to: 'DEL' }] });
    render(<OfferCard offer={o} travellers={1} onSelect={() => {}} />);
    expect(screen.getByText('Outbound')).toBeInTheDocument();
    expect(screen.getByText('Return')).toBeInTheDocument();
  });

  it('shows "Operated by" once when another airline flies segments', () => {
    const AA = { code: 'AA', name: 'American Airlines' };
    const o = offer({ slices: [{ via: ['DXB'], operatedBy: AA }, { from: 'BOM', to: 'DEL', operatedBy: AA }] });
    render(<OfferCard offer={o} travellers={1} onSelect={() => {}} />);
    expect(screen.getAllByText('Operated by American Airlines')).toHaveLength(1);
  });

  it('has no "Operated by" line when the owner flies the whole trip', () => {
    render(<OfferCard offer={offer()} travellers={1} onSelect={() => {}} />);
    expect(screen.queryByText(/Operated by/)).not.toBeInTheDocument();
  });

  it('shows the airline logo fallback next to the name', () => {
    render(<OfferCard offer={offer({ owner: 'BA' })} travellers={1} onSelect={() => {}} />);
    expect(screen.getByTestId('airline-logo-fallback')).toHaveTextContent('BA');
    expect(screen.getByRole('heading', { name: 'Airline BA' })).toBeInTheDocument();
  });
});
