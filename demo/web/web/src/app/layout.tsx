import './globals.css';
import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Streamlivr x402: Agent Checkout Demo',
  description:
    'Talk to an agent that pays per request on Celo, and watch Streamlivr settle funds directly to creators.',
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
      <body className="font-sans antialiased">
        {children}
      </body>
    </html>
  );
}
