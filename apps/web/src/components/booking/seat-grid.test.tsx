import type { OfferPassenger, SeatMap } from '@ota/contracts';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { toggleSeat, type SeatSelection } from '@/lib/seat-selection';
import { SeatGrid } from './seat-grid';

const usd = (amount: string) => ({ amount, currency: 'USD' });
const services = (designator: string, amount: string) => [
  { passengerRef: 'a1', serviceId: `${designator}-a1`, price: usd(amount) },
  { passengerRef: 'a2', serviceId: `${designator}-a2`, price: usd(amount) },
];

const MAP: SeatMap = {
  segmentRef: 'seg1',
  cabins: [
    {
      deck: 0,
      rows: [
        { number: null, sections: [{ elements: [{ type: 'facility', kind: 'lavatory' }] }] },
        {
          number: 14,
          sections: [
            { elements: [{ type: 'exit' }, { type: 'seat', designator: '14A', available: true, services: services('14A', '0.00') }, { type: 'seat', designator: '14C', available: true, services: services('14C', '20.00') }] },
            { elements: [{ type: 'seat', designator: '14D', available: false, services: [] }, { type: 'seat', designator: '14F', available: true, services: services('14F', '0.00') }, { type: 'exit' }] },
          ],
        },
      ],
    },
  ],
};

const adult1: OfferPassenger = { ref: 'a1', type: 'adult' };
const adult2: OfferPassenger = { ref: 'a2', type: 'adult' };

function Harness({ passenger, initial = {} }: { passenger: OfferPassenger; initial?: SeatSelection }) {
  const [selection, setSelection] = useState(initial);
  return <SeatGrid map={MAP} passenger={passenger} selection={selection} onToggle={(s) => setSelection(toggleSeat(selection, 'seg1', passenger, s))} />;
}

describe('SeatGrid', () => {
  it('renders every seat as a button with position, price and availability', () => {
    render(<Harness passenger={adult1} />);
    expect(screen.getByRole('button', { name: 'Seat 14A, window, free, available' })).toBeEnabled();
    expect(screen.getByRole('button', { name: /^Seat 14C, aisle, 20\.00 US dollars, available$/ })).toHaveAttribute('data-status', 'paid');
    expect(screen.getByRole('button', { name: 'Seat 14D, aisle, unavailable' })).toBeDisabled();
    expect(screen.getAllByText('Exit')).toHaveLength(2);
    expect(screen.getByText('Toilet')).toBeInTheDocument();
  });

  it('selecting marks the seat pressed; a second seat replaces the first', async () => {
    const user = userEvent.setup();
    render(<Harness passenger={adult1} />);
    await user.click(screen.getByRole('button', { name: /^Seat 14A/ }));
    expect(screen.getByRole('button', { name: /^Seat 14A.*selected$/ })).toHaveAttribute('aria-pressed', 'true');
    await user.click(screen.getByRole('button', { name: /^Seat 14F/ }));
    expect(screen.getByRole('button', { name: /^Seat 14F.*selected$/ })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('button', { name: /^Seat 14A.*available$/ })).toHaveAttribute('aria-pressed', 'false');
  });

  it("another passenger's seat is shown as taken and disabled", () => {
    const initial: SeatSelection = { seg1: { a1: { serviceId: '14C-a1', label: 'Seat 14C', price: usd('20.00') } } };
    render(<Harness passenger={adult2} initial={initial} />);
    expect(screen.getByRole('button', { name: 'Seat 14C, aisle, taken by another passenger' })).toBeDisabled();
  });
});
