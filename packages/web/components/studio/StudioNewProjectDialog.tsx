'use client';

import { Bot, FolderOpen, Layers3, Plus, Sparkles, X } from 'lucide-react';
import { type FormEvent, type ReactNode, useMemo, useState } from 'react';
import PathAutocompleteField from '@/components/shared/PathAutocompleteField';
import {
  contextChipLabel,
  contextItemIcon,
  contextPathLabel,
  ContextSelectionRow,
  type ContextSelectableItem,
} from '@/components/shared/ContextTokenPicker';
import { Button } from '@/components/ui/button';
import type { ContextAssistantRef, ContextSpaceRef, SessionWorkDir } from '@/lib/types';
import {
  getStudioProjectWorkDir,
  localize,
  type StudioProject,
  type StudioProjectDraft,
} from '@/lib/studio-projects';
import {
  assistantFromCandidate,
  buildAssistantCandidates,
  buildSpaceCandidates,
  DEFAULT_ASSISTANTS,
  DEFAULT_SPACES,
  normalizeAssistants,
  normalizeSpaces,
  spaceFromCandidate,
  studioContextPickerCopy,
  type StudioContextPickerKind,
  type StudioWorkspaceSpace,
} from './studioContextOptions';

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

interface StudioNewProjectDialogProps {
  open: boolean;
  onClose: () => void;
  onCreate: (draft: StudioProjectDraft) => void;
  copy: StudioNewProjectCopy;
  locale: string;
  projects: StudioProject[];
  workspaceSpaces?: StudioWorkspaceSpace[];
}

function shortPath(value: string | undefined, fallback: string): string {
  if (!value?.trim()) return fallback;
  const parts = value.replace(/\\/g, '/').split('/').filter(Boolean);
  return parts.at(-1) ?? value;
}

function workDirFromInput(value: string, mindLabel: string): SessionWorkDir {
  const trimmed = value.trim();
  if (!trimmed) {
    return {
      source: 'mind-root',
      label: mindLabel,
    };
  }
  return {
    source: 'manual',
    path: trimmed,
    label: shortPath(trimmed, trimmed),
  };
}

function workDirDisplay(value: string, mindLabel: string): string {
  return value.trim() ? shortPath(value, value) : mindLabel;
}

function buildRecentWorkDirs(projects: StudioProject[], locale: string, sourceLabel: string): Array<{ value: string; label: string; detail: string }> {
  const seen = new Set<string>();
  const result: Array<{ value: string; label: string; detail: string }> = [];

  for (const project of projects) {
    const workDir = getStudioProjectWorkDir(project);
    const value = workDir.path?.trim();
    if (!value || seen.has(value)) continue;
    seen.add(value);
    result.push({
      value,
      label: workDir.label || shortPath(value, value),
      detail: `${sourceLabel}: ${localize(project.title, project.titleZh, locale)}`,
    });
    if (result.length >= 5) break;
  }

  return result;
}

function SetupSection({
  step,
  title,
  description,
  icon,
  children,
}: {
  step: number;
  title: string;
  description: string;
  icon: ReactNode;
  children: ReactNode;
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
      <div className="mt-3">{children}</div>
    </section>
  );
}

export default function StudioNewProjectDialog({ open, ...props }: StudioNewProjectDialogProps) {
  if (!open) return null;
  return <StudioNewProjectDialogForm {...props} />;
}

