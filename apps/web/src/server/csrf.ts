// CSRF defence for the booking BFF. The guest-token cookie is SameSite=Lax, which already stops
// cross-site POSTs in modern browsers; this check also covers older browsers and same-site
// subdomains. Browsers always send Origin on POST/PUT/DELETE fetches, so a missing one is rejected.

const MUTATING = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

/** true when the request may proceed: a safe method, or a mutation from exactly `allowedOrigin`. */
export function isAllowedOrigin(request: Pick<Request, 'method' | 'headers'>, allowedOrigin: string): boolean {
  if (!MUTATING.has(request.method.toUpperCase())) return true;
  const origin = request.headers.get('origin');
  if (!origin || origin === 'null') return false;
  try {
    return new URL(origin).origin === new URL(allowedOrigin).origin;
  } catch {
    return false;
  }
}
