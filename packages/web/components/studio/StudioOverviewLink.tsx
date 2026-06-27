'use client';

import Link from 'next/link';
import { ChevronLeft } from 'lucide-react';
import { buttonVariants } from '@/components/ui/button';
import { cn } from '@/lib/utils';

const COPY = {
  en: {
    label: 'Overview',
    ariaLabel: 'Back to Overview',
  },
  zh: {
    label: '总览',
    ariaLabel: '返回总览',
  },
} as const;

export function StudioOverviewLink({ locale }: { locale: string }) {
  const copy = locale === 'zh' ? COPY.zh : COPY.en;

  return (
    <Link
      href="/studio"
      aria-label={copy.ariaLabel}
      data-studio-back-overview
      className={cn(
        buttonVariants({ variant: 'ghost', size: 'sm' }),
        '-ml-2 w-fit text-muted-foreground',
      )}
    >
      <ChevronLeft size={15} strokeWidth={1.8} aria-hidden="true" />
      {copy.label}
    </Link>
  );
}
