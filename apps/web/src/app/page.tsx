'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { api } from '@/lib/api';

const isViewerMode = process.env.NEXT_PUBLIC_PUBLIC_MODE === 'viewer';

export default function RootPage() {
  const router = useRouter();

  useEffect(() => {
    const token = api.getToken();
    if (isViewerMode) {
      router.replace('/dashboard');
    } else {
      router.replace(token ? '/dashboard' : '/login');
    }
  }, [router]);

  return (
    <div className="min-h-screen flex items-center justify-center">
      <div className="text-[var(--muted)]">Loading...</div>
    </div>
  );
}
