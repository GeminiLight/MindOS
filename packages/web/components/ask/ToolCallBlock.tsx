'use client';

import { useEffect, useState, useMemo } from 'react';
import {
  ChevronRight, ChevronDown, Loader2, CheckCircle2, XCircle, AlertTriangle,
  Search, FolderOpen, BookOpen, Pencil, FilePlus, FileText, Pin, Trash2,
  ArrowRightLeft, Link2, History, Clock, Table, Globe, Wrench as WrenchIcon,
  GitBranch, MessageSquareMore, Terminal, ShieldAlert,
} from 'lucide-react';
import type { ToolCallPart } from '@/lib/types';
import type { LucideIcon } from 'lucide-react';
import AskUserQuestionBlock from './AskUserQuestionBlock';
import { redactSensitiveObject, redactSensitiveText } from '@geminilight/mindos/agent/redaction';

const DESTRUCTIVE_TOOLS = new Set(['delete_file', 'move_file', 'rename_file', 'write_file']);

const DIFF_TOOLS = new Set([
  'write_file', 'create_file', 'update_section',
  'insert_after_heading', 'edit_lines', 'append_to_file',
]);

const TOOL_ICONS: Record<string, LucideIcon> = {
  web_search: Globe,
  search: Search,
  list_files: FolderOpen,
  read_file: BookOpen,
  write_file: Pencil,
  create_file: FilePlus,
  append_to_file: FileText,
  insert_after_heading: Pin,
  update_section: Pencil,
  delete_file: Trash2,
  rename_file: FileText,
  move_file: ArrowRightLeft,
  get_backlinks: Link2,
  get_history: History,
  get_file_at_version: History,
  get_recent: Clock,
  append_csv: Table,
  subagent: GitBranch,
  ask_user_question: MessageSquareMore,
  Bash: Terminal,
  approval_request: ShieldAlert,
  Read: BookOpen,
  Write: Pencil,
  Edit: Pencil,
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function getString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? redactSensitiveText(value) : undefined;
}

function truncate(value: string, max = 96): string {
  const normalized = redactSensitiveText(value).replace(/\s+/g, ' ').trim();
  return normalized.length > max ? `${normalized.slice(0, max)}…` : normalized;
}

function formatInput(input: unknown): string {
  if (!isRecord(input)) return redactSensitiveText(String(input ?? ''));
  const parts: string[] = [];
  for (const val of Object.values(input)) {
    if (typeof val === 'string') {
      const safeValue = redactSensitiveText(val);
      parts.push(safeValue.length > 60 ? `${safeValue.slice(0, 60)}…` : safeValue);
    } else if (Array.isArray(val)) {
      parts.push(`[${val.length} items]`);
    } else if (val !== undefined && val !== null) {
      parts.push(String(val));
    }
  }
  return parts.join(', ');
}

function countRequestedRuns(tasks: unknown[]): number {
  return tasks.reduce<number>((total, task) => {
    if (!isRecord(task)) return total + 1;
    const count = typeof task.count === 'number' && Number.isFinite(task.count) && task.count > 0
      ? task.count
      : 1;
    return total + count;
  }, 0);
}

function formatSubagentAction(action: string): string {
  const labels: Record<string, string> = {
    list: 'List subagents',
    get: 'Inspect subagent',
    create: 'Create subagent',
    update: 'Update subagent',
    delete: 'Delete subagent',
    status: 'Check subagent status',
    interrupt: 'Interrupt subagent',
    resume: 'Resume subagent',
    doctor: 'Check subagent runtime',
  };
  return labels[action] ?? `Subagent ${action}`;
}

function formatSubagentSummary(input: unknown): string {
  if (!isRecord(input)) return formatInput(input);

  const action = getString(input.action);
  if (action) {
    const target = getString(input.agent) ?? getString(input.id) ?? getString(input.runId) ?? getString(input.chainName);
    return target ? `${formatSubagentAction(action)} · ${target}` : formatSubagentAction(action);
  }

  if (Array.isArray(input.tasks)) {
    const runCount = countRequestedRuns(input.tasks);
    const firstAgents = input.tasks
      .map(task => isRecord(task) ? getString(task.agent) : undefined)
      .filter(Boolean)
      .slice(0, 3)
      .join(', ');
    return `Parallel · ${runCount} ${runCount === 1 ? 'run' : 'runs'}${firstAgents ? ` · ${firstAgents}` : ''}`;
  }

  if (Array.isArray(input.chain)) {
    return `Chain · ${input.chain.length} ${input.chain.length === 1 ? 'step' : 'steps'}`;
  }

  const agent = getString(input.agent);
  const task = getString(input.task);
  if (agent && task) return `${agent} · ${truncate(task, 80)}`;
  if (agent) return agent;
  if (task) return truncate(task, 96);
  return 'Subagent run';
}

