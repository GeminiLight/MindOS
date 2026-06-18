'use client';

import Link from 'next/link';
import {
  ArrowRight,
  BookOpenText,
  Blocks,
  CircleDashed,
  FolderOpen,
  ListChecks,
  Rocket,
  type LucideIcon,
} from 'lucide-react';
import {
  getStudioProjectHref,
  localize,
  localizeList,
  stageLabel,
  type StudioProject,
} from '@/lib/studio-projects';

export type StudioProjectItemDensity = 'default' | 'compact';

function firstKit(project: StudioProject): string {
  return project.kits[0] ?? 'Basic assistant';
}

function stageToneClass(stage: StudioProject['stage']): string {
  if (stage === 'active') return 'border-success/20 bg-success/10 text-success';
  if (stage === 'review') return 'border-[var(--amber)]/20 bg-[var(--amber-subtle)] text-[var(--amber)]';
  return 'border-border/60 bg-muted/45 text-muted-foreground';
}

function projectIcon(project: StudioProject): LucideIcon {
  if (project.stage === 'active') return Rocket;
  if (project.stage === 'review') return BookOpenText;
  return CircleDashed;
}

function contextTokens(project: StudioProject, locale: string): Array<{
  label: string;
  value: string;
  icon: LucideIcon;
}> {
  const kits = localizeList(project.kits, undefined, locale);
  return [
    {
      label: 'Work dir',
      value: localize(project.workArea, project.workAreaZh, locale),
      icon: FolderOpen,
    },
    {
      label: 'Mind Space',
      value: localize(project.space, project.spaceZh, locale),
      icon: BookOpenText,
    },
    {
      label: 'AI Kit',
      value: kits.length ? kits.join(' / ') : firstKit(project),
      icon: Blocks,
    },
  ];
}

export function StudioContextBraid({
  project,
  locale,
  density = 'default',
}: {
  project: StudioProject;
  locale: string;
  density?: StudioProjectItemDensity;
}) {
  return (
    <div data-studio-context-braid className={`flex min-w-0 flex-wrap items-center ${
      density === 'compact' ? 'gap-x-2 gap-y-1 text-[11px]' : 'gap-x-2.5 gap-y-1.5 text-xs'
    } text-muted-foreground`}>
      {contextTokens(project, locale).map((token, index) => {
        const Icon = token.icon;
        return (
          <span
            key={token.label}
            className={`inline-flex min-w-0 items-center gap-1.5 ${
              index > 0 ? 'border-l border-border/70 pl-2.5' : ''
            }`}
          >
            <span
              aria-label={token.label}
              title={token.label}
              className="inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-md text-[var(--amber)] transition-colors hover:bg-[var(--amber-subtle)]"
            >
              <Icon size={density === 'compact' ? 11 : 12} aria-hidden="true" />
            </span>
            <span className="max-w-[18rem] truncate">{token.value}</span>
          </span>
        );
      })}
    </div>
  );
}

export function StudioProjectStage({
  project,
  locale,
}: {
  project: StudioProject;
  locale: string;
}) {
  return (
    <span className={`inline-flex h-6 items-center rounded-md border px-2 text-[11px] font-medium ${stageToneClass(project.stage)}`}>
      {stageLabel(project.stage, locale)}
    </span>
  );
}

