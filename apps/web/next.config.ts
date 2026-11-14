import { fileURLToPath } from 'node:url';
import { loadEnvConfig } from '@next/env';
import type { NextConfig } from 'next';

// Secrets and config live in the monorepo ROOT .env (project rule), but Next only reads .env files
// from its own folder. Load the root one too; values already set in the process env still win.
loadEnvConfig(fileURLToPath(new URL('../..', import.meta.url)));

const nextConfig: NextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  // NEXT_PUBLIC_* values are inlined at build time, so the Playwright run (API on another port)
  // needs its own build. A separate distDir keeps it from overwriting the normal .next output.
  distDir: process.env.NEXT_DIST_DIR || '.next',
  images: {
    // Airline logos from Duffel only (Carrier.logoUrl). No wildcards: add each supplier's logo host here.
    // Duffel's are SVG, which next/image serves as-is (not via the optimizer); this covers raster ones.
    remotePatterns: [{ protocol: 'https', hostname: 'assets.duffel.com', pathname: '/img/airlines/**' }],
  },
};

export default nextConfig;
