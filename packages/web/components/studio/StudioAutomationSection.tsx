'use client';

import {
  Bot,
  CalendarClock,
  ChevronDown,
  Clock3,
  Edit3,
  FolderGit2,
  Info,
  Layers3,
  Pause,
  Play,
  Plus,
  Sparkles,
  WandSparkles,
  X,
} from 'lucide-react';
import { type FormEvent, type ReactNode, useEffect, useMemo, useState } from 'react';
import { Button } from '@/components/ui/button';
import {
  createStudioAutomation,
  readStudioAutomations,
  STUDIO_AUTOMATIONS_UPDATED_EVENT,
  toggleStudioAutomationStatus,
  updateStudioAutomation,
  type StudioAutomation,
  type StudioAutomationDraft,
  type StudioAutomationEffort,
  type StudioAutomationModel,
  type StudioAutomationSchedule,
  type StudioAutomationScope,
} from '@/lib/studio-automations';
import {
  localize,
  type StudioProject,
} from '@/lib/studio-projects';

const COPY = {
  en: {
    title: 'Automation',
    subtitle: 'Repeatable agent work with explicit scope, schedule, and review.',
    createKicker: 'Create',
    editKicker: 'Editing',
    createTitle: 'Create automation',
    editTitle: 'Edit automation',
    createHint: 'Describe a recurring outcome. Studio keeps the automation editable before runtime execution is connected.',
    titleLabel: 'Title',
    titleAria: 'Automation title',
    titlePlaceholder: 'Daily release sweep',
    promptLabel: 'Prompt',
    promptAria: 'Automation prompt',
    promptPlaceholder: 'Ask MindOS to review open release notes, check blockers, and summarize the next move.',
    templates: 'Templates',
    useTemplate: 'Use template',
    scopeLabel: 'Scope',
    projectLabel: 'Project',
    scheduleLabel: 'Schedule',
    modelLabel: 'Model',
    effortLabel: 'Effort',
    cancel: 'Cancel',
    create: 'Create automation',
    save: 'Save changes',
    required: 'Add a prompt before creating an automation.',
    existingTitle: 'Existing automations',
    existingHint: 'Created automations stay editable; pause them when they should stop appearing as active work.',
    active: 'Active',
    paused: 'Paused',
    pause: 'Pause',
    resume: 'Resume',
    edit: 'Edit',
    lastRun: 'Last',
    nextRun: 'Next',
    runs: 'runs',
    empty: 'No automations match this workspace yet.',
    worktree: 'Worktree',
    project: 'Project',
    mind: 'Mind',
    manual: 'Manual',
    daily: 'Daily at 9:00 AM',
    weekdays: 'Weekdays at 9:00 AM',
    weekly: 'Weekly review',
    autoModel: 'MindOS Auto',
    gptModel: 'GPT-5.5',
    claudeModel: 'Claude Code',
    localModel: 'Local Agent',
    normalEffort: 'Normal',
    highEffort: 'High',
    extraHighEffort: 'Extra High',
    noProject: 'No Project',
    localNote: 'Local Studio plan',
  },
  zh: {
    title: '自动化',
    subtitle: '把重复 Agent 工作固定成明确的作用域、调度和复盘入口。',
    createKicker: '创建',
    editKicker: '编辑中',
    createTitle: '创建自动化',
    editTitle: '编辑自动化',
    createHint: '描述一个会反复发生的结果。工作台会先把它保存为可编辑的自动化，再接入运行时执行。',
    titleLabel: '标题',
    titleAria: '自动化标题',
    titlePlaceholder: '每日发布巡检',
    promptLabel: '提示词',
    promptAria: '自动化提示词',
    promptPlaceholder: '让 MindOS 检查发布记录、风险阻塞和下一步动作。',
    templates: '模板',
    useTemplate: '套用模板',
    scopeLabel: '范围',
    projectLabel: '项目',
    scheduleLabel: '调度',
    modelLabel: '模型',
    effortLabel: '强度',
    cancel: '取消',
    create: '创建自动化',
    save: '保存更改',
    required: '创建自动化前需要先写提示词。',
    existingTitle: '已有自动化',
    existingHint: '已创建的自动化可以随时编辑；暂时不用时可以暂停。',
    active: '启用',
    paused: '暂停',
    pause: '暂停',
    resume: '恢复',
    edit: '编辑',
    lastRun: '上次',
    nextRun: '下次',
    runs: '次运行',
    empty: '这个工作区还没有自动化。',
    worktree: '工作树',
    project: '项目',
    mind: '心智',
    manual: '手动',
    daily: '每日 9:00',
    weekdays: '工作日 9:00',
    weekly: '每周复盘',
    autoModel: 'MindOS 自动',
    gptModel: 'GPT-5.5',
    claudeModel: 'Claude Code',
    localModel: '本地 Agent',
    normalEffort: '标准',
    highEffort: '高',
    extraHighEffort: '极高',
    noProject: '无项目',
    localNote: '工作台本地计划',
  },
} as const;

