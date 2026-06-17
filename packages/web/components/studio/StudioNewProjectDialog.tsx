'use client';

import { Check, FolderOpen, Plus, Sparkles, Target, X, Zap } from 'lucide-react';
import { type FormEvent, type ReactNode, useEffect, useMemo, useState } from 'react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import {
  localize,
  type StudioProject,
  type StudioProjectDraft,
} from '@/lib/studio-projects';

export interface StudioNewProjectCopy {
  createTitle: string;
  createDescription: string;
  titleLabel: string;
  goalLabel: string;
  spaceLabel: string;
  kitLabel: string;
  workAreaLabel: string;
  titlePlaceholder: string;
  goalPlaceholder: string;
  spacePlaceholder: string;
  kitPlaceholder: string;
  workAreaPlaceholder: string;
  cancel: string;
  create: string;
  required: string;
  setupTitle: string;
  setupDescription: string;
  workAreaDescription: string;
  spaceDescription: string;
  kitDescription: string;
  customValue: string;
  projectDetailsTitle: string;
  projectDetailsDescription: string;
  selectedSummary: string;
  fromRecentProject: string;
}

interface ChoiceOption {
  value: string;
  label: string;
  detail: string;
}

interface StudioNewProjectDialogProps {
  open: boolean;
  onClose: () => void;
  onCreate: (draft: StudioProjectDraft) => void;
  copy: StudioNewProjectCopy;
  locale: string;
  projects: StudioProject[];
}

const WORK_AREA_DEFAULTS = ['Session drafts', 'Research notes', 'Launch drafts', 'Review queue', 'Project artifacts'];
const SPACE_DEFAULTS = ['Mind', 'Product Strategy', 'Research Memory', 'Inbox + Personal Space', 'Personal Space'];
const KIT_DEFAULTS = ['Basic assistant', 'Research Kit', 'Review Kit', 'Launch Writing Kit', 'Capture Organize Kit'];

function uniqueOptions(options: ChoiceOption[]): ChoiceOption[] {
  const seen = new Set<string>();
  const result: ChoiceOption[] = [];

  for (const option of options) {
    const key = option.value.trim().toLowerCase();
    if (!key || seen.has(key)) continue;
    seen.add(key);
    result.push(option);
  }

  return result;
}

function buildOptions({
  defaults,
  recent,
  fallbackDetail,
}: {
  defaults: string[];
  recent: ChoiceOption[];
  fallbackDetail: string;
}): ChoiceOption[] {
  return uniqueOptions([
    ...recent,
    ...defaults.map((value) => ({
      value,
      label: value,
      detail: fallbackDetail,
    })),
  ]).slice(0, 6);
}

function ChoiceSection({
  step,
  title,
  description,
  icon,
  value,
  placeholder,
  options,
  customLabel,
  onChange,
}: {
  step: number;
  title: string;
  description: string;
  icon: ReactNode;
  value: string;
  placeholder: string;
  options: ChoiceOption[];
  customLabel: string;
  onChange: (value: string) => void;
}) {
  return (
    <section className="rounded-lg border border-border/60 bg-background/45 p-3">
      <div className="flex items-start gap-3">
        <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-[var(--amber-subtle)] text-[var(--amber)]">
          {icon}
        </div>
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <span className="inline-flex h-5 min-w-5 items-center justify-center rounded-md border border-border/70 bg-card px-1.5 text-[11px] font-semibold text-muted-foreground">
              {step}
            </span>
            <h3 className="text-sm font-semibold text-foreground">{title}</h3>
          </div>
          <p className="mt-1 text-xs leading-relaxed text-muted-foreground">{description}</p>
        </div>
      </div>

      <div className="mt-3 flex flex-wrap gap-1.5">
        {options.map((option) => {
          const selected = value.trim() === option.value;
          return (
            <button
              key={option.value}
              type="button"
              title={option.detail}
              aria-pressed={selected}
              onClick={() => onChange(option.value)}
              className={cn(
                'group inline-flex h-7 max-w-full items-center gap-1.5 rounded-md border px-2.5 text-left text-xs font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                selected
                  ? 'border-[var(--amber)] bg-[var(--amber-subtle)]'
                  : 'border-border/60 bg-card/45 hover:border-[var(--amber)]/45 hover:bg-card/80',
              )}
            >
              <span className="truncate text-foreground">{option.label}</span>
              {selected ? <Check size={13} className="shrink-0 text-[var(--amber)]" aria-hidden="true" /> : null}
            </button>
          );
        })}
      </div>

      <label className="mt-3 grid gap-1.5">
        <span className="text-[11px] font-medium text-muted-foreground">{customLabel}</span>
        <input
          value={value}
          onChange={(event) => onChange(event.target.value)}
          placeholder={placeholder}
          className="h-8 rounded-md border border-border bg-background px-3 text-sm text-foreground outline-none transition-colors placeholder:text-muted-foreground/55 focus-visible:border-[var(--amber)] focus-visible:ring-2 focus-visible:ring-ring/40"
        />
      </label>
    </section>
  );
}

