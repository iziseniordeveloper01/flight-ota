import { fireEvent, render, screen } from '@testing-library/react';
import { AirlineLogo } from './airline-logo';

const LOGO = 'https://assets.duffel.com/img/airlines/for-light-background/full-color-logo/BA.svg';

describe('AirlineLogo', () => {
  it('renders a decorative image when a logo URL is present', () => {
    const { container } = render(<AirlineLogo carrier={{ code: 'BA', name: 'British Airways', logoUrl: LOGO }} />);
    const img = container.querySelector('img');
    expect(img).toHaveAttribute('alt', '');
    expect(img?.getAttribute('src')).toContain('BA.svg');
    expect(screen.queryByTestId('airline-logo-fallback')).not.toBeInTheDocument();
  });

  it('falls back to the 2-letter code when there is no logo', () => {
    render(<AirlineLogo carrier={{ code: 'BA', name: 'British Airways' }} />);
    const fallback = screen.getByTestId('airline-logo-fallback');
    expect(fallback).toHaveTextContent('BA');
    expect(fallback).toHaveAttribute('aria-hidden', 'true');
  });

  it('falls back when the image fails to load', () => {
    const { container } = render(<AirlineLogo carrier={{ code: 'BA', name: 'British Airways', logoUrl: LOGO }} />);
    fireEvent.error(container.querySelector('img')!);
    expect(container.querySelector('img')).toBeNull();
    expect(screen.getByTestId('airline-logo-fallback')).toHaveTextContent('BA');
  });

  it('uses the name when the airline has no IATA code', () => {
    render(<AirlineLogo carrier={{ code: '', name: 'duffel airways' }} />);
    expect(screen.getByTestId('airline-logo-fallback')).toHaveTextContent('DU');
  });
});
