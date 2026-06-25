'use client';

import Link from 'next/link';
import {
  ArrowRight,
  BookOpenText,
  Blocks,
  CircleDashed,
  FolderOpen,
  Rocket,
  type LucideIcon,
} from 'lucide-react';
import {
  getStudioProjectHref,
  getStudioProjectAssistantLabels,
  getStudioProjectSpaceLabels,
  getStudioProjectWorkDirLabel,
  localize,
  stageLabel,
  type StudioProject,
} from '@/lib/studio-projects';

export type StudioProjectItemDensity = 'default' | 'compact';

function firstKit(project: StudioProject): string {
  return getStudioProjectAssistantLabels(project)[0] ?? 'Basic assistant';
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

function renderProjectIcon(project: StudioProject, size: number) {
  const Icon = projectIcon(project);
  return <Icon size={size} aria-hidden="true" />;
}

function contextTokenGroups(project: StudioProject, locale: string): Array<{
  label: string;
  values: string[];
  icon: LucideIcon;
}> {
  const spaces = getStudioProjectSpaceLabels(project, locale);
  const assistants = getStudioProjectAssistantLabels(project);
  return [
    {
      label: locale === 'zh' ? '工作目录' : 'Work dir',
      values: [getStudioProjectWorkDirLabel(project, locale)],
      icon: FolderOpen,
    },
    {
      label: locale === 'zh' ? '心智空间' : 'Mind Space',
      values: spaces.length ? spaces : [localize(project.space, project.spaceZh, locale)],
      icon: BookOpenText,
    },
    {
      label: locale === 'zh' ? 'AI 套件' : 'AI Kit',
      values: assistants.length ? assistants : [locale === 'zh' ? '基础助理' : firstKit(project)],
      icon: Blocks,
    },
  ];
}

function contextTokens(project: StudioProject, locale: string): Array<{
  label: string;
  value: string;
  icon: LucideIcon;
}> {
  return contextTokenGroups(project, locale).flatMap((token) => (
    token.values.filter(Boolean).map((value) => ({
      label: token.label,
      value,
      icon: token.icon,
    }))
  ));
}

export function StudioContextBraid({
  project,
  locale,
  density = 'default',
  maxVisible = 3,
}: {
  project: StudioProject;
  locale: string;
  density?: StudioProjectItemDensity;
  maxVisible?: number;
}) {
  const tokens = contextTokens(project, locale);
  const visibleTokens = tokens.slice(0, maxVisible);
  const overflow = Math.max(0, tokens.length - visibleTokens.length);

  return (
    <div data-studio-context-braid className={`flex min-w-0 flex-wrap items-center ${
      density === 'compact' ? 'gap-1.5 text-[11px]' : 'gap-2 text-xs'
    } text-muted-foreground`}>
      {visibleTokens.map((token, index) => {
        const Icon = token.icon;
        return (
          <span
            key={`${token.label}-${token.value}-${index}`}
            data-studio-context-chip
            className="inline-flex min-w-0 max-w-full items-center gap-1.5 rounded-md bg-muted/35 px-2 py-1 transition-colors hover:bg-[var(--amber-subtle)]"
            title={`${token.label}: ${token.value}`}
          >
            <span
              aria-label={token.label}
              title={token.label}
              className="inline-flex h-4 w-4 shrink-0 items-center justify-center text-[var(--amber)]"
            >
              <Icon size={density === 'compact' ? 11 : 12} aria-hidden="true" />
            </span>
            <span className={`${density === 'compact' ? 'max-w-[9rem]' : 'max-w-[13rem]'} min-w-0 truncate`}>
              {token.value}
            </span>
          </span>
        );
      })}
      {overflow > 0 ? (
        <span
          data-studio-context-overflow
          className="inline-flex h-7 items-center rounded-md bg-muted/35 px-2 text-[11px] font-medium text-muted-foreground [font-variant-numeric:tabular-nums]"
          title={locale === 'zh' ? `还有 ${overflow} 个上下文` : `${overflow} more context items`}
        >
          +{overflow}
        </span>
      ) : null}
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
  const compact = density === 'compact';
  const sessionLabel = locale === 'zh'
    ? `${sessionCount} 个对话`
    : `${sessionCount} ${sessionCount === 1 ? 'session' : 'sessions'}`;

  return (
    <Link
      href={getStudioProjectHref(project.id)}
      data-studio-project-item={density}
      onFocus={() => onPreview?.(project.id)}
      onPointerEnter={() => onPreview?.(project.id)}
      className={`group relative grid min-w-0 gap-3 border-t border-border/55 transition-colors first:border-t-0 hover:bg-muted/25 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${
        compact
          ? 'px-3 py-3 xl:grid-cols-[minmax(0,1fr)_minmax(104px,auto)_20px] xl:items-center'
          : 'px-4 py-4 xl:grid-cols-[minmax(0,1fr)_minmax(128px,auto)_28px] xl:items-center'
      } ${selected ? 'bg-[var(--amber-subtle)]' : ''}`}
    >
      <span className={`pointer-events-none absolute bottom-3 left-0 top-3 w-px rounded-r-full transition-colors group-hover:bg-[var(--amber)] ${
        selected ? 'bg-[var(--amber)]' : 'bg-transparent'
      }`} />

      <div className="flex min-w-0 gap-3 pr-6 xl:pr-0">
        <span className={`mt-0.5 hidden shrink-0 items-center justify-center rounded-md bg-[var(--amber-subtle)] text-[var(--amber)] transition-colors group-hover:bg-[var(--amber-dim)] sm:inline-flex ${
          compact ? 'h-8 w-8' : 'h-9 w-9'
        }`}>
          {renderProjectIcon(project, compact ? 14 : 15)}
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

      <div className="flex min-w-0 items-center justify-between gap-3 text-left xl:block xl:text-right">
        <div className="text-[11px] font-semibold text-foreground [font-variant-numeric:tabular-nums]">
          {sessionLabel}
        </div>
        <div className="text-[11px] text-muted-foreground xl:mt-1">
          {trailingMeta ?? project.updated}
        </div>
      </div>

      <div className="absolute right-4 top-4 flex items-center justify-end xl:static">
        <ArrowRight size={compact ? 15 : 16} className="text-muted-foreground/45 transition-colors group-hover:text-[var(--amber)]" />
      </div>
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
