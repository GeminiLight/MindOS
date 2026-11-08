'use client';
import Link from 'next/link';
import { ArrowUpRight, FlaskConical } from 'lucide-react';
import { useLocale } from '@/lib/stores/locale-store';
import { buttonVariants } from '@/components/ui/button';
export default function ResearchEntry() {
  const { t } = useLocale(); const p = t.echoLearning.workspace;
  return <aside className="flex flex-wrap items-center justify-between gap-3 border-t border-border pt-5">
    <div className="flex min-w-0 flex-1 items-start gap-3">
      <FlaskConical size={18} className="mt-1 shrink-0 text-muted-foreground" aria-hidden />
      <p className="text-sm leading-6 text-muted-foreground">{p.researchHint}</p>
    </div>
    <Link href="/echo/research" className={buttonVariants({ variant: 'ghost', className: 'min-h-11' })}>{p.research}<ArrowUpRight aria-hidden /></Link>
  </aside>;
}
