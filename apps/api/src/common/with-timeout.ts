export class TimeoutError extends Error {
  constructor(label: string, ms: number) {
    super(`${label} timed out after ${ms}ms`);
    this.name = 'TimeoutError';
  }
}

// Rejects with TimeoutError if `promise` doesn't settle within `ms`.
// Note: this stops *waiting*, it cannot cancel the underlying work.
export async function withTimeout<T>(
  promise: Promise<T>,
  ms: number,
  label = 'operation',
): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new TimeoutError(label, ms)), ms);
  });

  try {
    // Promise.race subscribes to `promise`, so a late rejection after the timeout
    // is still handled and never becomes an unhandledRejection.
    return await Promise.race([promise, timeout]);
  } finally {
    // Always clear, otherwise every fast call leaves a live timer that keeps
    // the event loop busy and delays shutdown.
    clearTimeout(timer);
  }
}
