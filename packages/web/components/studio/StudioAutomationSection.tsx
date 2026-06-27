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
import { type FormEvent, type ReactNode, useCallback, useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { Button } from '@/components/ui/button';
import {
  scheduleLabel,
  StudioAutomationSchedulePicker,
} from '@/components/studio/StudioAutomationSchedulePicker';
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
    scheduleLabel: 'Repeats',
    repeatGroupManual: 'Manual',
    repeatGroupDaily: 'Daily',
    repeatGroupWeekly: 'Weekly',
    repeatGroupMonthly: 'Monthly',
    repeatGroupInterval: 'Interval',
    modelLabel: 'Model',
    effortLabel: 'Effort',
    cancel: 'Cancel',
    create: 'Create automation',
    save: 'Save changes',
    required: 'Add a prompt before creating an automation.',
    existingTitle: 'Existing automations',
    existingHint: 'Created automations stay editable; pause them when they should stop appearing as active work.',
    total: 'Total',
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
    hourly: 'Every hour',
    every2Hours: 'Every 2 hours',
    every4Hours: 'Every 4 hours',
    daily: 'Every day 9:00 AM',
    dailyEvening: 'Every day 6:00 PM',
    twiceDaily: 'Twice daily',
    weekdays: 'Weekdays 9:00 AM',
    weekdaysEvening: 'Weekdays 6:00 PM',
    weeklyMonday: 'Mondays 9:00 AM',
    weeklyFriday: 'Fridays 5:30 PM',
    weekly: 'Weekly review',
    monthlyFirst: 'First day 9:00 AM',
    monthlyLast: 'Last day 5:00 PM',
    manualHint: 'Run only when started',
    hourlyHint: 'For fast-moving watchlists',
    every2HoursHint: 'Frequent checks with breathing room',
    every4HoursHint: 'A steady daytime pulse',
    dailyHint: 'A morning operating rhythm',
    dailyEveningHint: 'End-of-day synthesis',
    twiceDailyHint: 'Morning and evening checkpoints',
    weekdaysHint: 'Skips weekends by default',
    weekdaysEveningHint: 'Close the loop after work',
    weeklyMondayHint: 'Start the week with context',
    weeklyFridayHint: 'Wrap the week with review',
    weeklyHint: 'Designed for retrospectives',
    monthlyFirstHint: 'Monthly planning reset',
    monthlyLastHint: 'Month-end consolidation',
    autoModel: 'MindOS Auto',
    gptModel: 'GPT-5.5',
    claudeModel: 'Claude Code',
    localModel: 'Local Agent',
    normalEffort: 'Normal',
    highEffort: 'High',
    extraHighEffort: 'Extra High',
    noProject: 'No Project',
    localNote: 'Local Studio plan',
    close: 'Close drawer',
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
    scheduleLabel: '重复',
    repeatGroupManual: '手动',
    repeatGroupDaily: '每日',
    repeatGroupWeekly: '每周',
    repeatGroupMonthly: '每月',
    repeatGroupInterval: '间隔',
    modelLabel: '模型',
    effortLabel: '强度',
    cancel: '取消',
    create: '创建自动化',
    save: '保存更改',
    required: '创建自动化前需要先写提示词。',
    existingTitle: '已有自动化',
    existingHint: '已创建的自动化可以随时编辑；暂时不用时可以暂停。',
    total: '总数',
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
    hourly: '每小时',
    every2Hours: '每 2 小时',
    every4Hours: '每 4 小时',
    daily: '每天 9:00',
    dailyEvening: '每天 18:00',
    twiceDaily: '每天两次',
    weekdays: '工作日 9:00',
    weekdaysEvening: '工作日 18:00',
    weeklyMonday: '周一 9:00',
    weeklyFriday: '周五 17:30',
    weekly: '每周复盘',
    monthlyFirst: '每月第一天 9:00',
    monthlyLast: '每月最后一天 17:00',
    manualHint: '只在手动启动时运行',
    hourlyHint: '适合高频监控',
    every2HoursHint: '频繁检查但保留间隔',
    every4HoursHint: '稳定的日间节奏',
    dailyHint: '早晨固定巡检',
    dailyEveningHint: '收尾时做综合',
    twiceDailyHint: '早晚各一次检查点',
    weekdaysHint: '默认跳过周末',
    weekdaysEveningHint: '工作日结束前闭环',
    weeklyMondayHint: '用上下文开启一周',
    weeklyFridayHint: '周末前做复盘',
    weeklyHint: '适合阶段性复盘',
    monthlyFirstHint: '月初规划重置',
    monthlyLastHint: '月底归档汇总',
    autoModel: 'MindOS 自动',
    gptModel: 'GPT-5.5',
    claudeModel: 'Claude Code',
    localModel: '本地 Agent',
    normalEffort: '标准',
    highEffort: '高',
    extraHighEffort: '极高',
    noProject: '无项目',
    localNote: '工作台本地计划',
    close: '关闭抽屉',
  },
} as const;