function formatAskUserQuestionSummary(part: ToolCallPart): string {
  const questions = part.userQuestion?.questions;
  if (questions && questions.length > 0) {
    const first = questions[0];
    return `${first.header || 'Question'} · ${questions.length} ${questions.length === 1 ? 'question' : 'questions'}`;
  }
  return formatInput(part.input);
}

function shortToolName(toolName: string): string {
  const parts = toolName.split('__');
  return parts[parts.length - 1] || toolName;
}

function isAskUserQuestionToolName(toolName: string): boolean {
  return shortToolName(toolName).replace(/[-_\s]/g, '').toLowerCase() === 'askuserquestion';
}

function extractQuestionPayload(input: unknown): unknown {
  if (!isRecord(input)) return input;
  if (Array.isArray(input.questions)) return input.questions;
  if (isRecord(input.input) && Array.isArray(input.input.questions)) return input.input.questions;
  if (isRecord(input.params) && Array.isArray(input.params.questions)) return input.params.questions;
  if (isRecord(input.arguments) && Array.isArray(input.arguments.questions)) return input.arguments.questions;
  return undefined;
}

function buildReadOnlyUserQuestion(part: ToolCallPart): ToolCallPart['userQuestion'] | undefined {
  if (!isAskUserQuestionToolName(part.toolName) || part.userQuestion) return part.userQuestion;
  const payload = extractQuestionPayload(part.input);
  if (!Array.isArray(payload) || payload.length === 0) return undefined;
  const questions = payload
    .filter(isRecord)
    .map((question) => ({
      question: typeof question.question === 'string' ? redactSensitiveText(question.question) : '',
      header: typeof question.header === 'string' ? redactSensitiveText(question.header) : '',
      multiSelect: question.multiSelect === true,
      options: Array.isArray(question.options)
        ? question.options.filter(isRecord).map((option) => ({
          label: typeof option.label === 'string' ? redactSensitiveText(option.label) : '',
          description: typeof option.description === 'string' ? redactSensitiveText(option.description) : '',
          ...(typeof option.preview === 'string' ? { preview: redactSensitiveText(option.preview) } : {}),
        }))
        : [],
    }));
  if (questions.length === 0) return undefined;
  return {
    runId: '',
    questions,
    status: 'waiting',
    readOnly: true,
    ...(part.runtime ? { runtime: part.runtime } : {}),
  };
}

function runtimeLabel(runtime: ToolCallPart['runtime']): string {
  if (runtime === 'claude') return 'Claude Code';
  if (runtime === 'codex') return 'Codex';
  if (runtime === 'acp') return 'ACP Agent';
  return 'MindOS Agent';
}

function getCommand(input: unknown): string | undefined {
  if (typeof input === 'string' && input.trim()) return input;
  if (!isRecord(input)) return undefined;
  return getString(input.command)
    ?? getString(input.cmd)
    ?? getString(input.bash)
    ?? getString(input.script);
}

function formatNativeRuntimeSummary(part: ToolCallPart): string {
  const input = isRecord(part.input) ? part.input : {};
  const command = getCommand(part.input);
  const description = getString(input.description) ?? getString(input.summary);
  const detail = description ?? command ?? formatInput(part.input);
  return `${runtimeLabel(part.runtime)} · ${part.toolName}${detail ? ` · ${truncate(detail, 72)}` : ''}`;
}

function isNativeRuntimeTool(part: ToolCallPart): boolean {
  return part.runtime === 'claude' || part.runtime === 'codex';
}

