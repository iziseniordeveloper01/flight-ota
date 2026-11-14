import { escapeLike } from './escape-like.js';

describe('escapeLike', () => {
  it('escapes % and _', () => {
    expect(escapeLike('50%_off')).toBe('50\\%\\_off');
  });

  it('escapes backslash', () => {
    expect(escapeLike('a\\b')).toBe('a\\\\b');
  });

  it('leaves normal text unchanged', () => {
    expect(escapeLike('New Delhi')).toBe('New Delhi');
  });
});
