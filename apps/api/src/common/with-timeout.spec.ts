import { TimeoutError, withTimeout } from './with-timeout.js';

describe('withTimeout', () => {
  it('resolves with the value when the promise settles in time', async () => {
    await expect(withTimeout(Promise.resolve('ok'), 50)).resolves.toBe('ok');
  });

  it('passes through the original rejection', async () => {
    await expect(withTimeout(Promise.reject(new Error('boom')), 50)).rejects.toThrow('boom');
  });

  it('rejects with TimeoutError when the promise is too slow', async () => {
    const never = new Promise<never>(() => {});
    await expect(withTimeout(never, 10, 'slow call')).rejects.toThrow(
      new TimeoutError('slow call', 10),
    );
  });
});
