import { contactSchema } from '@ota/contracts';
import { callingCodes, fromE164, toE164 } from './phone';

describe('phone → E.164', () => {
  it('formats national numbers with spaces, dashes or a trunk 0', () => {
    expect(toE164('IN', '98765 43210')).toBe('+919876543210');
    expect(toE164('GB', '020 8016 0509')).toBe('+442080160509');
    expect(toE164('US', '(415) 555-2671')).toBe('+14155552671');
  });

  it('accepts a number typed with its own +code', () => {
    expect(toE164('IN', '+44 20 8016 0509')).toBe('+442080160509');
  });

  it('returns null for empty, too short or invalid numbers', () => {
    expect(toE164('IN', '')).toBeNull();
    expect(toE164('IN', '12345')).toBeNull();
    expect(toE164('GB', '0000 000000')).toBeNull();
  });

  it('the result passes the shared contact schema', () => {
    const phone = toE164('IN', '98765 43210')!;
    expect(contactSchema.shape.phone.safeParse(phone).success).toBe(true);
  });

  it('restores country + national number from E.164 and lists calling codes', () => {
    expect(fromE164('+919876543210')).toEqual({ country: 'IN', national: '9876543210' });
    expect(callingCodes()).toContainEqual({ country: 'IN', code: '91' });
  });
});
