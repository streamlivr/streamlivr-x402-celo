import './globals.css';
import type { Metadata } from 'next';
import { API_BASE_URL } from '@/lib/config';

export const metadata: Metadata = {
  title: 'Streamlivr x402: Agent Checkout Demo',
  description:
    'A live x402 demo on Celo. Pay for public data, verify the platform transfer on-chain, and see creator shares in the payout ledger.',
  icons: { icon: '/streamlivr-icon.png' },
};

/**
 * Dark only, deliberately. This is a terminal-adjacent demo that people open
 * next to a block explorer, and one theme means one set of colours to keep
 * honest. `color-scheme` is declared in globals.css so form controls and
 * scrollbars follow.
 */
export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className="dark">
      <head>
        <link rel="preconnect" href={API_BASE_URL} crossOrigin="anonymous" />
      </head>
      <body className="font-sans antialiased">
        {children}
      </body>
    </html>
  );
}
