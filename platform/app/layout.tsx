import './globals.css';
import type { Metadata } from 'next';
import { Inter } from 'next/font/google';
import localFont from 'next/font/local';
import { ScrollMotion } from '@/components/scroll-motion';
import { DoodleField } from '@/components/doodles';

const inter = Inter({
  subsets: ['latin'],
  weight: ['400', '500', '600', '700'],
  variable: '--font-inter',
  display: 'swap',
});

// Brand typeface (Fynd Sans, variable) — primary font across the product.
const fynd = localFont({
  src: './fonts/FyndSans.ttf',
  variable: '--font-fynd',
  display: 'swap',
});

const SITE_URL = 'https://influencer-intel-platform.vercel.app';
const SITE_DESC =
  'India’s AI-native influencer marketing platform — discover credibility-scored creators, predict campaign performance, run outreach, and manage payouts, all in one place.';

export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  title: {
    default: 'Influencer Intel — Discover, Predict, Monitor',
    template: '%s · Influencer Intel',
  },
  description: SITE_DESC,
  applicationName: 'Influencer Intel',
  keywords: [
    'influencer marketing',
    'creator discovery',
    'India influencers',
    'influencer database',
    'campaign management',
    'influencer analytics',
    'creator payouts',
    'influencer outreach',
  ],
  authors: [{ name: 'Influencer Intel' }],
  alternates: { canonical: '/' },
  openGraph: {
    type: 'website',
    siteName: 'Influencer Intel',
    title: 'Influencer Intel — Discover, Predict, Monitor',
    description: SITE_DESC,
    url: SITE_URL,
    locale: 'en_IN',
  },
  twitter: {
    card: 'summary_large_image',
    title: 'Influencer Intel — Discover, Predict, Monitor',
    description: SITE_DESC,
  },
  robots: { index: true, follow: true },
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" className={`${inter.variable} ${fynd.variable}`}>
      <body className="antialiased min-h-screen bg-white text-[#111] font-sans">
        <ScrollMotion />
        <DoodleField />
        {children}
      </body>
    </html>
  );
}
