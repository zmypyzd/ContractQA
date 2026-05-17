import type { ReactNode } from 'react';
import './globals.css';

export const metadata = {
  title: 'ContractQA Dashboard',
  description:
    'Verifies product contracts (not just screenshots), captures full evidence on failure, generates minimal repros.',
};

const GOOGLE_FONTS_HREF =
  'https://fonts.googleapis.com/css2?family=Geist:wght@300;400;500;600;700' +
  '&family=Geist+Mono:wght@400;500' +
  '&family=Instrument+Serif:ital@0;1' +
  '&family=JetBrains+Mono:wght@400;500' +
  '&display=swap';

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en" data-theme="dark" suppressHydrationWarning>
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="" />
        <link rel="stylesheet" href={GOOGLE_FONTS_HREF} />
      </head>
      <body>{children}</body>
    </html>
  );
}
