import type { CabinClass } from '@ota/contracts';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import type { Passengers } from '@/lib/passengers';
import { PassengerPicker } from './passenger-picker';

function Harness() {
  const [value, setValue] = useState<{ passengers: Passengers; cabin: CabinClass }>({
    passengers: { adults: 1, children: 0, infants: 0 },
    cabin: 'economy',
  });
  return <PassengerPicker id="pax" {...value} onChange={setValue} open onOpenChange={() => {}} />;
}

describe('PassengerPicker', () => {
  it('enforces the infant-per-adult rule with an inline hint', async () => {
    const user = userEvent.setup();
    render(<Harness />);

    const addInfant = screen.getByRole('button', { name: 'Add one: Infants' });
    await user.click(addInfant);
    expect(addInfant).toBeDisabled();
    expect(screen.getByText(/one infant per adult/i)).toBeInTheDocument();

    // A second adult lifts the limit.
    await user.click(screen.getByRole('button', { name: 'Add one: Adults' }));
    expect(addInfant).toBeEnabled();
  });

  it('cannot remove the last adult', () => {
    render(<Harness />);
    expect(screen.getByRole('button', { name: 'Remove one: Adults' })).toBeDisabled();
  });

  it('caps seated passengers at 9 and shows the hint', async () => {
    const user = userEvent.setup();
    render(<Harness />);
    const addChild = screen.getByRole('button', { name: 'Add one: Children' });
    for (let i = 0; i < 8; i++) await user.click(addChild);
    expect(addChild).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Add one: Adults' })).toBeDisabled();
    expect(screen.getByText(/up to 9 adults and children/i)).toBeInTheDocument();
  });

  it('changes cabin with the native select', async () => {
    const user = userEvent.setup();
    render(<Harness />);
    await user.selectOptions(screen.getByLabelText('Cabin'), 'business');
    // The trigger sits behind the open modal sheet (aria-hidden), so query it including hidden.
    expect(
      screen.getByRole('button', { name: /Travellers 1 adult · Business/, hidden: true }),
    ).toBeInTheDocument();
  });
});
