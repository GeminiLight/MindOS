'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import {
  BookOpen,
  GraduationCap,
  LayoutGrid,
  Megaphone,
  PenLine,
  Settings2,
  Users,
} from 'lucide-react';
import PanelHeader from './PanelHeader';
import { PANEL_NAV_STACK_CLASS, PanelNavRow } from './PanelNavRow';
import { useLocale } from '@/lib/stores/locale-store';

interface AppsPanelProps {
  active: boolean;
}

const COPY = {
  en: {
    title: 'Apps',
    overview: 'Overview',
    scenarios: 'Scenarios',
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
    overview: '总览',
    scenarios: '场景',
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
  const pathname = usePathname() ?? '';
  const appsActive = pathname === '/apps' || pathname.startsWith('/apps/');

  return (
    <div
      className={`flex h-full flex-col bg-background ${active ? '' : 'hidden'}`}
      aria-label={copy.title}
      aria-hidden={!active}
    >
      <PanelHeader title={copy.title} />

      <div className="sidebar-scroll-area min-h-0 flex-1 overflow-y-auto">
        <div className={PANEL_NAV_STACK_CLASS}>
          <PanelNavRow
            icon={<LayoutGrid size={14} aria-hidden="true" />}
            title={copy.overview}
            href="/apps"
            active={appsActive}
            activeVariant="rail"
          />
        </div>

        <nav className="border-t border-border/60 px-3 py-3" aria-label={copy.scenarios}>
          <p className="mb-1.5 px-1 text-2xs font-medium uppercase text-muted-foreground/50">
            {copy.scenarios}
          </p>
          <div className="space-y-1">
            {copy.items.map((item) => {
              const Icon = item.icon;
              return (
                <Link
                  key={item.id}
                  href="/apps"
                  className="hit-target-box flex items-center gap-2.5 px-3 py-2 text-sm text-muted-foreground transition-colors hover:bg-muted/45 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring [--hit-target-radius:var(--radius-md)]"
                >
                  <Icon size={15} aria-hidden="true" />
                  <span className="min-w-0 truncate">{item.label}</span>
                </Link>
              );
            })}
          </div>
        </nav>
      </div>

      <div className="shrink-0 border-t border-border px-3 py-2">
        <Link
          href="/settings?tab=navigation"
          className="hit-target-box flex items-center gap-2 px-3 py-2 text-xs text-muted-foreground transition-colors hover:bg-muted/45 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring [--hit-target-radius:var(--radius-md)]"
        >
          <Settings2 size={13} aria-hidden="true" />
          <span>{copy.experiments}</span>
        </Link>
      </div>
    </div>
  );
}
