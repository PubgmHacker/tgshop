import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import { Inter } from 'next/font/google';
import { LANDING_URL } from '../lib/env';
import { getCopy } from '../lib/i18n';
import { Analytics } from '../components/Analytics';
import './globals.css';

const inter = Inter({
  subsets: ['latin', 'cyrillic'],
  display: 'swap',
  variable: '--font-sans',
});

const copy = getCopy('ru');

export const metadata: Metadata = {
  metadataBase: new URL(LANDING_URL),
  title: {
    default: copy.meta.title,
    template: `%s — ${copy.nav.brand}`,
  },
  description: copy.meta.description,
  applicationName: copy.nav.brand,
  openGraph: {
    type: 'website',
    title: copy.meta.ogTitle,
    description: copy.meta.ogDescription,
    url: LANDING_URL,
    siteName: copy.nav.brand,
    images: [{ url: '/og-image.svg', width: 1200, height: 630 }],
  },
  twitter: {
    card: 'summary_large_image',
    title: copy.meta.ogTitle,
    description: copy.meta.ogDescription,
    images: ['/og-image.svg'],
  },
  icons: {
    icon: [{ url: '/favicon.svg', type: 'image/svg+xml' }],
    apple: [{ url: '/favicon.svg', type: 'image/svg+xml' }],
  },
  manifest: '/site.webmanifest',
  alternates: {
    canonical: LANDING_URL,
    languages: {
      ru: `${LANDING_URL}/`,
      en: `${LANDING_URL}/en/`,
    },
  },
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="ru" className={inter.variable}>
      <body className="font-sans antialiased">
        {children}
        <Analytics />
      </body>
    </html>
  );
}