function StudioNewProjectDialogForm({
  onClose,
  onCreate,
  copy,
  locale,
  projects,
  workspaceSpaces = [],
}: Omit<StudioNewProjectDialogProps, 'open'>) {
  const labels = useMemo(() => studioContextPickerCopy(locale), [locale]);
  const [title, setTitle] = useState('');
  const [goal, setGoal] = useState('');
  const [workDirInput, setWorkDirInput] = useState('');
  const [spaces, setSpaces] = useState<ContextSpaceRef[]>(DEFAULT_SPACES);
  const [assistants, setAssistants] = useState<ContextAssistantRef[]>(DEFAULT_ASSISTANTS);
  const [openPicker, setOpenPicker] = useState<StudioContextPickerKind | null>(null);
  const [spaceQuery, setSpaceQuery] = useState('');
  const [assistantQuery, setAssistantQuery] = useState('');
  const [error, setError] = useState<string | null>(null);

  const spaceCandidates = useMemo(
    () => buildSpaceCandidates(projects, locale, copy.fromRecentProject, workspaceSpaces),
    [copy.fromRecentProject, locale, projects, workspaceSpaces],
  );
  const assistantCandidates = useMemo(
    () => buildAssistantCandidates(projects, locale, copy.fromRecentProject),
    [copy.fromRecentProject, locale, projects],
  );
  const recentWorkDirs = useMemo(
    () => buildRecentWorkDirs(projects, locale, copy.fromRecentProject),
    [copy.fromRecentProject, locale, projects],
  );

  const selectSpace = (candidate: ContextSelectableItem) => {
    setSpaces((current) => normalizeSpaces([...current, spaceFromCandidate(candidate)]));
    setSpaceQuery('');
    setOpenPicker(null);
  };

  const selectAssistant = (candidate: ContextSelectableItem) => {
    setAssistants((current) => normalizeAssistants([...current, assistantFromCandidate(candidate)]));
    setAssistantQuery('');
    setOpenPicker(null);
  };

  const openCreateSpace = () => {
    setOpenPicker(null);
    if (typeof window !== 'undefined') {
      window.dispatchEvent(new Event('mindos:create-space'));
    }
  };

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!title.trim() || !goal.trim()) {
      setError(copy.required);
      return;
    }

    const normalizedSpaces = normalizeSpaces(spaces);
    const normalizedAssistants = normalizeAssistants(assistants);
    const workDir = workDirFromInput(workDirInput, labels.mind);
    onCreate({
      title,
      goal,
      workDir,
      spaces: normalizedSpaces,
      assistants: normalizedAssistants,
      space: normalizedSpaces[0]?.label || normalizedSpaces[0]?.path || labels.mind,
      kit: normalizedAssistants[0]?.name || normalizedAssistants[0]?.id || '',
      workArea: workDirDisplay(workDirInput, labels.mind),
    });
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
                    value={title}
                    onChange={(event) => setTitle(event.target.value)}
                    placeholder={copy.titlePlaceholder}
                    className="h-10 rounded-lg border border-border bg-background px-3 text-sm text-foreground outline-none transition-colors placeholder:text-muted-foreground/55 focus-visible:border-[var(--amber)] focus-visible:ring-2 focus-visible:ring-ring/40"
                  />
                </label>
                <label className="grid gap-1.5">
                  <span className="text-xs font-medium text-muted-foreground">{copy.goalLabel}</span>
                  <textarea
                    value={goal}
                    onChange={(event) => setGoal(event.target.value)}
                    placeholder={copy.goalPlaceholder}
                    rows={4}
                    className="min-h-24 resize-none rounded-lg border border-border bg-background px-3 py-2 text-sm leading-relaxed text-foreground outline-none transition-colors placeholder:text-muted-foreground/55 focus-visible:border-[var(--amber)] focus-visible:ring-2 focus-visible:ring-ring/40"
                  />
                </label>
              </div>

              <div className="mt-4 rounded-lg border border-border/60 bg-card/45 p-3">
                <div className="text-[11px] font-semibold text-muted-foreground">{copy.selectedSummary}</div>
                <dl className="mt-2 space-y-2 text-xs">
                  <SummaryLine label={copy.workAreaLabel} value={workDirDisplay(workDirInput, labels.mind)} />
                  <SummaryLine label={copy.spaceLabel} value={`${spaces.length}`} bordered />
                  <SummaryLine label={copy.kitLabel} value={`${assistants.length}`} bordered />
                </dl>
              </div>

              {error ? <p className="mt-3 text-xs font-medium text-destructive">{error}</p> : null}
            </div>
          </aside>

          <div className="min-w-0 space-y-3">
            <p className="text-xs leading-relaxed text-muted-foreground">{copy.setupDescription}</p>

            <SetupSection
              step={1}
              title={copy.workAreaLabel}
              description={copy.workAreaDescription}
              icon={<FolderOpen size={15} aria-hidden="true" />}
            >
              <PathAutocompleteField
                value={workDirInput}
                onChange={setWorkDirInput}
                placeholder={copy.workAreaPlaceholder}
                ariaLabel={copy.workAreaLabel}
                browseLabel={labels.chooseWorkDir}
                browseUnavailableLabel={labels.chooseWorkDirUnavailable}
                wrapperClassName="min-w-0"
                inputClassName="h-9 border-border/70 bg-background/80 pr-10 text-xs"
                browseButtonClassName="right-1 h-7 w-7"
                suggestionsClassName="text-xs"
                suggestionClassName="py-1.5 text-xs"
              />
              {recentWorkDirs.length ? (
                <div className="mt-2 flex flex-wrap gap-1.5">
                  {recentWorkDirs.map((item) => (
                    <button
                      key={item.value}
                      type="button"
                      title={item.detail}
                      onClick={() => setWorkDirInput(item.value)}
                      className="inline-flex h-7 max-w-full items-center gap-1.5 rounded-md border border-border/60 bg-card/45 px-2 text-xs text-muted-foreground transition-colors hover:border-[var(--amber)]/45 hover:bg-card/80 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                    >
                      <FolderOpen size={12} className="shrink-0 text-[var(--amber)]" aria-hidden="true" />
                      <span className="truncate">{item.label}</span>
                    </button>
                  ))}
                </div>
              ) : null}
            </SetupSection>

            <SetupSection
              step={2}
              title={copy.spaceLabel}
              description={copy.spaceDescription}
              icon={<Layers3 size={15} aria-hidden="true" />}
            >
              <ContextSelectionRow
                kind="studio-spaces"
                icon={<Layers3 size={13} aria-hidden="true" />}
                label={copy.spaceLabel}
                addTitle={labels.addSpace}
                searchLabel={labels.searchSpaces}
                noMatchesLabel={labels.noMatches}
                query={spaceQuery}
                onQueryChange={setSpaceQuery}
                open={openPicker === 'spaces'}
                onOpenChange={(nextOpen) => setOpenPicker(nextOpen ? 'spaces' : null)}
                candidates={spaceCandidates}
                selectedIds={new Set(spaces.map((space) => space.path))}
                footerAction={{ label: labels.createSpace, onSelect: openCreateSpace }}
                onSelect={selectSpace}
                chips={spaces.map((space) => {
                  const label = contextChipLabel(space) || contextPathLabel(space.path);
                  return {
                    id: space.path,
                    label,
                    icon: space.icon || contextItemIcon(label, 'S'),
                    title: space.path,
                    removeLabel: labels.remove(label),
                    onRemove: () => setSpaces((current) => current.filter((item) => item.path !== space.path)),
                  };
                })}
              />
            </SetupSection>

            <SetupSection
              step={3}
              title={copy.kitLabel}
              description={copy.kitDescription}
              icon={<Bot size={15} aria-hidden="true" />}
            >
              <ContextSelectionRow
                kind="studio-assistants"
                icon={<Bot size={13} aria-hidden="true" />}
                label={copy.kitLabel}
                addTitle={labels.addAssistant}
                searchLabel={labels.searchAssistants}
                noMatchesLabel={labels.noMatches}
                query={assistantQuery}
                onQueryChange={setAssistantQuery}
                open={openPicker === 'assistants'}
                onOpenChange={(nextOpen) => setOpenPicker(nextOpen ? 'assistants' : null)}
                candidates={assistantCandidates}
                selectedIds={new Set(assistants.map((assistant) => assistant.id))}
                onSelect={selectAssistant}
                chips={assistants.map((assistant) => {
                  const label = contextChipLabel(assistant) || assistant.id;
                  return {
                    id: assistant.id,
                    label,
                    icon: contextItemIcon(label, 'A'),
                    title: assistant.id,
                    removeLabel: labels.remove(label),
                    onRemove: () => setAssistants((current) => current.filter((item) => item.id !== assistant.id)),
                  };
                })}
              />
            </SetupSection>
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

function SummaryLine({
  label,
  value,
  bordered = false,
}: {
  label: string;
  value: string;
  bordered?: boolean;
}) {
  return (
    <div className={`flex items-start justify-between gap-3 ${bordered ? 'border-t border-border/50 pt-2' : ''}`}>
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="max-w-[150px] truncate text-right font-medium text-foreground" title={value}>{value}</dd>
    </div>
  );
}