type StudioAutomationCopy = (typeof COPY)[keyof typeof COPY];

const SCOPE_OPTIONS: StudioAutomationScope[] = ['worktree', 'project', 'mind'];
const MODEL_OPTIONS: StudioAutomationModel[] = ['mindos-auto', 'gpt-5.5', 'claude-code', 'local-agent'];
const EFFORT_OPTIONS: StudioAutomationEffort[] = ['normal', 'high', 'extra-high'];

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
    <label className={`grid min-w-0 gap-1.5 ${disabled ? 'opacity-55' : ''}`}>
      <span className="flex items-center gap-1.5 text-[11px] font-medium text-muted-foreground">
        <span className="shrink-0 text-[var(--amber)]" aria-hidden="true">{icon}</span>
        {label}
      </span>
      <span className={`group flex h-10 min-w-0 items-center gap-2 rounded-lg border border-border/60 bg-background/65 px-3 text-xs transition-colors focus-within:border-ring focus-within:ring-2 focus-within:ring-ring/20 ${
        disabled ? '' : 'hover:border-[var(--amber)]/40 hover:bg-background'
      }`}>
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
      </span>
    </label>
  );
}

function TextPill({ icon, label }: { icon: ReactNode; label: string }) {
  return (
    <span className="inline-flex min-w-0 items-center gap-1.5 rounded-md bg-muted/35 px-2 py-1 text-[11px] font-medium text-muted-foreground">
      <span className="shrink-0 text-[var(--amber)]" aria-hidden="true">{icon}</span>
      <span className="min-w-0 truncate">{label}</span>
    </span>
  );
}

