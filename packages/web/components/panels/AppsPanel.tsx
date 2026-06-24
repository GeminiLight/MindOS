'use client';

import Link from 'next/link';
import {
  ArrowRight,
  BookOpen,
  GraduationCap,
  LayoutGrid,
  Megaphone,
  PenLine,
  Settings2,
  Users,
} from 'lucide-react';
import { useLocale } from '@/lib/stores/locale-store';

interface AppsPanelProps {
  active: boolean;
}

const COPY = {
  en: {
    title: 'Apps',
    subtitle: 'Experimental scenario workspaces.',
    open: 'Open Apps',
    experiments: 'Experiments',
    items: [
      { id: 'research-radar', label: 'Research Radar', icon: BookOpen },
      { id: 'product-launch', label: 'Product Launch', icon: Megaphone },
      { id: 'content-studio', label: 'Content Studio', icon: PenLine },
      { id: 'academy', label: 'Academy', icon: GraduationCap },
      { id: 'relationships', label: 'Relationships', icon: Users },
    ],
  },
  zh: {
    title: '应用',
    subtitle: '实验中的场景工作台。',
    open: '打开应用',
    experiments: '实验设置',
    items: [
      { id: 'research-radar', label: '科研雷达', icon: BookOpen },
      { id: 'product-launch', label: '产品发布', icon: Megaphone },
      { id: 'content-studio', label: '内容创作', icon: PenLine },
      { id: 'academy', label: '学院', icon: GraduationCap },
      { id: 'relationships', label: '关系经营', icon: Users },
    ],
  },
} as const;

export default function AppsPanel({ active }: AppsPanelProps) {
  const { locale } = useLocale();
  const copy = locale === 'zh' ? COPY.zh : COPY.en;

  return (
    <div
      className="flex h-full flex-col bg-background"
      aria-label={copy.title}
      aria-hidden={!active}
    >
      <div className="border-b border-border px-4 py-4">
        <div className="mb-3 flex h-8 w-8 items-center justify-center rounded-lg border border-border/60 bg-[var(--amber-subtle)] text-[var(--amber)]">
          <LayoutGrid size={16} />
        </div>
        <h2 className="text-sm font-semibold text-foreground">{copy.title}</h2>
        <p className="mt-1 text-xs leading-5 text-muted-foreground">{copy.subtitle}</p>
      </div>

      <nav className="min-h-0 flex-1 overflow-y-auto px-2 py-2" aria-label={copy.title}>
        {copy.items.map((item) => {
          const Icon = item.icon;
          return (
            <Link
              key={item.id}
              href="/apps"
              className="hit-target-box flex items-center gap-2.5 rounded-md px-3 py-2 text-sm text-muted-foreground hover:bg-muted hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring"
            >
              <Icon size={15} />
              <span className="min-w-0 truncate">{item.label}</span>
            </Link>
          );
        })}
      </nav>

      <div className="border-t border-border p-2">
        <Link
          href="/apps"
          className="hit-target-box flex items-center justify-between rounded-md px-3 py-2 text-xs font-medium text-foreground hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring"
        >
          <span>{copy.open}</span>
          <ArrowRight size={13} />
        </Link>
        <Link
          href="/settings?tab=navigation"
          className="hit-target-box mt-1 flex items-center gap-2 rounded-md px-3 py-2 text-xs text-muted-foreground hover:bg-muted hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring"
        >
          <Settings2 size={13} />
          <span>{copy.experiments}</span>
        </Link>
      </div>
    </div>
  );
}