export function StudioProjectItem({
  project,
  locale,
  sessionCount,
  selected = false,
  density = 'default',
  onPreview,
  trailingMeta,
}: {
  project: StudioProject;
  locale: string;
  sessionCount: number;
  selected?: boolean;
  density?: StudioProjectItemDensity;
  onPreview?: (projectId: string) => void;
  trailingMeta?: string;
}) {
  const title = localize(project.title, project.titleZh, locale);
  const goal = localize(project.goal, project.goalZh, locale);
  const nextAction = localize(project.nextAction, project.nextActionZh, locale);
  const Icon = projectIcon(project);
  const compact = density === 'compact';

  return (
    <Link
      href={getStudioProjectHref(project.id)}
      data-studio-project-item={density}
      onFocus={() => onPreview?.(project.id)}
      onPointerEnter={() => onPreview?.(project.id)}
      className={`group relative grid min-w-0 gap-3 border-t border-border/55 transition-colors first:border-t-0 hover:bg-card/70 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${
        compact
          ? 'px-3 py-3 md:grid-cols-[minmax(0,1.1fr)_minmax(180px,0.75fr)_auto]'
          : 'px-4 py-4 md:grid-cols-[minmax(0,1.15fr)_minmax(220px,0.75fr)_minmax(110px,0.22fr)_28px]'
      } ${selected ? 'bg-card/70' : ''}`}
    >
      <span className={`pointer-events-none absolute bottom-3 left-0 top-3 w-px rounded-r-full transition-colors group-hover:bg-[var(--amber)] ${
        selected ? 'bg-[var(--amber)]' : 'bg-transparent'
      }`} />

      <div className="flex min-w-0 gap-3">
        <span className={`mt-0.5 hidden shrink-0 items-center justify-center rounded-lg border border-border/55 bg-background/50 text-[var(--amber)] sm:inline-flex ${
          compact ? 'h-8 w-8' : 'h-9 w-9'
        }`}>
          <Icon size={compact ? 14 : 15} aria-hidden="true" />
        </span>
        <div className="min-w-0">
          <div className="flex min-w-0 flex-wrap items-center gap-2">
            <h3 className={`${compact ? 'text-sm' : 'text-[15px]'} min-w-0 font-semibold text-foreground`}>
              {title}
            </h3>
            <StudioProjectStage project={project} locale={locale} />
          </div>
          <p className={`${compact ? 'mt-1 line-clamp-1 text-[12px]' : 'mt-1 text-xs'} max-w-[64ch] leading-relaxed text-muted-foreground`}>
            {goal}
          </p>
          <div className={compact ? 'mt-2' : 'mt-3'}>
            <StudioContextBraid project={project} locale={locale} density={density} />
          </div>
        </div>
      </div>

      <div className="min-w-0 md:border-l md:border-border/45 md:pl-4">
        <div className="mb-1 text-[11px] font-medium text-muted-foreground">
          {locale === 'zh' ? '下一步' : 'Next move'}
        </div>
        <p className={`${compact ? 'text-[12px]' : 'text-xs'} leading-relaxed text-foreground`}>
          {nextAction}
        </p>
      </div>

      <div className={`${compact ? 'flex items-center justify-between gap-3 md:block' : 'flex items-center justify-between gap-3 md:block'} min-w-0`}>
        <div className="text-[11px] font-medium text-muted-foreground [font-variant-numeric:tabular-nums]">
          {sessionCount} {locale === 'zh' ? 'Sessions' : sessionCount === 1 ? 'session' : 'sessions'}
        </div>
        <div className="mt-1 text-[11px] text-muted-foreground">
          {trailingMeta ?? project.updated}
        </div>
      </div>

      {!compact ? (
        <div className="hidden items-center justify-end md:flex">
          <ArrowRight size={16} className="text-muted-foreground/45 transition-colors group-hover:text-[var(--amber)]" />
        </div>
      ) : (
        <div className="flex items-center justify-end md:hidden">
          <ArrowRight size={15} className="text-muted-foreground/45 transition-colors group-hover:text-[var(--amber)]" />
        </div>
      )}
    </Link>
  );
}

export function StudioAttentionItem({
  project,
  locale,
  sessionCount,
}: {
  project: StudioProject;
  locale: string;
  sessionCount: number;
}) {
  return (
    <StudioProjectItem
      project={project}
      locale={locale}
      sessionCount={sessionCount}
      density="compact"
      trailingMeta={project.stage === 'review' ? (locale === 'zh' ? '待复盘' : 'Review due') : project.updated}
    />
  );
}