function AutomationMetric({
  icon,
  label,
  value,
}: {
  icon: ReactNode;
  label: string;
  value: string | number;
}) {
  return (
    <div className="flex min-w-0 items-center gap-2 border-t border-border/60 p-3 first:border-t-0 sm:border-l sm:border-t-0 sm:first:border-l-0">
      <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-[var(--amber-subtle)] text-[var(--amber)]">
        {icon}
      </span>
      <span className="min-w-0">
        <span className="block text-[11px] text-muted-foreground">{label}</span>
        <span className="block truncate text-sm font-semibold text-foreground [font-variant-numeric:tabular-nums]">
          {value}
        </span>
      </span>
    </div>
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
      className="inline-flex max-w-full items-center gap-1.5 rounded-md bg-muted/35 px-2.5 py-1.5 text-xs font-medium text-muted-foreground transition-colors hover:bg-[var(--amber-subtle)] hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
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
  const isActive = automation.status === 'active';
  const statusClass = automation.status === 'active'
    ? 'border-success/30 bg-success/10 text-success'
    : 'border-border/60 bg-muted/45 text-muted-foreground';
  const scopeText = automation.scope === 'project'
    ? `${scopeLabel(automation.scope, copy)} / ${projectLabel(projects, automation.projectId, locale, copy.noProject)}`
    : scopeLabel(automation.scope, copy);

  return (
    <article data-studio-automation-card className="group relative grid min-w-0 gap-3 border-t border-border/55 px-4 py-4 transition-colors first:border-t-0 hover:bg-muted/25 xl:grid-cols-[minmax(0,1fr)_minmax(220px,auto)] xl:items-center">
      <span className={`pointer-events-none absolute bottom-3 left-0 top-3 w-px rounded-r-full transition-colors group-hover:bg-[var(--amber)] ${
        isActive ? 'bg-[var(--amber)]' : 'bg-transparent'
      }`} />
      <div className="flex min-w-0 gap-3 pr-0">
        <span className={`mt-0.5 hidden h-9 w-9 shrink-0 items-center justify-center rounded-md transition-colors sm:inline-flex ${
          isActive
            ? 'bg-[var(--amber-subtle)] text-[var(--amber)] group-hover:bg-[var(--amber-dim)]'
            : 'bg-muted/45 text-muted-foreground'
        }`}>
          {isActive ? <Play size={15} aria-hidden="true" /> : <Pause size={15} aria-hidden="true" />}
        </span>
        <div className="min-w-0">
          <div className="flex min-w-0 flex-wrap items-center gap-2">
            <h3 className="min-w-0 text-[15px] font-semibold text-foreground">{title}</h3>
            <span className={`inline-flex h-6 shrink-0 items-center rounded-md border px-2 text-[11px] font-medium ${statusClass}`}>
              {statusLabel}
            </span>
          </div>
          <p className="mt-1 line-clamp-2 max-w-[64ch] text-xs leading-relaxed text-muted-foreground">{prompt}</p>
          <div className="mt-3 flex flex-wrap gap-1.5">
            <TextPill icon={<FolderGit2 size={12} />} label={scopeText} />
            <TextPill icon={<CalendarClock size={12} />} label={scheduleLabel(automation.schedule, copy)} />
            <TextPill icon={<Bot size={12} />} label={`${modelLabel(automation.model, copy)} / ${effortLabel(automation.effort, copy)}`} />
          </div>
        </div>
      </div>

      <div className="flex min-w-0 flex-col gap-3 sm:flex-row sm:items-center sm:justify-between xl:block xl:text-right">
        <div className="flex min-w-0 flex-wrap gap-x-4 gap-y-1 text-[11px] text-muted-foreground xl:block xl:space-y-1">
          <span className="block">{copy.nextRun}: {automation.nextRun ?? copy.localNote}</span>
          <span className="block">{copy.lastRun}: {automation.lastRun ?? copy.localNote}</span>
          <span className="block [font-variant-numeric:tabular-nums]">{automation.runCount} {copy.runs}</span>
        </div>
        <div className="flex shrink-0 items-center gap-2 xl:mt-3 xl:justify-end">
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
    </article>
  );
}

function AutomationDrawer({
  open,
  editing,
  copy,
  draft,
  projects,
  locale,
  projectOptions,
  templates,
  error,
  onClose,
  onSubmit,
  onDraftChange,
  onApplyTemplate,
}: {
  open: boolean;
  editing: StudioAutomation | null | undefined;
  copy: StudioAutomationCopy;
  draft: StudioAutomationDraft;
  projects: StudioProject[];
  locale: string;
  projectOptions: string[];
  templates: Array<Pick<StudioAutomationDraft, 'title' | 'prompt' | 'scope' | 'schedule' | 'effort'>>;
  error: string | null;
  onClose: () => void;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
  onDraftChange: (updater: (current: StudioAutomationDraft) => StudioAutomationDraft) => void;
  onApplyTemplate: (template: Pick<StudioAutomationDraft, 'title' | 'prompt' | 'scope' | 'schedule' | 'effort'>) => void;
}) {
  if (!open) return null;

  const drawer = (
    <>
      <div
        className="fixed inset-x-0 bottom-0 top-[calc(var(--app-titlebar-h)+52px)] z-app-popover overlay-backdrop transition-opacity duration-200 md:top-[var(--app-titlebar-h)]"
        onClick={onClose}
        aria-hidden="true"
      />
      <form
        data-studio-automation-drawer
        data-studio-automation-composer
        onSubmit={onSubmit}
        role="dialog"
        aria-modal="true"
        aria-labelledby="studio-automation-drawer-title"
        aria-describedby="studio-automation-drawer-description"
        className="fixed bottom-0 right-0 top-[calc(var(--app-titlebar-h)+52px)] z-app-popover-flyout flex w-full max-w-xl flex-col border-l border-border bg-background shadow-2xl transition-transform duration-200 ease-out md:top-[var(--app-titlebar-h)]"
      >
        <div className="shrink-0 border-b border-border/60 bg-background px-5 py-4 sm:px-6">
          <div className="flex min-w-0 items-start justify-between gap-4">
            <div className="min-w-0">
              <div className="flex items-center gap-2 text-[11px] font-medium text-muted-foreground">
                <Sparkles size={12} className="text-[var(--amber)]" aria-hidden="true" />
                {editing ? copy.editKicker : copy.createKicker}
              </div>
              <h2 id="studio-automation-drawer-title" className="mt-1 text-lg font-semibold text-foreground">
                {editing ? copy.editTitle : copy.createTitle}
              </h2>
              <p
                id="studio-automation-drawer-description"
                className="mt-1 max-w-md text-xs leading-relaxed text-muted-foreground"
              >
                {copy.createHint}
              </p>
            </div>
            <button
              data-studio-automation-drawer-close
              type="button"
              onMouseDown={(event) => {
                event.preventDefault();
                onClose();
              }}
              onClick={onClose}
              aria-label={copy.close}
              className="inline-flex size-8 shrink-0 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              <X size={16} aria-hidden="true" />
            </button>
          </div>
        </div>

        <div className="flex-1 overflow-y-auto px-5 py-5 sm:px-6">
          <div className="grid gap-5">
            <div className="grid gap-3">
              <label className="grid gap-1.5">
                <span className="text-xs font-medium text-muted-foreground">{copy.titleLabel}</span>
                <input
                  aria-label={copy.titleAria}
                  autoFocus
                  value={draft.title}
                  onChange={(event) => onDraftChange((current) => ({ ...current, title: event.target.value }))}
                  placeholder={copy.titlePlaceholder}
                  className="h-11 rounded-lg border border-border/70 bg-background/75 px-3 text-sm text-foreground outline-none transition-colors placeholder:text-muted-foreground/55 focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/35"
                />
              </label>
              <label className="grid gap-1.5">
                <span className="text-xs font-medium text-muted-foreground">{copy.promptLabel}</span>
                <textarea
                  aria-label={copy.promptAria}
                  value={draft.prompt}
                  onChange={(event) => onDraftChange((current) => ({ ...current, prompt: event.target.value }))}
                  placeholder={copy.promptPlaceholder}
                  rows={8}
                  className="min-h-48 resize-none rounded-lg border border-border/70 bg-background/75 px-3 py-3 text-sm leading-relaxed text-foreground outline-none transition-colors placeholder:text-muted-foreground/55 focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/35"
                />
              </label>
            </div>

            <section className="grid gap-2 border-t border-border/55 pt-4" aria-label={copy.templates}>
              <div className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
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
                    onUse={() => onApplyTemplate(template)}
                  />
                ))}
              </div>
            </section>

            <StudioAutomationSchedulePicker
              copy={copy}
              value={draft.schedule}
              onChange={(schedule) => onDraftChange((current) => ({ ...current, schedule }))}
            />

            <div className="grid gap-3 border-t border-border/55 pt-4 sm:grid-cols-2">
              <ControlSelect
                icon={<FolderGit2 size={13} />}
                label={copy.scopeLabel}
                value={draft.scope}
                values={SCOPE_OPTIONS}
                onChange={(scope) => onDraftChange((current) => ({ ...current, scope }))}
                renderLabel={(scope) => scopeLabel(scope, copy)}
              />
              <ControlSelect
                icon={<Layers3 size={13} />}
                label={copy.projectLabel}
                value={draft.projectId ?? ''}
                values={projectOptions.length ? projectOptions : ['']}
                disabled={draft.scope !== 'project' || projectOptions.length === 0}
                onChange={(projectId) => onDraftChange((current) => ({ ...current, projectId }))}
                renderLabel={(projectId) => projectLabel(projects, projectId, locale, copy.noProject)}
              />
              <ControlSelect
                icon={<Bot size={13} />}
                label={copy.modelLabel}
                value={draft.model}
                values={MODEL_OPTIONS}
                onChange={(model) => onDraftChange((current) => ({ ...current, model }))}
                renderLabel={(model) => modelLabel(model, copy)}
              />
              <ControlSelect
                icon={<Sparkles size={13} />}
                label={copy.effortLabel}
                value={draft.effort}
                values={EFFORT_OPTIONS}
                onChange={(effort) => onDraftChange((current) => ({ ...current, effort }))}
                renderLabel={(effort) => effortLabel(effort, copy)}
              />
            </div>

            {error ? <p className="text-xs font-medium text-error">{error}</p> : null}
          </div>
        </div>

        <div className="shrink-0 border-t border-border/60 bg-background px-5 py-4 sm:px-6 md:pr-20">
          <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
            <Button type="button" variant="outline" size="lg" onClick={onClose} className="justify-center">
              {copy.cancel}
            </Button>
            <Button type="submit" variant="amber" size="lg" className="justify-center">
              <Plus size={14} aria-hidden="true" />
              {editing ? copy.save : copy.create}
            </Button>
          </div>
        </div>
      </form>
    </>
  );

  return typeof document === 'undefined' ? drawer : createPortal(drawer, document.body);
}

