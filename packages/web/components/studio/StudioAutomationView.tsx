'use client';

import {
  Bot,
  ChevronDown,
  Edit3,
  FolderGit2,
  Info,
  Layers3,
  Pause,
  Play,
  Plus,
  Search,
  Sparkles,
  Trash2,
  WandSparkles,
  X,
} from 'lucide-react';
import { type FormEvent, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { Button } from '@/components/ui/button';
import {
  scheduleLabel,
} from '@/components/studio/StudioAutomationSchedulePicker';
import { StudioAutomationTriggerPicker } from '@/components/studio/StudioAutomationTriggerPicker';
import {
  type StudioAutomation,
  type StudioAutomationDraft,
  type StudioAutomationEffort,
  type StudioAutomationModel,
  type StudioAutomationPermissionMode,
  type StudioAutomationScope,
} from '@/lib/studio-automations';
import {
  localize,
  type StudioProject,
} from '@/lib/studio-projects';

export const COPY = {
  en: {
    title: 'Automation',
    subtitle: 'Turn recurring agent work into calm, reviewable routines.',
    allLabel: 'All',
    enabledLabel: 'Enabled',
    pausedLabel: 'Paused',
    statusFilterLabel: 'Automation status filter',
    searchLabel: 'Search automations',
    searchPlaceholder: 'Search automations...',
    createKicker: 'Create',
    editKicker: 'Editing',
    createTitle: 'Create automation',
    editTitle: 'Edit automation',
    createHint: 'Describe the outcome, choose a cadence, and keep the plan reviewable before runtime handoff.',
    titleLabel: 'Name',
    titleAria: 'Automation title',
    titlePlaceholder: 'Daily release sweep',
    optional: 'Optional',
    promptLabel: 'Outcome',
    promptAria: 'Automation prompt',
    promptPlaceholder: 'Ask MindOS to review open release notes, check blockers, and summarize the next move.',
    templates: 'Start from',
    useTemplate: 'Use template',
    scopeLabel: 'Scope',
    projectLabel: 'Project',
    scheduleLabel: 'Repeats',
    triggerLabel: 'Starts when',
    triggerSchedule: 'Schedule',
    triggerEvent: 'Event',
    eventSourceLabel: 'Event source',
    eventSourcePlaceholder: 'feishu, inbox, agent, knowledge, api',
    eventTypeLabel: 'Event type',
    eventTypePlaceholder: 'inbox.created or *',
    eventDebounceLabel: 'Debounce (seconds)',
    eventStormLabel: 'Max events / minute',
    eventFilterLabel: 'Metadata filter (JSON)',
    eventFilterPlaceholder: '{"message.chat_type":"p2p","mentionsBot":true}',
    eventFilterHint: 'Optional exact matches. Dot paths can address nested payload fields.',
    eventFilterError: 'Use a flat JSON object with string, number, or boolean values.',
    eventHint: 'Sources and event types accept comma-separated values or *. Duplicate source keys run at most once.',
    eventWaiting: 'Waiting for a matching event',
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
    loading: 'Loading automations...',
    loadError: 'Automation runtime is unavailable. Check the schedule store and try again.',
    active: 'Active',
    paused: 'Paused',
    pause: 'Pause',
    resume: 'Resume',
    edit: 'Edit',
    delete: 'Delete',
    deleteConfirm: 'Delete this automation? It will be removed from the Pi schedule store.',
    runNow: 'Run now',
    nextRun: 'Next',
    runtimeSchedule: 'Durable worker',
    runtimeNote: 'Runs independently, even when the Web app is closed',
    executorOnline: 'Executor online',
    executorOffline: 'Executor not installed',
    executorStopped: 'Executor stopped',
    executorError: 'Executor needs attention',
    eventQueue: 'Queued event deliveries',
    recentEvents: 'Recent events',
    notifications: 'Notifications',
    pendingApprovals: 'Pending approvals',
    allowOnce: 'Allow once',
    deny: 'Deny',
    dismiss: 'Dismiss',
    dismissAll: 'Dismiss all',
    runStatePending: 'Pending',
    runStateRunning: 'Running',
    runStateWaitingApproval: 'Waiting for approval',
    runStateSuccess: 'Last run succeeded',
    runStateError: 'Last run failed',
    runStateTimedOut: 'Last run timed out',
    runStateInterrupted: 'Last run was interrupted',
    latestResult: 'Latest result',
    permissionLabel: 'Unattended access',
    permissionRead: 'Read only',
    permissionAsk: 'Ask before writes',
    permissionAuto: 'Allow Mind writes',
    advanced: 'Advanced settings',
    empty: 'No automations match this workspace yet.',
    emptySearch: 'No automations match this search.',
    emptyEnabled: 'No enabled automations yet.',
    emptyEnabledSearch: 'No enabled automations match this search.',
    emptyPaused: 'No paused automations yet.',
    emptyPausedSearch: 'No paused automations match this search.',
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
    codexModel: 'Codex',
    normalEffort: 'Normal',
    highEffort: 'High',
    extraHighEffort: 'Extra High',
    noProject: 'No Project',
    close: 'Close drawer',
  },
  zh: {
    title: '自动化',
    subtitle: '把重复 Agent 工作整理成清晰、可审核的节奏。',
    allLabel: '全部',
    enabledLabel: '启用',
    pausedLabel: '暂停',
    statusFilterLabel: '自动化状态筛选',
    searchLabel: '搜索自动化',
    searchPlaceholder: '搜索自动化...',
    createKicker: '创建',
    editKicker: '编辑中',
    createTitle: '创建自动化',
    editTitle: '编辑自动化',
    createHint: '描述结果、选择节奏，并在接入运行时前保持可审核。',
    titleLabel: '名称',
    titleAria: '自动化标题',
    titlePlaceholder: '每日发布巡检',
    optional: '可选',
    promptLabel: '目标',
    promptAria: '自动化提示词',
    promptPlaceholder: '让 MindOS 检查发布记录、风险阻塞和下一步动作。',
    templates: '从模板开始',
    useTemplate: '套用模板',
    scopeLabel: '范围',
    projectLabel: '项目',
    scheduleLabel: '重复',
    triggerLabel: '启动条件',
    triggerSchedule: '定时',
    triggerEvent: '事件',
    eventSourceLabel: '事件来源',
    eventSourcePlaceholder: 'feishu, inbox, agent, knowledge, api',
    eventTypeLabel: '事件类型',
    eventTypePlaceholder: 'inbox.created 或 *',
    eventDebounceLabel: '防抖（秒）',
    eventStormLabel: '每分钟最多事件数',
    eventFilterLabel: '元数据筛选（JSON）',
    eventFilterPlaceholder: '{"message.chat_type":"p2p","mentionsBot":true}',
    eventFilterHint: '可选精确匹配；用点路径读取嵌套 payload 字段。',
    eventFilterError: '请使用只含字符串、数字或布尔值的扁平 JSON 对象。',
    eventHint: '来源和事件类型可用逗号分隔，或使用 *。相同来源键最多执行一次。',
    eventWaiting: '等待匹配事件',
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
    loading: '正在加载自动化...',
    loadError: '自动化运行时暂时不可用。请检查调度存储后重试。',
    active: '启用',
    paused: '暂停',
    pause: '暂停',
    resume: '恢复',
    edit: '编辑',
    delete: '删除',
    deleteConfirm: '要删除这个自动化吗？它会从持久自动化存储中移除。',
    runNow: '立即运行',
    nextRun: '下次',
    runtimeSchedule: '持久 Worker',
    runtimeNote: '独立运行，关闭 Web 页面后仍会继续',
    executorOnline: '执行器在线',
    executorOffline: '执行器尚未安装',
    executorStopped: '执行器已停止',
    executorError: '执行器需要处理',
    eventQueue: '排队中的事件投递',
    recentEvents: '近期事件',
    notifications: '通知',
    pendingApprovals: '待审批',
    allowOnce: '仅允许一次',
    deny: '拒绝',
    dismiss: '忽略',
    dismissAll: '全部忽略',
    runStatePending: '等待运行',
    runStateRunning: '运行中',
    runStateWaitingApproval: '等待审批',
    runStateSuccess: '上次运行成功',
    runStateError: '上次运行失败',
    runStateTimedOut: '上次运行超时',
    runStateInterrupted: '上次运行被中断',
    latestResult: '最近结果',
    permissionLabel: '无人值守权限',
    permissionRead: '只读',
    permissionAsk: '写入前询问',
    permissionAuto: '允许写入 Mind',
    advanced: '高级设置',
    empty: '这个工作区还没有自动化。',
    emptySearch: '没有匹配的自动化。',
    emptyEnabled: '还没有启用的自动化。',
    emptyEnabledSearch: '没有匹配的启用自动化。',
    emptyPaused: '还没有暂停的自动化。',
    emptyPausedSearch: '没有匹配的暂停自动化。',
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
    codexModel: 'Codex',
    normalEffort: '标准',
    highEffort: '高',
    extraHighEffort: '极高',
    noProject: '无项目',
    close: '关闭抽屉',
  },
} as const;

export type StudioAutomationCopy = (typeof COPY)[keyof typeof COPY];
export type AutomationStatusFilter = 'all' | 'enabled' | 'paused';

const SCOPE_OPTIONS: StudioAutomationScope[] = ['worktree', 'project', 'mind'];
const MODEL_OPTIONS: StudioAutomationModel[] = ['mindos-auto', 'gpt-5.5', 'codex', 'claude-code'];
const EFFORT_OPTIONS: StudioAutomationEffort[] = ['normal', 'high', 'extra-high'];
const PI_PERMISSION_OPTIONS: StudioAutomationPermissionMode[] = ['read', 'auto'];
const NATIVE_PERMISSION_OPTIONS: StudioAutomationPermissionMode[] = ['read', 'ask', 'auto'];

function scopeLabel(scope: StudioAutomationScope, copy: StudioAutomationCopy): string {
  if (scope === 'worktree') return copy.worktree;
  if (scope === 'project') return copy.project;
  return copy.mind;
}

function modelLabel(model: StudioAutomationModel, copy: StudioAutomationCopy): string {
  if (model === 'mindos-auto') return copy.autoModel;
  if (model === 'gpt-5.5') return copy.gptModel;
  if (model === 'claude-code') return copy.claudeModel;
  return copy.codexModel;
}

function effortLabel(effort: StudioAutomationEffort, copy: StudioAutomationCopy): string {
  if (effort === 'normal') return copy.normalEffort;
  if (effort === 'high') return copy.highEffort;
  return copy.extraHighEffort;
}

function permissionLabel(permission: StudioAutomationPermissionMode, copy: StudioAutomationCopy): string {
  if (permission === 'auto') return copy.permissionAuto;
  if (permission === 'ask') return copy.permissionAsk;
  return copy.permissionRead;
}

export function defaultDraft(projects: StudioProject[]): StudioAutomationDraft {
  return {
    title: '',
    prompt: '',
    scope: 'worktree',
    projectId: projects[0]?.id,
    schedule: 'daily-0900',
    trigger: { type: 'schedule', schedule: 'daily-0900', timezone: 'Asia/Shanghai' },
    model: 'mindos-auto',
    effort: 'high',
    timezone: 'Asia/Shanghai',
    permissionMode: 'read',
    retry: 'once',
    timeoutMs: 600000,
  };
}

export function automationToDraft(automation: StudioAutomation, projects: StudioProject[]): StudioAutomationDraft {
  return {
    title: automation.title,
    prompt: automation.prompt,
    scope: automation.scope,
    projectId: automation.projectId ?? projects[0]?.id,
    schedule: automation.schedule,
    trigger: automation.trigger ?? (automation.schedule === 'manual'
      ? { type: 'manual' }
      : { type: 'schedule', schedule: automation.schedule, timezone: automation.timezone }),
    model: automation.model,
    effort: automation.effort,
    timezone: automation.timezone,
    permissionMode: automation.permissionMode,
    retry: automation.retry,
    timeoutMs: automation.timeoutMs,
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

function MetaText({ label }: { label: string }) {
  return (
    <span className="inline-flex min-w-0 items-center gap-1.5 text-[11px] font-medium text-muted-foreground">
      <span className="h-1 w-1 shrink-0 rounded-full bg-muted-foreground/35" aria-hidden="true" />
      <span className="min-w-0 truncate">{label}</span>
    </span>
  );
}

function FilterChip({
  label,
  value,
  selected,
  onClick,
}: {
  label: string;
  value: number;
  selected: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      aria-pressed={selected}
      onClick={onClick}
      className={`inline-flex h-8 items-center gap-1.5 whitespace-nowrap rounded-md border px-2.5 text-xs font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${
        selected
          ? 'border-[var(--amber)]/35 bg-[var(--amber-subtle)] text-[var(--amber-text)]'
          : 'border-transparent text-muted-foreground hover:border-border/65 hover:bg-muted/35 hover:text-foreground'
      }`}
    >
      <span>{label}</span>
      <span className={`[font-variant-numeric:tabular-nums] ${selected ? 'text-foreground' : 'text-foreground/85'}`}>{value}</span>
    </button>
  );
}

export function normalizeSearchValue(value: string): string {
  return value.trim().toLocaleLowerCase();
}

export function automationSearchText(
  automation: StudioAutomation,
  projects: StudioProject[],
  locale: string,
  copy: StudioAutomationCopy,
): string {
  const scopeText = automation.scope === 'project'
    ? `${scopeLabel(automation.scope, copy)} ${projectLabel(projects, automation.projectId, locale, copy.noProject)}`
    : scopeLabel(automation.scope, copy);
  return normalizeSearchValue([
    automation.title,
    automation.titleZh,
    automation.prompt,
    automation.promptZh,
    automation.status === 'active' ? copy.active : copy.paused,
    scopeText,
    automation.trigger?.type === 'event' ? automation.trigger.events.join(' ') : scheduleLabel(automation.schedule, copy),
    modelLabel(automation.model, copy),
    effortLabel(automation.effort, copy),
    automation.nextRun,
    copy.runtimeSchedule,
    runStateLabel(automation, copy),
  ].filter(Boolean).join(' '));
}

function runStateLabel(automation: StudioAutomation, copy: StudioAutomationCopy): string {
  if (automation.lastStatus === 'running') return copy.runStateRunning;
  if (automation.lastStatus === 'waiting_approval') return copy.runStateWaitingApproval;
  if (automation.lastStatus === 'success') return copy.runStateSuccess;
  if (automation.lastStatus === 'timed_out') return copy.runStateTimedOut;
  if (automation.lastStatus === 'interrupted') return copy.runStateInterrupted;
  if (automation.lastStatus === 'error') return copy.runStateError;
  return copy.runStatePending;
}

function nextRunLabel(
  automation: StudioAutomation,
  locale: string,
  copy: StudioAutomationCopy,
): string {
  if (automation.status === 'paused') return copy.paused;
  if (automation.trigger?.type === 'event') return copy.eventWaiting;
  if (automation.schedule === 'manual' && !automation.nextRun?.includes('T')) return copy.manualHint;
  if (!automation.nextRun) return copy.runtimeNote;
  const date = new Date(automation.nextRun);
  if (Number.isNaN(date.getTime())) return automation.nextRun;
  try {
    return new Intl.DateTimeFormat(locale, {
      dateStyle: 'medium',
      timeStyle: 'short',
      timeZone: automation.timezone,
    }).format(date);
  } catch {
    return new Intl.DateTimeFormat(locale, {
      dateStyle: 'medium',
      timeStyle: 'short',
    }).format(date);
  }
}

export function automationMatchesStatusFilter(automation: StudioAutomation, filter: AutomationStatusFilter): boolean {
  if (filter === 'all') return true;
  if (filter === 'enabled') return automation.status === 'active';
  return automation.status === 'paused';
}

export function automationEmptyMessage(
  copy: StudioAutomationCopy,
  filter: AutomationStatusFilter,
  hasSearch: boolean,
  hasAutomations: boolean,
): string {
  if (!hasAutomations) return copy.empty;
  if (filter === 'enabled') return hasSearch ? copy.emptyEnabledSearch : copy.emptyEnabled;
  if (filter === 'paused') return hasSearch ? copy.emptyPausedSearch : copy.emptyPaused;
  return copy.emptySearch;
}

export function AutomationToolbar({
  copy,
  counts,
  filter,
  onFilterChange,
  searchQuery,
  onSearchQueryChange,
}: {
  copy: StudioAutomationCopy;
  counts: Record<AutomationStatusFilter, number>;
  filter: AutomationStatusFilter;
  onFilterChange: (filter: AutomationStatusFilter) => void;
  searchQuery: string;
  onSearchQueryChange: (value: string) => void;
}) {
  const filters: Array<{ value: AutomationStatusFilter; label: string; count: number }> = [
    { value: 'all', label: copy.allLabel, count: counts.all },
    { value: 'enabled', label: copy.enabledLabel, count: counts.enabled },
    { value: 'paused', label: copy.pausedLabel, count: counts.paused },
  ];
  return (
    <div
      data-studio-automation-toolbar
      className="flex flex-col gap-3 border-b border-border/60 pb-3 sm:flex-row sm:items-center sm:justify-between"
    >
      <div className="flex min-w-0 flex-wrap items-center gap-1" aria-label={copy.statusFilterLabel}>
        {filters.map((item) => (
          <FilterChip
            key={item.value}
            label={item.label}
            value={item.count}
            selected={filter === item.value}
            onClick={() => onFilterChange(item.value)}
          />
        ))}
      </div>
      <label className="relative min-w-0 sm:w-72">
        <Search
          size={14}
          className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground/70"
          aria-hidden="true"
        />
        <input
          data-studio-automation-search
          type="search"
          aria-label={copy.searchLabel}
          value={searchQuery}
          onChange={(event) => onSearchQueryChange(event.target.value)}
          placeholder={copy.searchPlaceholder}
          className="h-9 w-full rounded-lg border border-border/65 bg-background/65 pl-8 pr-3 text-xs text-foreground outline-none transition-colors placeholder:text-muted-foreground/55 hover:border-[var(--amber)]/35 focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/30"
        />
      </label>
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
      className="inline-flex max-w-full items-center gap-1.5 rounded-md border border-border/55 bg-background/55 px-2.5 py-1.5 text-xs font-medium text-muted-foreground transition-colors hover:border-[var(--amber)]/35 hover:bg-[var(--amber-subtle)] hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
    >
      <WandSparkles size={12} className="shrink-0 text-[var(--amber)]" aria-hidden="true" />
      <span className="truncate">{title}</span>
      <span className="sr-only">{copy.useTemplate}</span>
    </button>
  );
}

export function AutomationCard({
  automation,
  projects,
  locale,
  copy,
  onEdit,
  onToggle,
  onDelete,
  onRunNow,
  busy,
}: {
  automation: StudioAutomation;
  projects: StudioProject[];
  locale: string;
  copy: StudioAutomationCopy;
  onEdit: (automation: StudioAutomation) => void;
  onToggle: (automation: StudioAutomation) => void;
  onDelete: (automation: StudioAutomation) => void;
  onRunNow: (automation: StudioAutomation) => void;
  busy?: boolean;
}) {
  const title = automationTitle(automation, locale);
  const prompt = automationPrompt(automation, locale);
  const statusLabel = automation.status === 'active' ? copy.active : copy.paused;
  const isActive = automation.status === 'active';
  const scopeText = automation.scope === 'project'
    ? `${scopeLabel(automation.scope, copy)} / ${projectLabel(projects, automation.projectId, locale, copy.noProject)}`
    : scopeLabel(automation.scope, copy);
  const latestRun = automation.recentRuns?.[0];
  const latestResult = latestRun?.outputPreview || latestRun?.error || automation.lastError;
  const latestResultIsError = latestRun?.status === 'error'
    || latestRun?.status === 'timed_out'
    || latestRun?.status === 'interrupted';
  const formattedNextRun = nextRunLabel(automation, locale, copy);

  return (
    <article data-studio-automation-card className="group relative grid min-w-0 gap-3 border-t border-border/55 px-4 py-3.5 transition-colors first:border-t-0 hover:bg-muted/20 lg:grid-cols-[minmax(0,1fr)_auto] lg:items-center">
      <span className={`pointer-events-none absolute bottom-3 left-0 top-3 w-px rounded-r-full transition-colors ${
        isActive ? 'bg-[var(--amber)]' : 'bg-border'
      }`} />
      <div className="min-w-0 pl-2">
        <div className="flex min-w-0 items-center gap-2">
          <span className={`h-2 w-2 shrink-0 rounded-full ${isActive ? 'bg-[var(--amber)]' : 'bg-muted-foreground/35'}`} aria-hidden="true" />
          <h3 className="min-w-0 truncate text-[15px] font-semibold text-foreground">{title}</h3>
          <span className="shrink-0 text-[11px] font-medium text-muted-foreground">{statusLabel}</span>
        </div>
        <p className="mt-1 line-clamp-1 max-w-[72ch] text-xs leading-relaxed text-muted-foreground">{prompt}</p>
        {latestResult ? (
          <p
            data-studio-automation-latest-result
            className={`mt-1 line-clamp-1 max-w-[72ch] text-[11px] leading-relaxed ${
              latestResultIsError ? 'text-error' : 'text-muted-foreground'
            }`}
          >
            <span className="font-medium">{copy.latestResult}:</span> {latestResult}
          </p>
        ) : null}
        <div className="mt-2 flex min-w-0 flex-wrap gap-x-3 gap-y-1">
          <MetaText label={scopeText} />
          <MetaText label={automation.trigger?.type === 'event' ? `${copy.triggerEvent}: ${automation.trigger.events.join(', ')}` : scheduleLabel(automation.schedule, copy)} />
          <MetaText label={copy.runtimeSchedule} />
          <MetaText label={runStateLabel(automation, copy)} />
          <MetaText label={`${modelLabel(automation.model, copy)} / ${effortLabel(automation.effort, copy)}`} />
        </div>
      </div>

      <div className="flex min-w-0 flex-wrap items-center justify-between gap-3 pl-2 lg:flex-nowrap lg:justify-end lg:pl-0">
        <span
          data-studio-automation-next-run
          title={`${copy.nextRun}: ${formattedNextRun}`}
          className="w-full min-w-0 truncate text-[11px] text-muted-foreground [font-variant-numeric:tabular-nums] lg:w-auto"
        >
          {copy.nextRun}: {formattedNextRun}
        </span>
        <div className="flex shrink-0 items-center gap-1.5">
          <Button
            data-studio-automation-run-now
            type="button"
            variant="outline"
            size="sm"
            disabled={busy || automation.status !== 'active' || automation.lastStatus === 'running'}
            onClick={() => onRunNow(automation)}
          >
            <Play size={13} aria-hidden="true" />
            {copy.runNow}
          </Button>
          <Button type="button" variant="outline" size="sm" disabled={busy} onClick={() => onEdit(automation)}>
            <Edit3 size={13} aria-hidden="true" />
            {copy.edit}
          </Button>
          <Button type="button" variant="ghost" size="sm" disabled={busy} onClick={() => onToggle(automation)}>
            {automation.status === 'active' ? <Pause size={13} aria-hidden="true" /> : <Play size={13} aria-hidden="true" />}
            {automation.status === 'active' ? copy.pause : copy.resume}
          </Button>
          <Button type="button" variant="destructive" size="icon-sm" aria-label={copy.delete} disabled={busy} onClick={() => onDelete(automation)}>
            <Trash2 size={13} aria-hidden="true" />
          </Button>
        </div>
      </div>
    </article>
  );
}

export function AutomationDrawer({
  open,
  editing,
  copy,
  draft,
  projects,
  locale,
  projectOptions,
  templates,
  error,
  saving,
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
  saving: boolean;
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

        <div className="flex-1 overflow-y-auto px-5 pb-28 pt-5 sm:px-6">
          <div className="grid gap-5">
            <div className="grid gap-3">
              <label className="grid gap-1.5">
                <span className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
                  {copy.titleLabel}
                  <span className="text-[11px] font-normal text-muted-foreground/70">{copy.optional}</span>
                </span>
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
                  rows={6}
                  className="min-h-36 resize-none rounded-lg border border-border/70 bg-background/75 px-3 py-3 text-sm leading-relaxed text-foreground outline-none transition-colors placeholder:text-muted-foreground/55 focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/35"
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

            <StudioAutomationTriggerPicker
              copy={copy}
              draft={draft}
              onChange={onDraftChange}
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
              {draft.scope === 'project' ? (
                <ControlSelect
                  icon={<Layers3 size={13} />}
                  label={copy.projectLabel}
                  value={draft.projectId ?? ''}
                  values={projectOptions.length ? projectOptions : ['']}
                  disabled={projectOptions.length === 0}
                  onChange={(projectId) => onDraftChange((current) => ({ ...current, projectId }))}
                  renderLabel={(projectId) => projectLabel(projects, projectId, locale, copy.noProject)}
                />
              ) : null}
            </div>

            <details data-studio-automation-advanced className="group rounded-lg border border-border/60 bg-background/40">
              <summary className="flex cursor-pointer list-none items-center gap-2 px-3 py-2.5 text-xs font-medium text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
                <Sparkles size={13} className="text-[var(--amber)]" aria-hidden="true" />
                {copy.advanced}
                <ChevronDown size={13} className="ml-auto transition-transform group-open:rotate-180" aria-hidden="true" />
              </summary>
              <div className="grid gap-3 border-t border-border/55 p-3 sm:grid-cols-2">
                <ControlSelect
                  icon={<Bot size={13} />}
                  label={copy.modelLabel}
                  value={draft.model}
                  values={MODEL_OPTIONS}
                  onChange={(model) => onDraftChange((current) => ({
                    ...current,
                    model,
                    permissionMode: (model === 'mindos-auto' || model === 'gpt-5.5') && current.permissionMode === 'ask'
                      ? 'read'
                      : current.permissionMode,
                  }))}
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
                <ControlSelect
                  icon={<Layers3 size={13} />}
                  label={copy.permissionLabel}
                  value={draft.permissionMode}
                  values={draft.model === 'codex' || draft.model === 'claude-code' ? NATIVE_PERMISSION_OPTIONS : PI_PERMISSION_OPTIONS}
                  onChange={(permissionMode) => onDraftChange((current) => ({ ...current, permissionMode }))}
                  renderLabel={(permissionMode) => permissionLabel(permissionMode, copy)}
                />
              </div>
            </details>

            {error ? <p className="text-xs font-medium text-error">{error}</p> : null}
          </div>
        </div>

        <div className="shrink-0 border-t border-border/60 bg-background px-5 py-4 sm:px-6 md:pr-20">
          <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
            <Button type="button" variant="outline" size="lg" disabled={saving} onClick={onClose} className="justify-center">
              {copy.cancel}
            </Button>
            <Button type="submit" variant="amber" size="lg" disabled={saving} className="justify-center">
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
