import type { ReactNode } from 'react';
export const metadata = { title: 'ContractQA fixture' };
export default function Layout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body style={{ fontFamily: 'system-ui', padding: 24 }}>{children}</body>
    </html>
  );
}
