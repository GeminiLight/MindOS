'use client';

import { useEffect, useId, useRef, useState } from 'react';
import { Check, CheckCircle2, Copy, FileCode2, Globe, Loader2, RefreshCw, ShieldCheck, Terminal, TriangleAlert } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useLocale } from '@/lib/stores/locale-store';
import { apiFetch } from '@/lib/api';
import { copyToClipboard } from '@/lib/clipboard';
import { revealMcpAuthToken } from '@/lib/mcp-token';
import { generateSnippet } from '@/lib/mcp-snippets';
import type { AgentInfo, McpStatus } from '@/components/settings/types';

type Result = { status?: string; path?: string; verified?: boolean; verifyError?: string; message?: string; warnings?: string[] };
type Feedback = { kind: 'success' | 'warning' | 'error'; text: string; detail?: string };
const focus = 'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring';

export default function AgentConnectionWorkbench({ agent, status, onRefresh }: {
  agent: AgentInfo;
  status: McpStatus | null;
  onRefresh: () => Promise<void>;
}) {
  const { t } = useLocale();
  const c = t.agentsContent.connection;
  const id = useId();
  const [scope, setScope] = useState<'global' | 'project'>(agent.scope === 'project' ? 'project' : 'global');
  const [transport, setTransport] = useState<'stdio' | 'http'>(agent.transport === 'http' || agent.transport === 'stdio' ? agent.transport : agent.preferredTransport);
  const [savedSignature, setSavedSignature] = useState(`${scope}:${transport}`);
  const [feedback, setFeedback] = useState<Feedback | null>(null);
  const [busy, setBusy] = useState<'save' | 'verify' | 'copy' | 'refresh' | null>(null);
  const [verifiedSignature, setVerifiedSignature] = useState<string | null>(null);
  const running = useRef(false);
  const alive = useRef(true);
  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);
  const projectAvailable = agent.hasProjectScope && Boolean(agent.projectRoot || agent.projectPath?.startsWith('/') || /^[A-Za-z]:[\\/]/.test(agent.projectPath ?? ''));
  const selectedAgent = scope === 'project' ? { ...agent, globalNestedKey: undefined, globalPath: agent.projectPath ?? '' } : agent;
  const snippet = generateSnippet(selectedAgent, status, transport);
  const targetPath = scope === 'project' && agent.projectRoot && !/^(\/|[A-Za-z]:[\\/])/.test(snippet.path)
    ? `${agent.projectRoot.replace(/[\\/]$/, '')}/${snippet.path}` : snippet.path;
  const signature = `${scope}:${transport}`;
  const changed = signature !== savedSignature;
  const endpointState = agent.connection?.status ?? 'unverified';
  const evidence = endpointState === 'reachable' ? c.reachable : endpointState === 'auth-required' ? c.authRequired : endpointState === 'unreachable' ? c.unreachable : c.unverified;

  async function perform(action: NonNullable<typeof busy>) {
    if (running.current || (scope === 'project' && !projectAvailable)) return;
    running.current = true;
    setBusy(action);
    setFeedback(null);
    try {
      if (action === 'refresh') {
        setVerifiedSignature(null);
        await onRefresh();
      } else if (action === 'copy') {
        const token = transport === 'http' && status?.authConfigured ? await revealMcpAuthToken() : undefined;
        const full = generateSnippet(selectedAgent, status, transport, token);
        if (!await copyToClipboard(full.snippet)) throw new Error(c.copyFailed);
        if (alive.current) setFeedback({ kind: 'success', text: c.copied });
      } else {
        setVerifiedSignature(null);
        let result: Result;
        if (action === 'save') {
          const token = transport === 'http' && status?.authConfigured ? await revealMcpAuthToken() : undefined;
          const response = await apiFetch<{ results: Result[] }>('/api/mcp/install', {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ agents: [{ key: agent.key, scope, transport }], ...(transport === 'http' ? { url: status?.endpoint ?? `http://127.0.0.1:${status?.port ?? 8781}/mcp`, token } : {}) }),
          });
          result = response.results?.[0] ?? {};
          if (result.status !== 'ok') throw new Error(result.message || c.saveFailed);
          if (alive.current) setSavedSignature(signature);
        } else {
          result = await apiFetch<Result>('/api/mcp/verify', {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ key: agent.key, scope }),
          });
        }
        if (!alive.current) return;
        setVerifiedSignature(result.verified ? signature : null);
        const warning = result.verified === false || Boolean(result.warnings?.length);
        setFeedback({
          kind: warning ? 'warning' : 'success',
          text: action === 'save' ? result.verified === false ? c.savedUnverified : result.verified ? c.savedVerified : c.saved
            : result.verified ? c.verified : transport === 'stdio' ? c.stdioVerify : c.unverified,
          detail: [result.verifyError, ...(result.warnings ?? [])].filter(Boolean).join('\n') || undefined,
        });
        // A refresh failure must not turn a completed save into a reported write failure.
        await onRefresh().catch(() => {
          if (alive.current) setFeedback(previous => previous ? { ...previous, detail: [previous.detail, c.refreshFailed].filter(Boolean).join('\n') } : previous);
        });
      }
    } catch (error) {
      if (alive.current) setFeedback({ kind: 'error', text: error instanceof Error ? error.message : c.saveFailed });
    } finally {
      running.current = false;
      if (alive.current) setBusy(null);
    }
  }

  return (
    <div className="space-y-5" aria-labelledby={`${id}-title`}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 id={`${id}-title`} className="flex items-center gap-2 text-sm font-semibold"><ShieldCheck size={17} className="text-[var(--amber-text)]" aria-hidden="true" />{c.title}</h2>
          <p className="mt-1 text-xs leading-relaxed text-muted-foreground">{c.subtitle}</p>
        </div>
        <Button variant="ghost" size="sm" className={focus} disabled={busy !== null} onClick={() => void perform('refresh')} aria-label={c.refresh}>
          <RefreshCw aria-hidden="true" className={busy === 'refresh' ? 'animate-spin' : ''} />{c.refresh}
        </Button>
      </div>

      <div className="flex flex-wrap gap-x-5 gap-y-2 border-y border-border py-3 text-xs" aria-label={c.savedConfig}>
        <span className="flex items-center gap-1.5 text-muted-foreground"><CheckCircle2 size={14} aria-hidden="true" />{agent.present ? c.detected : c.notDetected}</span>
        <span className="flex items-center gap-1.5 text-muted-foreground"><FileCode2 size={14} aria-hidden="true" />{agent.installed ? c.configured : c.notConfigured}</span>
        <span className={`flex items-center gap-1.5 ${verifiedSignature === signature ? 'text-success' : endpointState === 'unreachable' ? 'text-error' : 'text-muted-foreground'}`}>
          <Globe size={14} aria-hidden="true" />{verifiedSignature === signature ? c.verified : evidence}
        </span>
      </div>

      <div className="grid gap-5 lg:grid-cols-[minmax(0,0.85fr)_minmax(0,1.15fr)]">
        <div className="space-y-5">
          <fieldset disabled={busy !== null}>
            <legend className="mb-2 text-xs font-medium">{c.scope}</legend>
            <div className="flex gap-2">
              <Choice group={`${id}-scope`} label={c.globalScope} checked={scope === 'global'} disabled={!agent.hasGlobalScope} onChange={() => setScope('global')} />
              <Choice group={`${id}-scope`} label={c.projectScope} checked={scope === 'project'} disabled={!projectAvailable} onChange={() => setScope('project')} />
            </div>
            <p className="mt-2 text-xs leading-relaxed text-muted-foreground">{scope === 'project' ? c.projectHint : c.globalHint}</p>
            {agent.hasProjectScope && !projectAvailable && <p className="mt-1 text-xs text-muted-foreground">{c.projectUnavailable}</p>}
          </fieldset>
          <fieldset disabled={busy !== null}>
            <legend className="mb-2 text-xs font-medium">{c.transport}</legend>
            <div className="flex gap-2">
              <Choice group={`${id}-transport`} label={c.stdio} checked={transport === 'stdio'} onChange={() => setTransport('stdio')} />
              <Choice group={`${id}-transport`} label={c.http} checked={transport === 'http'} onChange={() => setTransport('http')} />
            </div>
            <p className="mt-2 text-xs leading-relaxed text-muted-foreground">{transport === 'stdio' ? c.stdioHint : c.httpHint}</p>
          </fieldset>
          {agent.key === 'opencode' && <p className="text-xs leading-relaxed text-muted-foreground">{c.openCodeHint}</p>}
        </div>
        <div className="min-w-0 overflow-hidden rounded-lg border border-border bg-background">
          <div className="flex items-center justify-between gap-2 border-b border-border px-3 py-2 text-xs text-muted-foreground">
            <span className="flex items-center gap-1.5"><Terminal size={13} aria-hidden="true" />{c.preview}</span>
            <span>{agent.format.toUpperCase()}</span>
          </div>
          <pre className="max-h-60 overflow-auto p-3 text-xs leading-relaxed" aria-label={c.preview} tabIndex={0}><code>{snippet.displaySnippet}</code></pre>
          <div className="border-t border-border px-3 py-2 text-xs">
            <span className="text-muted-foreground">{c.path}</span>
            <p className="mt-1 break-all font-mono text-foreground">{targetPath}</p>
          </div>
        </div>
      </div>
      <div className="flex flex-col gap-3 border-t border-border pt-4 sm:flex-row sm:items-start sm:justify-between">
        <div className="max-w-md text-xs leading-relaxed text-muted-foreground">
          <p>{changed ? c.pendingChanges : c.previewHint}</p>
          <p className="mt-1">{changed ? c.changedHint : c.verifyHint}</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" size="lg" className={focus} disabled={busy !== null} onClick={() => void perform('copy')}><Copy aria-hidden="true" />{c.copy}</Button>
          <Button variant="amber" size="lg" className={focus} disabled={busy !== null || (scope === 'project' && !projectAvailable)} onClick={() => void perform('save')}>
            {busy === 'save' ? <Loader2 className="animate-spin" aria-hidden="true" /> : <Check aria-hidden="true" />}{busy === 'save' ? c.saving : c.save}
          </Button>
        </div>
      </div>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <Button variant="ghost" size="sm" className={focus} disabled={busy !== null || changed || !agent.installed} onClick={() => void perform('verify')}>
          {busy === 'verify' ? <Loader2 className="animate-spin" aria-hidden="true" /> : <ShieldCheck aria-hidden="true" />}{busy === 'verify' ? c.verifying : c.verify}
        </Button>
        {agent.connection?.checkedAt && <span className="text-xs text-muted-foreground">{c.checked} · {new Date(agent.connection.checkedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>}
      </div>
      {feedback && <div role={feedback.kind === 'error' ? 'alert' : 'status'} aria-live="polite" className={`flex items-start gap-2 rounded-lg border p-3 text-xs leading-relaxed ${feedback.kind === 'error' ? 'border-error/20 bg-error/10 text-error' : feedback.kind === 'warning' ? 'border-border bg-muted text-foreground' : 'border-success/20 bg-success/10 text-success'}`}>
        {feedback.kind === 'success' ? <CheckCircle2 size={16} className="mt-0.5 shrink-0" aria-hidden="true" /> : <TriangleAlert size={16} className="mt-0.5 shrink-0" aria-hidden="true" />}
        <div className="min-w-0"><p className="font-medium">{feedback.text}</p>{feedback.detail && <p className="mt-1 whitespace-pre-wrap break-words">{feedback.detail}</p>}{feedback.kind === 'warning' && <p className="mt-1">{c.retryHint}</p>}</div>
      </div>}
    </div>
  );
}

function Choice({ group, label, checked, disabled, onChange }: { group: string; label: string; checked: boolean; disabled?: boolean; onChange: () => void }) {
  return <label className={`min-w-0 flex-1 ${disabled ? 'cursor-not-allowed' : 'cursor-pointer'}`}>
    <input type="radio" name={group} aria-label={label} aria-checked={checked} checked={checked} disabled={disabled} onChange={onChange} className="peer sr-only" />
    <span className="flex min-h-10 items-center justify-center rounded-lg border border-border px-3 py-2 text-center text-xs font-medium text-muted-foreground transition-colors peer-checked:border-[var(--amber)] peer-checked:bg-[var(--amber-subtle)] peer-checked:text-[var(--amber-text)] peer-focus-visible:ring-2 peer-focus-visible:ring-ring peer-disabled:opacity-50">{label}</span>
  </label>;
}