function isPotentiallyDestructiveCommand(command: string | undefined): boolean {
  if (!command) return false;
  return /\b(rm|unlink|rmdir|mv|chmod|chown|dd|truncate)\b/.test(command)
    || /\b(delete|remove|rename|move|write)\b/i.test(command)
    || /\bmindos\s+file\s+(delete|move|rename|write)\b/i.test(command);
}

function isDestructiveToolCall(part: ToolCallPart): boolean {
  return DESTRUCTIVE_TOOLS.has(part.toolName)
    || part.toolName === 'approval_request'
    || isPotentiallyDestructiveCommand(getCommand(part.input));
}

function formatSubagentMode(input: Record<string, unknown>): string {
  if (getString(input.action)) return 'Control';
  if (Array.isArray(input.tasks)) return 'Parallel';
  if (Array.isArray(input.chain)) return 'Chain';
  return 'Single';
}

function formatSubagentOutput(output: string | undefined): string {
  if (!output) return '';
  const safeOutput = redactSensitiveText(output);
  try {
    const parsed = JSON.parse(safeOutput) as unknown;
    if (isRecord(parsed)) {
      const summary = getString(parsed.summary) ?? getString(parsed.message) ?? getString(parsed.result) ?? getString(parsed.output);
      if (summary) return truncate(summary, 500);
      const status = getString(parsed.status);
      const id = getString(parsed.id) ?? getString(parsed.runId);
      if (status || id) return [status, id].filter(Boolean).join(' · ');
    }
  } catch {
    // Tool output is usually plain text; JSON parsing is only a best-effort preview.
  }
  return safeOutput.length > 500 ? `${safeOutput.slice(0, 500)}…` : safeOutput;
}

function stringifyRedacted(value: unknown): string {
  return JSON.stringify(redactSensitiveObject(value), null, 2);
}

function SubagentDetailRow({ label, value }: { label: string; value: unknown }) {
  const text = Array.isArray(value)
    ? `[${value.length} items]`
    : typeof value === 'boolean'
      ? String(value)
      : typeof value === 'number' && Number.isFinite(value)
        ? String(value)
        : getString(value) ?? '';
  if (!text) return null;
  return (
    <div className="grid grid-cols-[5rem_1fr] gap-2">
      <span className="text-muted-foreground/70">{label}</span>
      <span className="text-foreground/80 break-words">{text}</span>
    </div>
  );
}

