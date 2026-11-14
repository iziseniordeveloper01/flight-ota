import type { Metadata, Viewport } from 'next';
import { Inter } from 'next/font/google';
import type { ReactNode } from 'react';
import { SiteFooter } from '@/components/site-footer';
import { SiteHeader } from '@/components/site-header';
import { env } from '@/env';
import { messages } from '@/lib/messages';
import { Providers } from './providers';
import './globals.css';

// Self-hosted by next/font at build time: no request to Google from the browser, no layout shift.
const sans = Inter({ subsets: ['latin'], display: 'swap', variable: '--font-brand-sans' });

export const metadata: Metadata = {
  title: {
    default: `${env.NEXT_PUBLIC_BRAND_NAME} · ${messages.meta.tagline}`,
    template: `%s · ${env.NEXT_PUBLIC_BRAND_NAME}`,
  },
  description: messages.meta.description,
  applicationName: env.NEXT_PUBLIC_BRAND_NAME,
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  // Pinch-zoom stays enabled (accessibility); inputs use 16px text so iOS does not auto-zoom.
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en" className={sans.variable}>
      <body className="flex min-h-dvh flex-col">
        <a
          href="#main"
          className="sr-only focus:not-sr-only focus:fixed focus:top-2 focus:left-2 focus:z-100 focus:rounded-md focus:bg-card focus:px-4 focus:py-3"
        >
          {messages.nav.skipToContent}
        </a>
        <Providers>
          <SiteHeader />
          <main id="main" className="flex-1">
            {children}
          </main>
          <SiteFooter />
        </Providers>
      </body>
    </html>
  );
}