type StudioAutomationCopy = (typeof COPY)[keyof typeof COPY];

const SCOPE_OPTIONS: StudioAutomationScope[] = ['worktree', 'project', 'mind'];
const SCHEDULE_OPTIONS: StudioAutomationSchedule[] = ['manual', 'daily-0900', 'weekdays-0900', 'weekly-review'];
const MODEL_OPTIONS: StudioAutomationModel[] = ['mindos-auto', 'gpt-5.5', 'claude-code', 'local-agent'];
const EFFORT_OPTIONS: StudioAutomationEffort[] = ['normal', 'high', 'extra-high'];

function scheduleLabel(schedule: StudioAutomationSchedule, copy: StudioAutomationCopy): string {
  if (schedule === 'manual') return copy.manual;
  if (schedule === 'daily-0900') return copy.daily;
  if (schedule === 'weekdays-0900') return copy.weekdays;
  return copy.weekly;
}

function scopeLabel(scope: StudioAutomationScope, copy: StudioAutomationCopy): string {
  if (scope === 'worktree') return copy.worktree;
  if (scope === 'project') return copy.project;
  return copy.mind;
}

function modelLabel(model: StudioAutomationModel, copy: StudioAutomationCopy): string {
  if (model === 'mindos-auto') return copy.autoModel;
  if (model === 'gpt-5.5') return copy.gptModel;
  if (model === 'claude-code') return copy.claudeModel;
  return copy.localModel;
}

function effortLabel(effort: StudioAutomationEffort, copy: StudioAutomationCopy): string {
  if (effort === 'normal') return copy.normalEffort;
  if (effort === 'high') return copy.highEffort;
  return copy.extraHighEffort;
}

function defaultDraft(projects: StudioProject[]): StudioAutomationDraft {
  return {
    title: '',
    prompt: '',
    scope: 'worktree',
    projectId: projects[0]?.id,
    schedule: 'daily-0900',
    model: 'mindos-auto',
    effort: 'high',
  };
}

function automationToDraft(automation: StudioAutomation, projects: StudioProject[]): StudioAutomationDraft {
  return {
    title: automation.title,
    prompt: automation.prompt,
    scope: automation.scope,
    projectId: automation.projectId ?? projects[0]?.id,
    schedule: automation.schedule,
    model: automation.model,
    effort: automation.effort,
  };
}

function projectLabel(projects: StudioProject[], projectId: string | undefined, locale: string, fallback: string): string {
  if (!projectId) return fallback;
  const project = projects.find((item) => item.id === projectId);
  return project ? localize(project.title, project.titleZh, locale) : fallback;
}

function automationPrompt(automation: StudioAutomation, locale: string): string {
  return localize(automation.prompt, automation.promptZh, locale);
}

function automationTitle(automation: StudioAutomation, locale: string): string {
  return localize(automation.title, automation.titleZh, locale);
}

