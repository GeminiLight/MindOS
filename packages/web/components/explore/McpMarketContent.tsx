'use client';

import Link from 'next/link';
import {
  ArrowLeft,
  ExternalLink,
  FolderSearch,
  Network,
  Server,
  ShieldCheck,
  Wrench,
} from 'lucide-react';
import { useLocale } from '@/lib/stores/locale-store';

const mcpCategories = [
  {
    title: 'External tools',
    description: 'Connect agents to issue trackers, databases, messaging systems, and automation APIs.',
    icon: Wrench,
  },
  {
    title: 'Knowledge sources',
    description: 'Expose docs, local notes, product systems, and indexed corpora through auditable tools.',
    icon: FolderSearch,
  },
  {
    title: 'Runtime bridges',
    description: 'Route Codex, Claude Code, ACP, and other runtimes through a shared tool boundary.',
    icon: Network,
  },
];

export default function McpMarketContent() {
  const { t } = useLocale();
  const copy = t.panels.discover;

  return (
    <main className="min-h-full bg-background text-foreground">
      <div className="content-width px-4 py-8 md:px-6 md:py-10">
        <header className="mb-6 flex flex-col gap-4 xl:flex-row xl:items-start xl:justify-between">
          <div className="min-w-0">
            <Link
              href="/explore/capabilities"
              className="mb-3 inline-flex h-8 items-center gap-1.5 rounded-md px-2 text-xs font-medium text-muted-foreground transition-colors hover:bg-muted/60 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              <ArrowLeft size={14} />
              {copy.capabilityMarketplace}
            </Link>
            <div className="flex items-center gap-2">
              <div className="h-5 w-1 rounded-full bg-[var(--amber)]" />
              <h1 className="text-2xl font-semibold tracking-tight text-foreground">
                {copy.mcpServers}
              </h1>
            </div>
            <p className="mt-3 max-w-3xl pl-4 text-sm leading-relaxed text-muted-foreground">
              {copy.mcpServersDesc}
            </p>
            <div className="mt-3 flex flex-wrap items-center gap-2 pl-4">
              <span className="inline-flex h-6 items-center gap-1.5 rounded-md border border-border bg-card/60 px-2 font-mono text-2xs text-muted-foreground">
                <Server size={11} />
                Discovery only
              </span>
              <span className="inline-flex h-6 items-center gap-1.5 rounded-md border border-[var(--amber)]/25 bg-[var(--amber-subtle)] px-2 font-mono text-2xs text-[var(--amber-text)]">
                <ShieldCheck size={11} />
                Review before connecting
              </span>
            </div>
          </div>
          <Link
            href="/settings?tab=mcp"
            className="inline-flex h-8 items-center gap-1.5 rounded-md border border-border bg-card px-2.5 text-xs font-medium text-foreground transition-colors hover:border-[var(--amber)]/45 hover:bg-muted/55 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring xl:mt-11"
          >
            <ExternalLink size={13} />
            Manage Connections
          </Link>
        </header>

        <section
          data-mcp-market-grid="true"
          className="grid grid-cols-1 gap-3 lg:grid-cols-3"
        >
          {mcpCategories.map((entry) => {
            const Icon = entry.icon;
            return (
              <article
                key={entry.title}
                className="rounded-lg border border-border/70 bg-card/65 p-4"
              >
                <div className="mb-3 inline-flex h-9 w-9 items-center justify-center rounded-md border border-border bg-background text-[var(--amber)]">
                  <Icon size={17} />
                </div>
                <h2 className="text-sm font-semibold text-foreground">{entry.title}</h2>
                <p className="mt-2 text-xs leading-relaxed text-muted-foreground">{entry.description}</p>
              </article>
            );
          })}
        </section>
      </div>
    </main>
  );
}
