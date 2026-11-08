'use client';
import Link from 'next/link';
import { ArrowRight, BookOpen } from 'lucide-react';
import { buttonVariants } from '@/components/ui/button';
import { useLocale } from '@/lib/stores/locale-store';

export default function EchoLearningEntry() {
  const { t } = useLocale(); const p = t.echoLearning.workspace;
  return <aside className="flex flex-wrap items-center justify-between gap-4 border-y border-border py-5">
    <div className="flex min-w-0 flex-1 items-start gap-3">
      <BookOpen size={18} className="mt-1 shrink-0 text-[var(--amber)]" aria-hidden />
      <div><h2 className="text-sm font-medium">{p.entryTitle}</h2><p className="mt-1 text-sm leading-6 text-muted-foreground">{p.entryHint}</p></div>
    </div>
    <Link href="/echo/learning" className={buttonVariants({ variant: 'outline', className: 'min-h-11' })}>{p.open}<ArrowRight aria-hidden /></Link>
  </aside>;
}