function ControlSelect<T extends string>({
  icon,
  label,
  value,
  values,
  disabled,
  onChange,
  renderLabel,
}: {
  icon: ReactNode;
  label: string;
  value: T;
  values: T[];
  disabled?: boolean;
  onChange: (value: T) => void;
  renderLabel: (value: T) => string;
}) {
  return (
    <label className={`group flex h-10 min-w-0 items-center gap-2 rounded-lg border border-border/60 bg-background/60 px-3 text-xs text-muted-foreground transition-colors focus-within:border-ring focus-within:ring-2 focus-within:ring-ring/20 ${
      disabled ? 'opacity-55' : 'hover:border-[var(--amber)]/45 hover:bg-background'
    }`}>
      <span className="shrink-0 text-[var(--amber)]" aria-hidden="true">{icon}</span>
      <span className="sr-only">{label}</span>
      <select
        aria-label={label}
        disabled={disabled}
        value={value}
        onChange={(event) => onChange(event.target.value as T)}
        className="min-w-0 flex-1 appearance-none bg-transparent text-xs font-medium text-foreground outline-none disabled:cursor-not-allowed"
      >
        {values.map((item) => (
          <option key={item} value={item}>{renderLabel(item)}</option>
        ))}
      </select>
      <ChevronDown size={13} className="shrink-0 text-muted-foreground/60" aria-hidden="true" />
    </label>
  );
}

function TextPill({ icon, label }: { icon: ReactNode; label: string }) {
  return (
    <span className="inline-flex min-w-0 items-center gap-1.5 rounded-md border border-border/55 bg-background/55 px-2 py-1 text-[11px] font-medium text-muted-foreground">
      <span className="shrink-0 text-[var(--amber)]" aria-hidden="true">{icon}</span>
      <span className="min-w-0 truncate">{label}</span>
    </span>
  );
}

function TemplateButton({
  title,
  prompt,
  copy,
  onUse,
}: {
  title: string;
  prompt: string;
  copy: StudioAutomationCopy;
  onUse: () => void;
}) {
  return (
    <button
      type="button"
      title={prompt}
      onClick={onUse}
      className="inline-flex max-w-full items-center gap-1.5 rounded-md border border-border/60 bg-card/55 px-2.5 py-1.5 text-xs font-medium text-muted-foreground transition-colors hover:border-[var(--amber)]/45 hover:bg-[var(--amber-subtle)] hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
    >
      <WandSparkles size={12} className="shrink-0 text-[var(--amber)]" aria-hidden="true" />
      <span className="truncate">{title}</span>
      <span className="sr-only">{copy.useTemplate}</span>
    </button>
  );
}

