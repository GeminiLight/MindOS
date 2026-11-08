'use client';
import { ArrowLeft, FileText, FolderOpen, ChevronDown } from 'lucide-react';
import { usePathname, useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { useLocale } from '@/lib/stores/locale-store';
import { useViewsIndex } from '@/lib/views/hooks';
import { contextHref } from '@/lib/context-work/continuity';
import type { HandoffOrigin } from '@/lib/context-work/handoff-origin';

/** This is the prepared handoff's provenance, not the Agent's live attachment state. */
export default function ContextOriginBar({ origin, close }: { origin: HandoffOrigin; close?: () => void }) {
  const { locale } = useLocale();
  const zh = locale === 'zh';
  const pathname = usePathname();
  const router = useRouter();
  const index = useViewsIndex();
  if (index.error) return <div role="alert" className="flex items-center justify-between gap-2 border-b border-border px-4 py-3 text-xs text-muted-foreground">
    <p>{zh ? '暂时无法核对 Context 来源。' : 'Could not verify the Context origin.'}</p>
    <Button variant="ghost" size="sm" onClick={index.refresh}>{zh ? '重试' : 'Retry'}</Button>
  </div>;
  if (!index.data) return <p role="status" className="border-b border-border px-4 py-3 text-xs text-muted-foreground">{zh ? '正在核对 Context 来源…' : 'Checking Context origin…'}</p>;
  if (index.data.rootId !== origin.rootId) return <p role="status" className="border-b border-border px-4 py-3 text-xs text-muted-foreground">{zh ? '资料库已切换。交接来源属于原资料库。' : 'The library changed. This handoff belongs to the previous library.'}</p>;
  function returnTo(path?: string) {
    const href = contextHref({ ...origin.position, ...(path ? { mode: 'files', file: path } : {}) });
    close?.();
    if (href.split('?')[0] === pathname) window.history.replaceState(null, '', href);
    else router.push(href, { scroll: false });
  }
  return <section aria-label={zh ? '本次 Context' : 'Handoff Context'} className="shrink-0 border-b border-border bg-muted/20 px-4 py-3">
    <div className="flex items-start justify-between gap-2">
      <div className="min-w-0">
        <p className="flex items-center gap-2 text-sm font-medium"><FolderOpen size={14} className="shrink-0 text-muted-foreground" /><span className="truncate">{origin.title}</span></p>
        <p title={origin.folder} className="mt-1 truncate text-xs text-muted-foreground">{origin.folder}</p>
      </div>
      <Button variant="ghost" size="sm" onClick={() => returnTo()}><ArrowLeft size={13} />{zh ? '回到资料' : 'Back to Context'}</Button>
    </div>
    <details className="group mt-2 text-xs">
      <summary className="flex cursor-pointer list-none items-center gap-2 rounded py-1 text-muted-foreground focus-visible:ring-2 focus-visible:ring-ring">
        <ChevronDown size={12} className="shrink-0 transition-transform duration-150 group-open:rotate-180" />
        {zh ? `本次交接清单 · ${origin.items.length} 项资料` : `Handoff receipt · ${origin.items.length} items`}
      </summary>
      <ul className="mt-1 max-h-32 space-y-1 overflow-y-auto">
        {origin.items.map(item => <li key={item.id}>
          <button aria-label={`${zh ? '查看' : 'Read'} ${item.label}`} title={item.path}
            className="flex min-h-8 w-full items-center gap-2 rounded px-2 text-left hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring"
            onClick={() => returnTo(item.path)}><FileText size={13} className="shrink-0 text-muted-foreground" /><span className="truncate">{item.label}</span></button>
        </li>)}
      </ul>
    </details>
  </section>;
}