function SubagentToolDetails({ input, output, running }: { input: unknown; output?: string; running: boolean }) {
  if (!isRecord(input)) {
    return (
      <div className="px-2.5 pb-2.5 pt-1.5 space-y-1.5">
        {running && (
          <div className="text-muted-foreground/60 text-2xs flex items-center gap-1.5">
            <Loader2 size={10} className="animate-spin" /> Running...
          </div>
        )}
        <div className="text-muted-foreground leading-relaxed">
          <span className="font-semibold text-foreground/70">Input: </span>
          <span className="break-all whitespace-pre-wrap">{stringifyRedacted(input)}</span>
        </div>
      </div>
    );
  }

  const action = getString(input.action);
  const tasks = Array.isArray(input.tasks) ? input.tasks : [];
  const chain = Array.isArray(input.chain) ? input.chain : [];
  const outputPreview = formatSubagentOutput(output);

  return (
    <div className="px-2.5 pb-2.5 pt-1.5 space-y-2">
      {running && (
        <div className="text-muted-foreground/60 text-2xs flex items-center gap-1.5">
          <Loader2 size={10} className="animate-spin" /> Running...
        </div>
      )}

      <div className="rounded-md border border-border/30 bg-muted/15 px-2 py-1.5 space-y-1.5">
        <SubagentDetailRow label="Mode" value={formatSubagentMode(input)} />
        {action && <SubagentDetailRow label="Action" value={formatSubagentAction(action)} />}
        <SubagentDetailRow label="Agent" value={input.agent} />
        <SubagentDetailRow label="Task" value={input.task} />
        <SubagentDetailRow label="Run" value={getString(input.id) ?? getString(input.runId)} />
        <SubagentDetailRow label="Cwd" value={input.cwd} />
        <SubagentDetailRow label="Context" value={input.context} />
        <SubagentDetailRow label="Async" value={input.async} />
        <SubagentDetailRow label="Worktree" value={input.worktree} />
        <SubagentDetailRow label="Concurrency" value={input.concurrency} />
      </div>

      {tasks.length > 0 && (
        <div className="space-y-1">
          <div className="text-muted-foreground/70">Parallel tasks</div>
          {tasks.slice(0, 4).map((task, idx) => {
            const taskObj = isRecord(task) ? task : {};
            const agent = getString(taskObj.agent) ?? `Task ${idx + 1}`;
            const taskText = getString(taskObj.task);
            return (
              <div key={idx} className="rounded-md bg-muted/15 px-2 py-1">
                <span className="text-foreground/80">{agent}</span>
                {taskText && <span className="text-muted-foreground"> · {truncate(taskText, 120)}</span>}
              </div>
            );
          })}
          {tasks.length > 4 && <div className="text-muted-foreground/60">+ {tasks.length - 4} more</div>}
        </div>
      )}

      {chain.length > 0 && (
        <div className="space-y-1">
          <div className="text-muted-foreground/70">Chain steps</div>
          {chain.slice(0, 4).map((step, idx) => {
            const stepObj = isRecord(step) ? step : {};
            const agent = getString(stepObj.agent) ?? getString(stepObj.label) ?? `Step ${idx + 1}`;
            const taskText = getString(stepObj.task);
            return (
              <div key={idx} className="rounded-md bg-muted/15 px-2 py-1">
                <span className="text-foreground/80">{idx + 1}. {agent}</span>
                {taskText && <span className="text-muted-foreground"> · {truncate(taskText, 120)}</span>}
              </div>
            );
          })}
          {chain.length > 4 && <div className="text-muted-foreground/60">+ {chain.length - 4} more</div>}
        </div>
      )}

      {outputPreview && (
        <div className="text-muted-foreground leading-relaxed">
          <span className="font-semibold text-foreground/70">Output: </span>
          <span className="break-all whitespace-pre-wrap">{outputPreview}</span>
        </div>
      )}

      <details className="text-muted-foreground">
        <summary className="cursor-pointer select-none text-muted-foreground/70">Raw input</summary>
        <pre className="mt-1 max-h-40 overflow-auto whitespace-pre-wrap break-all rounded-md bg-muted/15 px-2 py-1.5">
          {stringifyRedacted(input)}
        </pre>
      </details>
    </div>
  );
}

function NativeRuntimeToolDetails({ part, running }: { part: ToolCallPart; running: boolean }) {
  const input = isRecord(part.input) ? part.input : {};
  const command = getCommand(part.input);
  const description = getString(input.description) ?? getString(input.summary);
  const runtimePermission = part.runtimePermission;
  const approvalSensitive = Boolean(runtimePermission) || isDestructiveToolCall(part) || part.toolName === 'approval_request';
  const label = runtimeLabel(part.runtime);
  const safeOutput = part.output ? redactSensitiveText(part.output) : part.output;
  const outputPreview = safeOutput && safeOutput.length > 1000 ? `${safeOutput.slice(0, 1000)}…` : safeOutput;

  return (
    <div className="space-y-2 px-2.5 pb-2.5 pt-2 font-sans">
      {running && (
        <div className={`flex items-center gap-1.5 text-2xs ${
          runtimePermission ? 'text-[var(--amber)]' : 'text-muted-foreground'
        }`}>
          {runtimePermission ? <ShieldAlert size={12} /> : <Loader2 size={12} className="animate-spin" />}
          {runtimePermission ? `${label} is asking for approval` : `Running in ${label}`}
        </div>
      )}

      <div className={`rounded-md border px-2.5 py-2 ${
        approvalSensitive
          ? 'border-[var(--amber)]/35 bg-[var(--amber-subtle)]/35'
          : 'border-border/35 bg-muted/10'
      }`}>
        <div className="mb-2 flex flex-wrap items-center gap-1.5">
          <span className="inline-flex h-5 items-center gap-1 rounded border border-border/40 bg-background px-1.5 text-2xs font-medium text-muted-foreground">
            {label}
          </span>
          <span className="text-xs font-medium text-foreground">{part.toolName}</span>
          {description && <span className="text-2xs text-muted-foreground">{description}</span>}
        </div>

        {command ? (
          <pre className="max-h-48 overflow-auto whitespace-pre-wrap break-all rounded-md border border-border/30 bg-background/75 p-2 font-mono text-2xs leading-5 text-foreground">
            {command}
          </pre>
        ) : (
          <pre className="max-h-40 overflow-auto whitespace-pre-wrap break-all rounded-md border border-border/30 bg-background/75 p-2 font-mono text-2xs leading-5 text-foreground">
            {stringifyRedacted(part.input)}
          </pre>
        )}

        {runtimePermission ? (
          <RuntimePermissionControls part={part} />
        ) : null}

        {outputPreview && (
          <div className="mt-2 rounded-md border border-border/30 bg-muted/10 px-2 py-1.5">
            <div className="mb-1 text-2xs font-medium text-muted-foreground">Output</div>
            <pre className="max-h-48 overflow-auto whitespace-pre-wrap break-all font-mono text-2xs leading-5 text-foreground [overflow-wrap:anywhere]">
              {outputPreview}
            </pre>
          </div>
        )}
      </div>
    </div>
  );
}