function AutomationCard({
  automation,
  projects,
  locale,
  copy,
  onEdit,
  onToggle,
}: {
  automation: StudioAutomation;
  projects: StudioProject[];
  locale: string;
  copy: StudioAutomationCopy;
  onEdit: (automation: StudioAutomation) => void;
  onToggle: (automation: StudioAutomation) => void;
}) {
  const title = automationTitle(automation, locale);
  const prompt = automationPrompt(automation, locale);
  const statusLabel = automation.status === 'active' ? copy.active : copy.paused;
  const statusClass = automation.status === 'active'
    ? 'border-success/30 bg-success/10 text-success'
    : 'border-border/60 bg-muted/45 text-muted-foreground';
  const scopeText = automation.scope === 'project'
    ? `${scopeLabel(automation.scope, copy)} / ${projectLabel(projects, automation.projectId, locale, copy.noProject)}`
    : scopeLabel(automation.scope, copy);

  return (
    <article data-studio-automation-card className="rounded-xl border border-border/60 bg-card/45 p-4 transition-colors hover:border-[var(--amber)]/35 hover:bg-card/65">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
          <div className="flex min-w-0 flex-wrap items-center gap-2">
            <h3 className="min-w-0 text-sm font-semibold text-foreground">{title}</h3>
            <span className={`inline-flex h-6 items-center rounded-md border px-2 text-[11px] font-medium ${statusClass}`}>
              {statusLabel}
            </span>
          </div>
          <p className="mt-2 line-clamp-2 max-w-3xl text-xs leading-relaxed text-muted-foreground">{prompt}</p>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <Button type="button" variant="outline" size="sm" onClick={() => onEdit(automation)}>
            <Edit3 size={13} aria-hidden="true" />
            {copy.edit}
          </Button>
          <Button type="button" variant="ghost" size="sm" onClick={() => onToggle(automation)}>
            {automation.status === 'active' ? <Pause size={13} aria-hidden="true" /> : <Play size={13} aria-hidden="true" />}
            {automation.status === 'active' ? copy.pause : copy.resume}
          </Button>
        </div>
      </div>

      <div className="mt-4 flex flex-wrap gap-1.5">
        <TextPill icon={<FolderGit2 size={12} />} label={scopeText} />
        <TextPill icon={<CalendarClock size={12} />} label={scheduleLabel(automation.schedule, copy)} />
        <TextPill icon={<Bot size={12} />} label={`${modelLabel(automation.model, copy)} / ${effortLabel(automation.effort, copy)}`} />
      </div>

      <div className="mt-4 grid gap-2 border-t border-border/50 pt-3 text-[11px] text-muted-foreground sm:grid-cols-3">
        <span>{copy.lastRun}: {automation.lastRun ?? copy.localNote}</span>
        <span>{copy.nextRun}: {automation.nextRun ?? copy.localNote}</span>
        <span className="[font-variant-numeric:tabular-nums]">{automation.runCount} {copy.runs}</span>
      </div>
    </article>
  );
}

