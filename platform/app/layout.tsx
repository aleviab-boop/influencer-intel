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

export const metadata: Metadata = {
  title: 'Influencer Intel — Discover, Predict, Monitor',
  description: 'Find the right influencer. Predict their next hit.',
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
