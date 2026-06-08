'use client';

import { useEffect } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';

export default function LegacyInboxHistoryPage() {
  const router = useRouter();

  useEffect(() => {
    router.replace('/capture/history');
  }, [router]);

  return (
    <main className="min-h-screen bg-background text-foreground">
      <div className="mx-auto flex min-h-screen max-w-md flex-col items-center justify-center gap-3 px-6 text-center">
        <p className="text-sm text-muted-foreground">Opening capture history...</p>
        <Link href="/capture/history" className="text-sm text-[var(--amber)] hover:underline">
          Go to capture history
        </Link>
      </div>
    </main>
  );
}