export default function StudioAutomationSection({
  projects,
  locale,
  titleLevel = 2,
}: {
  projects: StudioProject[];
  locale: string;
  titleLevel?: 1 | 2;
}) {
  const copy = locale === 'zh' ? COPY.zh : COPY.en;
  const TitleTag = titleLevel === 1 ? 'h1' : 'h2';
  const titleClassName = titleLevel === 1 ? 'text-2xl font-semibold text-foreground' : 'text-sm font-semibold text-foreground';
  const [automations, setAutomations] = useState<StudioAutomation[]>(() => readStudioAutomations());
  const [draft, setDraft] = useState<StudioAutomationDraft>(() => defaultDraft(projects));
  const [editingId, setEditingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const syncAutomations = () => setAutomations(readStudioAutomations());
    window.addEventListener(STUDIO_AUTOMATIONS_UPDATED_EVENT, syncAutomations);
    window.addEventListener('storage', syncAutomations);
    return () => {
      window.removeEventListener(STUDIO_AUTOMATIONS_UPDATED_EVENT, syncAutomations);
      window.removeEventListener('storage', syncAutomations);
    };
  }, []);

  useEffect(() => {
    setDraft((current) => {
      if (current.projectId || projects.length === 0) return current;
      return { ...current, projectId: projects[0].id };
    });
  }, [projects]);

  const projectOptions = useMemo(() => projects.map((project) => project.id), [projects]);
  const activeCount = automations.filter((automation) => automation.status === 'active').length;
  const nextAutomation = automations.find((automation) => automation.status === 'active' && automation.nextRun && automation.nextRun !== 'Manual');
  const editing = editingId ? automations.find((automation) => automation.id === editingId) : null;

  const resetForm = () => {
    setEditingId(null);
    setError(null);
    setDraft(defaultDraft(projects));
  };

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!draft.prompt.trim()) {
      setError(copy.required);
      return;
    }
    setError(null);
    const safeDraft: StudioAutomationDraft = {
      ...draft,
      projectId: draft.scope === 'project' ? draft.projectId || projects[0]?.id : undefined,
    };
    if (editingId) {
      updateStudioAutomation(editingId, safeDraft);
    } else {
      createStudioAutomation(safeDraft);
    }
    resetForm();
  };

  const beginEdit = (automation: StudioAutomation) => {
    setEditingId(automation.id);
    setError(null);
    setDraft(automationToDraft(automation, projects));
  };

  const applyTemplate = (template: Pick<StudioAutomationDraft, 'title' | 'prompt' | 'scope' | 'schedule' | 'effort'>) => {
    setDraft((current) => ({
      ...current,
      ...template,
      projectId: template.scope === 'project' ? current.projectId || projects[0]?.id : current.projectId,
    }));
    setError(null);
  };

  const templates = [
    {
      title: locale === 'zh' ? '研究雷达' : 'Research radar',
      prompt: locale === 'zh'
        ? '扫描已跟踪方向，筛选强论文，并生成中文研究雷达。'
        : 'Scan tracked directions, promote strong papers, and write the research radar.',
      scope: 'mind' as const,
      schedule: 'daily-0900' as const,
      effort: 'high' as const,
    },
    {
      title: locale === 'zh' ? '项目复盘' : 'Project review',
      prompt: locale === 'zh'
        ? '检查当前项目的待复盘项、最近对话和可沉淀经验。'
        : 'Review the current project, recent sessions, and reusable lessons.',
      scope: 'project' as const,
      schedule: 'weekly-review' as const,
      effort: 'normal' as const,
    },
  ];

  return (
    <section aria-labelledby="studio-automation-title" className="scroll-mt-[calc(var(--app-titlebar-h)+0.75rem)] overflow-hidden rounded-xl border border-border/60 bg-card/45">
      <div className="border-b border-border/60 px-4 py-4">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
          <div className="min-w-0">
            <div className="mb-2 inline-flex items-center gap-2 rounded-md border border-border/60 bg-background/60 px-2 py-1 text-[11px] font-medium text-muted-foreground">
              <Sparkles size={12} className="text-[var(--amber)]" aria-hidden="true" />
              {copy.localNote}
            </div>
            <TitleTag id="studio-automation-title" className={titleClassName}>{copy.title}</TitleTag>
            <p className="mt-1 max-w-3xl text-xs leading-relaxed text-muted-foreground">{copy.subtitle}</p>
          </div>
          <div className="grid min-w-0 gap-2 sm:grid-cols-2">
            <TextPill icon={<Play size={12} />} label={`${activeCount} ${copy.active}`} />
            <TextPill icon={<Clock3 size={12} />} label={nextAutomation?.nextRun ?? copy.manual} />
          </div>
        </div>
      </div>

      <div className="grid gap-0 xl:grid-cols-[minmax(0,1.05fr)_minmax(340px,0.95fr)]">
        <form onSubmit={submit} className="border-b border-border/60 p-4 xl:border-b-0 xl:border-r">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="min-w-0">
              <div className="text-[11px] font-medium text-[var(--amber)]">
                {editing ? copy.editKicker : copy.createKicker}
              </div>
              <h3 className="mt-1 text-base font-semibold text-foreground">{editing ? copy.editTitle : copy.createTitle}</h3>
            </div>
            {editing ? (
              <Button type="button" variant="ghost" size="sm" onClick={resetForm}>
                <X size={13} aria-hidden="true" />
                {copy.cancel}
              </Button>
            ) : null}
          </div>

          <p className="mt-2 text-xs leading-relaxed text-muted-foreground">{copy.createHint}</p>

          <div className="mt-4 grid gap-3">
            <label className="grid gap-1.5">
              <span className="text-xs font-medium text-muted-foreground">{copy.titleLabel}</span>
              <input
                aria-label={copy.titleAria}
                value={draft.title}
                onChange={(event) => setDraft((current) => ({ ...current, title: event.target.value }))}
                placeholder={copy.titlePlaceholder}
                className="h-11 rounded-lg border border-border/70 bg-background/75 px-3 text-sm text-foreground outline-none transition-colors placeholder:text-muted-foreground/55 focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/35"
              />
            </label>
            <label className="grid gap-1.5">
              <span className="text-xs font-medium text-muted-foreground">{copy.promptLabel}</span>
              <textarea
                aria-label={copy.promptAria}
                value={draft.prompt}
                onChange={(event) => setDraft((current) => ({ ...current, prompt: event.target.value }))}
                placeholder={copy.promptPlaceholder}
                rows={7}
                className="min-h-40 resize-none rounded-lg border border-border/70 bg-background/75 px-3 py-3 text-sm leading-relaxed text-foreground outline-none transition-colors placeholder:text-muted-foreground/55 focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/35"
              />
            </label>
          </div>

          <div className="mt-3">
            <div className="mb-2 flex items-center gap-1.5 text-[11px] font-medium text-muted-foreground">
              <Info size={12} aria-hidden="true" />
              {copy.templates}
            </div>
            <div className="flex flex-wrap gap-1.5">
              {templates.map((template) => (
                <TemplateButton
                  key={template.title}
                  title={template.title}
                  prompt={template.prompt}
                  copy={copy}
                  onUse={() => applyTemplate(template)}
                />
              ))}
            </div>
          </div>

          <div className="mt-4 grid gap-2 sm:grid-cols-2">
            <ControlSelect
              icon={<FolderGit2 size={13} />}
              label={copy.scopeLabel}
              value={draft.scope}
              values={SCOPE_OPTIONS}
              onChange={(scope) => setDraft((current) => ({ ...current, scope }))}
              renderLabel={(scope) => scopeLabel(scope, copy)}
            />
            <ControlSelect
              icon={<Layers3 size={13} />}
              label={copy.projectLabel}
              value={draft.projectId ?? ''}
              values={projectOptions.length ? projectOptions : ['']}
              disabled={draft.scope !== 'project' || projectOptions.length === 0}
              onChange={(projectId) => setDraft((current) => ({ ...current, projectId }))}
              renderLabel={(projectId) => projectLabel(projects, projectId, locale, copy.noProject)}
            />
            <ControlSelect
              icon={<CalendarClock size={13} />}
              label={copy.scheduleLabel}
              value={draft.schedule}
              values={SCHEDULE_OPTIONS}
              onChange={(schedule) => setDraft((current) => ({ ...current, schedule }))}
              renderLabel={(schedule) => scheduleLabel(schedule, copy)}
            />
            <ControlSelect
              icon={<Bot size={13} />}
              label={copy.modelLabel}
              value={draft.model}
              values={MODEL_OPTIONS}
              onChange={(model) => setDraft((current) => ({ ...current, model }))}
              renderLabel={(model) => modelLabel(model, copy)}
            />
            <ControlSelect
              icon={<Sparkles size={13} />}
              label={copy.effortLabel}
              value={draft.effort}
              values={EFFORT_OPTIONS}
              onChange={(effort) => setDraft((current) => ({ ...current, effort }))}
              renderLabel={(effort) => effortLabel(effort, copy)}
            />
            <Button type="submit" variant="amber" size="xl" className="h-10 justify-center">
              <Plus size={14} aria-hidden="true" />
              {editing ? copy.save : copy.create}
            </Button>
          </div>

          {error ? <p className="mt-3 text-xs font-medium text-error">{error}</p> : null}
        </form>

        <div className="min-w-0 p-4">
          <div className="mb-3 flex flex-col gap-1 sm:flex-row sm:items-end sm:justify-between">
            <div>
              <h3 className="text-sm font-semibold text-foreground">{copy.existingTitle}</h3>
              <p className="mt-1 text-xs leading-relaxed text-muted-foreground">{copy.existingHint}</p>
            </div>
          </div>
          {automations.length ? (
            <div className="grid gap-3">
              {automations.map((automation) => (
                <AutomationCard
                  key={automation.id}
                  automation={automation}
                  projects={projects}
                  locale={locale}
                  copy={copy}
                  onEdit={beginEdit}
                  onToggle={(item) => {
                    toggleStudioAutomationStatus(item.id);
                    setAutomations(readStudioAutomations());
                  }}
                />
              ))}
            </div>
          ) : (
            <div className="rounded-lg border border-dashed border-border/70 px-4 py-8 text-center text-sm text-muted-foreground">
              {copy.empty}
            </div>
          )}
        </div>
      </div>
    </section>
  );
}
