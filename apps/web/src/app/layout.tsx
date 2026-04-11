import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'AGEMS · Agent Management System',
  description:
    'The operating system for AI-native businesses. Create, manage, and orchestrate autonomous AI agents with real-time collaboration, multi-LLM support, and human-in-the-loop control.',
  icons: {
    icon: [
      { url: '/favicon.svg', type: 'image/svg+xml' },
      { url: '/favicon.ico', sizes: '32x32' },
    ],
    apple: '/favicon.png',
  },
  openGraph: {
    title: 'AGEMS · Agent Management System',
    description:
      'The operating system for AI-native businesses. Create, manage, and orchestrate autonomous AI agents.',
    url: 'https://agems.ai',
    siteName: 'AGEMS',
    images: [
      {
        url: 'https://agems.ai/og-image.png',
        width: 1200,
        height: 630,
        alt: 'AGEMS · Agent Management System',
      },
    ],
    type: 'website',
    locale: 'en_US',
  },
  twitter: {
    card: 'summary_large_image',
    title: 'AGEMS · Agent Management System',
    description:
      'The operating system for AI-native businesses. Create, manage, and orchestrate autonomous AI agents.',
    images: ['https://agems.ai/og-image.png'],
  },
  metadataBase: new URL('https://agems.ai'),
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