function RuntimePermissionControls({ part }: { part: ToolCallPart }) {
  const permission = part.runtimePermission;
  const [submitting, setSubmitting] = useState<string | null>(null);
  const [error, setError] = useState('');
  if (!permission) return null;
  const permissionState = permission;

  const waiting = permissionState.status === 'waiting';
  useEffect(() => {
    if (!waiting) setSubmitting(null);
  }, [waiting]);
  const statusText = permissionState.status === 'approved'
    ? 'Approved'
    : permissionState.status === 'denied'
      ? 'Denied'
      : permissionState.status === 'cancelled'
        ? 'Cancelled'
        : 'Waiting for your decision';

  async function submitDecision(decision: string) {
    if (!waiting || submitting) return;
    setSubmitting(decision);
    setError('');
    try {
      const res = await fetch('/api/ask/runtime-permission', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          runId: permissionState.runId,
          requestId: permissionState.requestId,
          decision,
        }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => null);
        throw new Error(typeof body?.error === 'string' ? body.error : 'Could not send permission decision.');
      }
    } catch (err) {
      setError(redactSensitiveText(err instanceof Error ? err.message : String(err)));
      setSubmitting(null);
    }
  }

  const options = permissionState.options.length > 0
    ? permissionState.options
    : [
        { id: 'accept', label: 'Allow once', intent: 'allow' as const },
        { id: 'decline', label: 'Deny', intent: 'deny' as const },
      ];

  return (
    <div className="mt-2 rounded-md border border-[var(--amber)]/30 bg-background/70 px-2 py-2">
      <div className="mb-1.5 flex flex-wrap items-center gap-1.5 text-2xs font-medium text-foreground">
        <ShieldAlert size={12} className="text-[var(--amber)]" />
        <span>{runtimeLabel(permissionState.runtime)} permission request</span>
        <span className="basis-full text-muted-foreground min-[520px]:ml-auto min-[520px]:basis-auto">{statusText}</span>
      </div>
      {permissionState.reason && (
        <div className="mb-2 text-2xs leading-5 text-muted-foreground [overflow-wrap:anywhere]">
          {redactSensitiveText(permissionState.reason)}
        </div>
      )}
      <div className="flex flex-wrap gap-1.5">
        {options.map((option) => {
          const optionLabel = redactSensitiveText(option.label);
          const optionDescription = option.description ? redactSensitiveText(option.description) : undefined;
          const isAllow = option.intent === 'allow' || option.id === 'accept' || option.id === 'acceptForSession';
          const isDeny = option.intent === 'deny' || option.id === 'decline' || option.id === 'deny';
          const active = submitting === option.id;
          return (
            <button
              key={option.id}
              type="button"
              disabled={!waiting || Boolean(submitting)}
              onClick={() => void submitDecision(option.id)}
              title={optionDescription}
              className={`inline-flex h-7 items-center gap-1 rounded-md border px-2 text-2xs font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-60 ${
                isAllow
                  ? 'border-[var(--amber)] bg-[var(--amber)] text-[var(--amber-foreground)] hover:opacity-90'
                  : isDeny
                    ? 'border-border/45 bg-background text-muted-foreground hover:bg-muted/35'
                    : 'border-border/45 bg-muted/20 text-muted-foreground hover:bg-muted/35'
              }`}
            >
              {active && <Loader2 size={11} className="animate-spin" />}
              {optionLabel}
            </button>
          );
        })}
      </div>
      {error && (
        <div className="mt-2 text-2xs leading-5 text-error [overflow-wrap:anywhere]">
          {error}
        </div>
      )}
      {permissionState.decision && permissionState.status !== 'waiting' && (
        <div className="mt-2 text-2xs leading-5 text-muted-foreground">
          Decision forwarded to {runtimeLabel(permissionState.runtime)}: {permissionState.decision}
        </div>
      )}
    </div>
  );
}