export default function StudioNewProjectDialog({
  open,
  onClose,
  onCreate,
  copy,
  locale,
  projects,
}: StudioNewProjectDialogProps) {
  const [draft, setDraft] = useState<StudioProjectDraft>({
    title: '',
    goal: '',
    space: 'Mind',
    kit: 'Research Kit',
    workArea: 'Session drafts',
  });
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setDraft({
      title: '',
      goal: '',
      space: 'Mind',
      kit: 'Research Kit',
      workArea: 'Session drafts',
    });
    setError(null);
  }, [open]);

  const optionGroups = useMemo(() => {
    const recentWorkAreas = projects.map((project) => ({
      value: project.workArea,
      label: localize(project.workArea, project.workAreaZh, locale),
      detail: `${copy.fromRecentProject}: ${localize(project.title, project.titleZh, locale)}`,
    }));
    const recentSpaces = projects.map((project) => ({
      value: project.space,
      label: localize(project.space, project.spaceZh, locale),
      detail: `${copy.fromRecentProject}: ${localize(project.title, project.titleZh, locale)}`,
    }));
    const recentKits = projects.flatMap((project) => (
      project.kits.map((kit) => ({
        value: kit,
        label: kit,
        detail: `${copy.fromRecentProject}: ${localize(project.title, project.titleZh, locale)}`,
      }))
    ));

    return {
      workAreas: buildOptions({
        defaults: WORK_AREA_DEFAULTS,
        recent: recentWorkAreas,
        fallbackDetail: copy.workAreaDescription,
      }),
      spaces: buildOptions({
        defaults: SPACE_DEFAULTS,
        recent: recentSpaces,
        fallbackDetail: copy.spaceDescription,
      }),
      kits: buildOptions({
        defaults: KIT_DEFAULTS,
        recent: recentKits,
        fallbackDetail: copy.kitDescription,
      }),
    };
  }, [copy, locale, projects]);

  if (!open) return null;

  const updateDraft = (field: keyof StudioProjectDraft, value: string) => {
    setDraft((current) => ({ ...current, [field]: value }));
  };

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!draft.title.trim() || !draft.goal.trim()) {
      setError(copy.required);
      return;
    }
    onCreate(draft);
  };

  return (
    <div className="fixed inset-0 z-app-modal flex items-center justify-center bg-background/80 px-3 py-5 backdrop-blur-sm">
      <form
        role="dialog"
        aria-modal="true"
        aria-labelledby="studio-new-project-title"
        onSubmit={submit}
        className="flex max-h-[min(880px,calc(100dvh-32px))] w-full max-w-4xl flex-col overflow-hidden rounded-xl border border-border bg-card shadow-xl"
      >
        <div className="flex items-start justify-between gap-4 border-b border-border/70 px-5 py-4">
          <div className="min-w-0">
            <div className="mb-2 inline-flex items-center gap-2 rounded-md border border-border/70 bg-background/70 px-2 py-1 text-[11px] font-medium text-muted-foreground">
              <Sparkles size={12} className="text-[var(--amber)]" aria-hidden="true" />
              {copy.setupTitle}
            </div>
            <h2 id="studio-new-project-title" className="text-lg font-semibold text-foreground">
              {copy.createTitle}
            </h2>
            <p className="mt-1 max-w-2xl text-xs leading-relaxed text-muted-foreground">{copy.createDescription}</p>
          </div>
          <Button
            type="button"
            onClick={onClose}
            aria-label={copy.cancel}
            variant="ghost"
            size="icon"
            className="rounded-md text-muted-foreground"
          >
            <X size={16} aria-hidden="true" />
          </Button>
        </div>

        <div className="grid min-h-0 gap-4 overflow-y-auto px-5 py-4 lg:grid-cols-[300px_minmax(0,1fr)]">
          <aside className="min-w-0 lg:sticky lg:top-[var(--app-titlebar-h)] lg:self-start">
            <div className="rounded-xl border border-border/60 bg-background/45 p-4">
              <h3 className="text-sm font-semibold text-foreground">{copy.projectDetailsTitle}</h3>
              <p className="mt-1 text-xs leading-relaxed text-muted-foreground">{copy.projectDetailsDescription}</p>

              <div className="mt-4 grid gap-3">
                <label className="grid gap-1.5">
                  <span className="text-xs font-medium text-muted-foreground">{copy.titleLabel}</span>
                  <input
                    autoFocus
                    value={draft.title}
                    onChange={(event) => updateDraft('title', event.target.value)}
                    placeholder={copy.titlePlaceholder}
                    className="h-10 rounded-lg border border-border bg-background px-3 text-sm text-foreground outline-none transition-colors placeholder:text-muted-foreground/55 focus-visible:border-[var(--amber)] focus-visible:ring-2 focus-visible:ring-ring/40"
                  />
                </label>
                <label className="grid gap-1.5">
                  <span className="text-xs font-medium text-muted-foreground">{copy.goalLabel}</span>
                  <textarea
                    value={draft.goal}
                    onChange={(event) => updateDraft('goal', event.target.value)}
                    placeholder={copy.goalPlaceholder}
                    rows={4}
                    className="min-h-24 resize-none rounded-lg border border-border bg-background px-3 py-2 text-sm leading-relaxed text-foreground outline-none transition-colors placeholder:text-muted-foreground/55 focus-visible:border-[var(--amber)] focus-visible:ring-2 focus-visible:ring-ring/40"
                  />
                </label>
              </div>

              <div className="mt-4 rounded-lg border border-border/60 bg-card/45 p-3">
                <div className="text-[11px] font-semibold text-muted-foreground">{copy.selectedSummary}</div>
                <dl className="mt-2 space-y-2 text-xs">
                  <div className="flex items-start justify-between gap-3">
                    <dt className="text-muted-foreground">{copy.workAreaLabel}</dt>
                    <dd className="max-w-[150px] text-right font-medium text-foreground">{draft.workArea || copy.workAreaPlaceholder}</dd>
                  </div>
                  <div className="flex items-start justify-between gap-3 border-t border-border/50 pt-2">
                    <dt className="text-muted-foreground">{copy.spaceLabel}</dt>
                    <dd className="max-w-[150px] text-right font-medium text-foreground">{draft.space || copy.spacePlaceholder}</dd>
                  </div>
                  <div className="flex items-start justify-between gap-3 border-t border-border/50 pt-2">
                    <dt className="text-muted-foreground">{copy.kitLabel}</dt>
                    <dd className="max-w-[150px] text-right font-medium text-foreground">{draft.kit || copy.kitPlaceholder}</dd>
                  </div>
                </dl>
              </div>

              {error ? <p className="mt-3 text-xs font-medium text-destructive">{error}</p> : null}
            </div>
          </aside>

          <div className="min-w-0 space-y-3">
            <p className="text-xs leading-relaxed text-muted-foreground">{copy.setupDescription}</p>
            <ChoiceSection
              step={1}
              title={copy.workAreaLabel}
              description={copy.workAreaDescription}
              icon={<FolderOpen size={15} aria-hidden="true" />}
              value={draft.workArea}
              placeholder={copy.workAreaPlaceholder}
              options={optionGroups.workAreas}
              customLabel={copy.customValue}
              onChange={(value) => updateDraft('workArea', value)}
            />
            <ChoiceSection
              step={2}
              title={copy.spaceLabel}
              description={copy.spaceDescription}
              icon={<Target size={15} aria-hidden="true" />}
              value={draft.space}
              placeholder={copy.spacePlaceholder}
              options={optionGroups.spaces}
              customLabel={copy.customValue}
              onChange={(value) => updateDraft('space', value)}
            />
            <ChoiceSection
              step={3}
              title={copy.kitLabel}
              description={copy.kitDescription}
              icon={<Zap size={15} aria-hidden="true" />}
              value={draft.kit}
              placeholder={copy.kitPlaceholder}
              options={optionGroups.kits}
              customLabel={copy.customValue}
              onChange={(value) => updateDraft('kit', value)}
            />
          </div>
        </div>

        <div className="flex items-center justify-end gap-2 border-t border-border/70 px-5 py-4">
          <Button
            type="button"
            onClick={onClose}
            variant="outline"
            size="lg"
            className="px-3 text-muted-foreground"
          >
            {copy.cancel}
          </Button>
          <Button
            type="submit"
            variant="amber"
            size="lg"
            className="px-3.5"
          >
            <Plus size={15} aria-hidden="true" />
            {copy.create}
          </Button>
        </div>
      </form>
    </div>
  );
}