export default function StudioAutomationSection({
  projects,
  locale,
  titleLevel = 2,
  beforeTitle,
}: {
  projects: StudioProject[];
  locale: string;
  titleLevel?: 1 | 2;
  beforeTitle?: ReactNode;
}) {
  const copy = locale === 'zh' ? COPY.zh : COPY.en;
  const TitleTag = titleLevel === 1 ? 'h1' : 'h2';
  const titleClassName = titleLevel === 1 ? 'text-2xl font-semibold text-foreground' : 'text-sm font-semibold text-foreground';
  const [automations, setAutomations] = useState<StudioAutomation[]>(() => readStudioAutomations());
  const [draft, setDraft] = useState<StudioAutomationDraft>(() => defaultDraft(projects));
  const [editingId, setEditingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [drawerOpen, setDrawerOpen] = useState(false);

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

  const resetForm = useCallback(() => {
    setEditingId(null);
    setError(null);
    setDraft(defaultDraft(projects));
  }, [projects]);

  const closeDrawer = useCallback(() => {
    setDrawerOpen(false);
    resetForm();
  }, [resetForm]);

  const openCreate = () => {
    resetForm();
    setDrawerOpen(true);
  };

  useEffect(() => {
    if (!drawerOpen) return undefined;

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        closeDrawer();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [closeDrawer, drawerOpen]);

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
    setDrawerOpen(false);
    resetForm();
  };

  const beginEdit = (automation: StudioAutomation) => {
    setEditingId(automation.id);
    setError(null);
    setDraft(automationToDraft(automation, projects));
    setDrawerOpen(true);
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
    <section
      data-studio-automation-section
      aria-labelledby="studio-automation-title"
      className="scroll-mt-[calc(var(--app-titlebar-h)+0.75rem)] space-y-6"
    >
      <header className="border-b border-border/60 pb-6">
        {beforeTitle ? <div className="mb-3">{beforeTitle}</div> : null}
        <div className="flex flex-col gap-4 xl:flex-row xl:items-start xl:justify-between">
          <div className="min-w-0">
            <TitleTag id="studio-automation-title" className={titleClassName}>{copy.title}</TitleTag>
            <p className="mt-1 max-w-2xl text-sm leading-relaxed text-muted-foreground">{copy.subtitle}</p>
          </div>
          <Button
            data-studio-automation-create
            type="button"
            onClick={openCreate}
            variant="amber"
            size="lg"
            className="shrink-0"
          >
            <Plus size={15} aria-hidden="true" />
            {copy.create}
          </Button>
        </div>
      </header>

      <section className="space-y-6">
        <div data-studio-automation-summary className="grid overflow-hidden rounded-lg border border-border/60 bg-background/35 sm:grid-cols-3">
          <AutomationMetric icon={<Play size={13} aria-hidden="true" />} label={copy.active} value={activeCount} />
          <AutomationMetric icon={<Clock3 size={13} aria-hidden="true" />} label={copy.nextRun} value={nextAutomation?.nextRun ?? copy.manual} />
          <AutomationMetric icon={<Layers3 size={13} aria-hidden="true" />} label={copy.total} value={automations.length} />
        </div>

        <section data-studio-automation-list className="min-w-0 space-y-3" aria-labelledby="studio-automation-existing">
          <div className="flex flex-col gap-1 sm:flex-row sm:items-end sm:justify-between">
            <div>
              <div className="flex items-center gap-2">
                <h3 id="studio-automation-existing" className="text-sm font-semibold text-foreground">{copy.existingTitle}</h3>
                <span className="rounded-md bg-muted/55 px-2 py-0.5 text-[11px] font-medium text-muted-foreground [font-variant-numeric:tabular-nums]">
                  {automations.length}
                </span>
              </div>
              <p className="mt-1 text-xs leading-relaxed text-muted-foreground">{copy.existingHint}</p>
            </div>
          </div>
          {automations.length ? (
            <div className="overflow-hidden rounded-lg border border-border/60 bg-background/35">
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
            <div className="rounded-lg border border-dashed border-border/70 bg-background/35 px-4 py-8 text-center text-sm text-muted-foreground">
              {copy.empty}
            </div>
          )}
        </section>
      </section>

      <AutomationDrawer
        open={drawerOpen}
        editing={editing}
        copy={copy}
        draft={draft}
        projects={projects}
        locale={locale}
        projectOptions={projectOptions}
        templates={templates}
        error={error}
        onClose={closeDrawer}
        onSubmit={submit}
        onDraftChange={setDraft}
        onApplyTemplate={applyTemplate}
      />
    </section>
  );
}