const CHANGES_SEPARATOR = '--- changes ---';

/** Parse tool output: extract header line (before separator) and diff lines (after separator) */
function parseToolOutput(output: string | undefined): { header: string; stats: string; diffLines: { prefix: string; text: string }[] } {
  if (!output) return { header: '', stats: '', diffLines: [] };
  const safeOutput = redactSensitiveText(output);
  const sepIdx = safeOutput.indexOf(CHANGES_SEPARATOR);
  if (sepIdx === -1) return { header: safeOutput, stats: '', diffLines: [] };

  const header = safeOutput.slice(0, sepIdx).trim();
  const diffText = safeOutput.slice(sepIdx + CHANGES_SEPARATOR.length).trim();

  // Extract stats from header, e.g. "File written: foo.md (+3 −1)"
  const statsMatch = header.match(/\((\+\d+\s*−\d+)\)/);
  const stats = statsMatch ? statsMatch[1] : '';

  const diffLines = diffText.split('\n').map(line => {
    if (line.startsWith('+ ')) return { prefix: '+', text: line.slice(2) };
    if (line.startsWith('- ')) return { prefix: '-', text: line.slice(2) };
    if (line.startsWith('  ')) return { prefix: ' ', text: line.slice(2) };
    // gap or other
    return { prefix: ' ', text: line };
  });

  return { header, stats, diffLines };
}

