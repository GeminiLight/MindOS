'use client';
import Link from 'next/link';
import { useLocale } from '@/lib/stores/locale-store';
import { buttonVariants } from '@/components/ui/button';
export default function ResearchEntry() {
  const { locale } = useLocale(); const zh = locale === 'zh';
  return <aside className="flex flex-wrap items-center justify-between gap-3 border-t border-border pt-4">
    <p className="text-sm leading-6 text-[var(--prose-muted)]">{zh ? '想系统地检验共同成长？先准备问题、条件和评估材料。' : 'Want to study coevolution? Start with questions, conditions and assessment materials.'}</p>
    <Link href="/echo/research" className={buttonVariants({ variant: 'ghost' }) + ' min-h-11'}>{zh ? '研究准备' : 'Research preparation'}</Link>
  </aside>;
}
