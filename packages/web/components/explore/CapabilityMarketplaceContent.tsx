'use client';

import Link from 'next/link';
import {
  ArrowLeft,
  Blocks,
  Compass,
  LayoutTemplate,
  Lightbulb,
  Server,
  Zap,
} from 'lucide-react';
import { useLocale } from '@/lib/stores/locale-store';

const marketplaceEntries = [
  {
    title: 'Skill Market',
    description: 'Reusable agent skills for project work, review, research, writing, and debugging.',
    href: '/explore/skills',
    icon: Zap,
    meta: 'Agent skills',
  },
  {
    title: 'MCP Servers',
    description: 'Discovery surface for external tools, knowledge sources, and runtime bridges.',
    href: '/explore/mcp',
    icon: Server,
    meta: 'Tool bridges',
  },
  {
    title: 'Plugin Market',
    description: 'Community plugins for rendering, local workflows, and knowledge-base surfaces.',
    href: '/explore/plugins',
    icon: Blocks,
    meta: 'Workspace plugins',
  },
  {
    title: 'Use Cases',
    description: 'Concrete MindOS workflows that can be tried from the Ask surface.',
    href: '/explore',
    icon: Lightbulb,
    meta: 'Scenario library',
  },
];

export default function CapabilityMarketplaceContent() {
  const { t } = useLocale();
  const copy = t.panels.discover;

  return (
    <main className="min-h-full bg-background text-foreground">
      <div className="content-width px-4 py-8 md:px-6 md:py-10">
        <header className="mb-6">
          <Link
            href="/explore"
            className="mb-3 inline-flex h-8 items-center gap-1.5 rounded-md px-2 text-xs font-medium text-muted-foreground transition-colors hover:bg-muted/60 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <ArrowLeft size={14} />
            {copy.useCases}
          </Link>
          <div className="flex items-center gap-2">
            <div className="h-5 w-1 rounded-full bg-[var(--amber)]" />
            <h1 className="text-2xl font-semibold tracking-tight text-foreground">
              {copy.capabilityMarketplace}
            </h1>
          </div>
          <p className="mt-3 max-w-3xl pl-4 text-sm leading-relaxed text-muted-foreground">
            {copy.capabilityMarketplaceDesc}
          </p>
        </header>

        <section
          data-capability-market-grid="true"
          className="grid grid-cols-1 gap-3 md:grid-cols-2"
        >
          {marketplaceEntries.map((entry) => {
            const Icon = entry.icon;
            return (
              <Link
                key={entry.href}
                href={entry.href}
                className="group rounded-lg border border-border/70 bg-card/65 p-4 transition-colors hover:border-[var(--amber)]/45 hover:bg-muted/35 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                <div className="flex items-start gap-3">
                  <span className="mt-0.5 inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-md border border-border bg-background text-muted-foreground group-hover:text-[var(--amber)]">
                    <Icon size={17} />
                  </span>
                  <span className="min-w-0">
                    <span className="block text-sm font-semibold text-foreground">{entry.title}</span>
                    <span className="mt-1 block text-xs leading-relaxed text-muted-foreground">{entry.description}</span>
                    <span className="mt-3 inline-flex h-6 items-center gap-1.5 rounded-md border border-border bg-background px-2 font-mono text-2xs text-muted-foreground">
                      <Compass size={11} />
                      {entry.meta}
                    </span>
                  </span>
                </div>
              </Link>
            );
          })}
        </section>
      </div>
    </main>
  );
}
