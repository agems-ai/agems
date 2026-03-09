import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'AGEMS — Agent Management System',
  description: 'Operating system for AI-native businesses',
  icons: {
    icon: [
      { url: '/favicon.svg', type: 'image/svg+xml' },
      { url: '/favicon.ico', sizes: '32x32' },
    ],
    apple: '/favicon.png',
  },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
