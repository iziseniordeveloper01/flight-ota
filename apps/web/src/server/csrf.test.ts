import { isAllowedOrigin } from './csrf';

const req = (method: string, origin?: string) => ({
  method,
  headers: new Headers(origin === undefined ? {} : { origin }),
});
const SELF = 'http://localhost:3000';

describe('isAllowedOrigin', () => {
  it('lets safe methods through without an Origin', () => {
    expect(isAllowedOrigin(req('GET'), SELF)).toBe(true);
    expect(isAllowedOrigin(req('HEAD', 'https://evil.example'), SELF)).toBe(true);
  });

  it('accepts POST/PUT from our own origin', () => {
    expect(isAllowedOrigin(req('POST', SELF), SELF)).toBe(true);
    expect(isAllowedOrigin(req('put', SELF), `${SELF}/`)).toBe(true);
  });

  it.each([
    ['missing Origin', undefined],
    ['opaque "null" Origin', 'null'],
    ['another site', 'https://evil.example'],
    ['same host, other port', 'http://localhost:3001'],
    ['same host, other scheme', 'https://localhost:3000'],
    ['look-alike subdomain', 'http://localhost:3000.evil.example'],
    ['garbage', 'not a url'],
  ])('rejects a mutation with %s', (_name, origin) => {
    expect(isAllowedOrigin(req('POST', origin), SELF)).toBe(false);
    expect(isAllowedOrigin(req('PUT', origin), SELF)).toBe(false);
  });
});