export default function ToolCallBlock({ part }: { part: ToolCallPart }) {
  const derivedUserQuestion = buildReadOnlyUserQuestion(part);
  const displayPart = derivedUserQuestion && derivedUserQuestion !== part.userQuestion
    ? { ...part, userQuestion: derivedUserQuestion }
    : part;
  const hasDiff = DIFF_TOOLS.has(displayPart.toolName);
  const hasUserQuestion = isAskUserQuestionToolName(displayPart.toolName) || Boolean(displayPart.userQuestion);
  const hasNativeRuntimeTool = isNativeRuntimeTool(displayPart);
  const isDone = displayPart.state === 'done';
  // Auto-expand diff tools when completed
  const [manualToggle, setManualToggle] = useState<boolean | null>(null);
  const expanded = manualToggle ?? (hasUserQuestion || hasNativeRuntimeTool || (hasDiff && isDone));

  const IconComponent = isAskUserQuestionToolName(displayPart.toolName)
    ? MessageSquareMore
    : TOOL_ICONS[displayPart.toolName] ?? WrenchIcon;
  const isDestructive = isDestructiveToolCall(displayPart);
  const isSubagent = displayPart.toolName === 'subagent';

  const parsed = useMemo(() => parseToolOutput(displayPart.output), [displayPart.output]);

  // For collapsed header: show file path from input + stats
  const filePath = useMemo(() => {
    if (!displayPart.input || typeof displayPart.input !== 'object') return '';
    const obj = displayPart.input as Record<string, unknown>;
    return getString(obj.path) ?? '';
  }, [displayPart.input]);

  const headerLabel = hasUserQuestion
    ? formatAskUserQuestionSummary(displayPart)
    : hasNativeRuntimeTool
      ? formatNativeRuntimeSummary(displayPart)
    : isSubagent
    ? formatSubagentSummary(displayPart.input)
    : filePath
      ? `${filePath.split('/').pop() ?? filePath}${parsed.stats ? ` (${parsed.stats})` : ''}`
      : formatInput(displayPart.input);
  const headerSummaryClass = hasNativeRuntimeTool || hasUserQuestion
    ? 'min-w-0 flex-1 basis-full whitespace-normal break-words text-muted-foreground [overflow-wrap:anywhere] min-[520px]:basis-32'
    : 'min-w-0 flex-1 truncate text-muted-foreground';

  return (
    <div className={`my-1.5 box-border w-full min-w-0 max-w-full overflow-hidden rounded-lg border text-xs font-mono ${
      isDestructive
        ? 'border-[var(--amber)]/30 bg-background/60'
        : 'border-border/40 bg-background/50'
    }`}>
      <button
        type="button"
        onClick={() => setManualToggle(v => v === null ? !expanded : !v)}
        aria-expanded={expanded}
        className="flex w-full min-w-0 flex-wrap items-start gap-1.5 rounded-lg px-2.5 py-2 text-left transition-colors hover:bg-muted/30"
      >
        {expanded ? <ChevronDown size={12} className="shrink-0 text-muted-foreground" /> : <ChevronRight size={12} className="shrink-0 text-muted-foreground" />}
        {isDestructive && <AlertTriangle size={11} className="shrink-0 text-[var(--amber)]" />}
        <IconComponent size={12} className={`shrink-0 ${isDestructive ? 'text-[var(--amber)]' : 'text-muted-foreground'}`} />
        <span className={`font-medium ${isDestructive ? 'text-[var(--amber)]' : 'text-foreground'}`}>{displayPart.toolName}</span>
        <span className={headerSummaryClass}>{headerLabel}</span>
        <span className="ml-auto shrink-0 pt-0.5">
          {displayPart.state === 'pending' || displayPart.state === 'running' ? (
            <Loader2 size={12} className="animate-spin text-[var(--amber)]" />
          ) : displayPart.state === 'done' ? (
            <CheckCircle2 size={12} className="text-success" />
          ) : (
            <XCircle size={12} className="text-error" />
          )}
        </span>
      </button>
      {expanded && (
        <div className="border-t border-border/30">
          {/* Diff view for file-mutating tools — only when done and has diff */}
          {hasUserQuestion ? (
            <AskUserQuestionBlock part={displayPart} />
          ) : hasNativeRuntimeTool ? (
            <NativeRuntimeToolDetails
              part={displayPart}
              running={displayPart.state === 'running'}
            />
          ) : isSubagent ? (
            <SubagentToolDetails
              input={displayPart.input}
              output={displayPart.output}
              running={displayPart.state === 'running'}
            />
          ) : hasDiff && isDone && parsed.diffLines.length > 0 ? (
            <div className="max-h-64 overflow-y-auto">
              {parsed.diffLines.map((line, idx) => (
                <div
                  key={idx}
                  className={`px-2 py-px flex items-start gap-1.5 ${
                    line.prefix === '+'
                      ? 'bg-success/8'
                      : line.prefix === '-'
                        ? 'bg-error/8'
                        : ''
                  }`}
                >
                  <span
                    className={`select-none w-3 shrink-0 text-right ${
                      line.prefix === '+' ? 'text-success' : line.prefix === '-' ? 'text-error' : 'text-muted-foreground/50'
                    }`}
                  >
                    {line.prefix}
                  </span>
                  <span
                    className={`whitespace-pre-wrap break-all flex-1 ${
                      line.prefix === '+' ? 'text-success' : line.prefix === '-' ? 'text-error' : 'text-muted-foreground'
                    }`}
                  >
                    {line.text || '\u00A0'}
                  </span>
                </div>
              ))}
            </div>
          ) : (
            /* Fallback: show input (always), output when available */
            <div className="px-2.5 pb-2.5 pt-1.5 space-y-1.5">
              {displayPart.state === 'running' && (
                <div className="text-muted-foreground/60 text-2xs flex items-center gap-1.5">
                  <Loader2 size={10} className="animate-spin" /> Running...
                </div>
              )}
              <div className="text-muted-foreground leading-relaxed">
                <span className="font-semibold text-foreground/70">Input: </span>
                <span className="break-all whitespace-pre-wrap">{stringifyRedacted(displayPart.input)}</span>
              </div>
              {displayPart.output !== undefined && displayPart.output !== '' && (
                <div className="text-muted-foreground leading-relaxed">
                  <span className="font-semibold text-foreground/70">Output: </span>
                  <span className="break-all whitespace-pre-wrap">{redactSensitiveText(displayPart.output).length > 500 ? redactSensitiveText(displayPart.output).slice(0, 500) + '…' : redactSensitiveText(displayPart.output)}</span>
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
