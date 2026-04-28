'use client';

import { useState, useEffect, useCallback, useSyncExternalStore, useRef } from 'react';
import { Copy, Check, RefreshCw, Trash2, Sparkles, ChevronDown, ChevronRight, Loader2, Cpu, Database as DatabaseIcon, HardDrive, RotateCcw, FlaskConical } from 'lucide-react';
import { toast } from '@/lib/toast';
import type { KnowledgeTabProps } from './types';
import { Field, Input, EnvBadge, Toggle, SettingCard, SettingRow, PasswordInput } from './Primitives';
import { ConfirmDialog } from '@/components/agents/AgentsPrimitives';
import { apiFetch } from '@/lib/api';
import { copyToClipboard } from '@/lib/clipboard';
import { formatBytes, formatUptime } from '@/lib/format';
import { setShowHiddenFiles } from '@/components/FileTree';
import { scanExampleFilesAction, cleanupExamplesAction } from '@/lib/actions';
import WebPortSection from './WebPortSection';

export function KnowledgeTab({ data, setData, t }: KnowledgeTabProps) {
  const env = data.envOverrides ?? {};
  const k = t.settings.knowledge;
  const a = t.settings.appearance;

  // Labs feature flags
  const [labsEcho, setLabsEcho] = useState(() =>
    typeof window !== 'undefined' ? localStorage.getItem('mindos:labs-echo') === '1' : false
  );
  const [labsWorkflows, setLabsWorkflows] = useState(() =>
    typeof window !== 'undefined' ? localStorage.getItem('mindos:labs-workflows') === '1' : false
  );

  // Hidden files toggle
  const [showHidden, setShowHidden] = useState(() =>
    typeof window !== 'undefined' && localStorage.getItem('show-hidden-files') === 'true'
  );

  // Example files cleanup
  const [exampleCount, setExampleCount] = useState<number | null>(null);
  const [cleaningUp, setCleaningUp] = useState(false);
  const [cleanupResult, setCleanupResult] = useState<number | null>(null);

  useEffect(() => {
    scanExampleFilesAction().then(r => setExampleCount(r.files.length)).catch((err) => { console.warn("[KnowledgeTab] scanExampleFilesAction failed:", err); });
  }, []);

  // Guide state toggle
  const [guideActive, setGuideActive] = useState<boolean | null>(null);
  const [guideDismissed, setGuideDismissed] = useState(false);

  useEffect(() => {
    // 🟢 MINOR #5: Use apiFetch instead of raw fetch for consistency
    apiFetch<{ guideState?: { active: boolean; dismissed: boolean } }>('/api/setup')
      .then(d => {
        const gs = d.guideState;
        if (gs) {
          setGuideActive(gs.active);
          setGuideDismissed(!!gs.dismissed);
        }
      })
      .catch(err => {
        console.error('Failed to fetch guide state:', err);
      });
  }, []);

  const handleGuideToggle = useCallback(() => {
    const newDismissed = !guideDismissed;
    setGuideDismissed(newDismissed);
    // If re-enabling, also ensure active is true
    const patch: Record<string, boolean> = { dismissed: newDismissed };
    if (!newDismissed) patch.active = true;
    apiFetch('/api/setup', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ guideState: patch }),
    })
      .then(() => window.dispatchEvent(new Event('guide-state-updated')))
      .catch(err => {
        console.error('Failed to update guide state:', err);
        setGuideDismissed(!newDismissed); // rollback on failure
      });
  }, [guideDismissed]);

  const handleRestartWalkthrough = useCallback(() => {
    apiFetch('/api/setup', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        guideState: {
          active: true,
          dismissed: false,
          walkthroughStep: 0,
          walkthroughDismissed: false,
        },
      }),
    })
      .then(() => {
        setGuideActive(true);
        setGuideDismissed(false);
        window.dispatchEvent(new Event('guide-state-updated'));
      })
      .catch(err => console.error('Failed to restart walkthrough:', err));
  }, []);

  const origin = useSyncExternalStore(
    () => () => {},
    () => `${window.location.protocol}//${window.location.hostname}`,
    () => 'http://localhost',
  );

  const [resetting, setResetting] = useState(false);
  // revealed holds the plaintext token after regenerate, until user navigates away
  const [revealedToken, setRevealedToken] = useState<string | null>(null);
  const [showResetConfirm, setShowResetConfirm] = useState(false);
  const [showCleanupConfirm, setShowCleanupConfirm] = useState(false);

  const hasToken = !!(data.authToken);
  const displayToken = revealedToken ?? data.authToken ?? '';

  function handleResetToken() {
    setShowResetConfirm(true);
  }

  async function doResetToken() {
    setResetting(true);
    try {
      const res = await apiFetch<{ ok: boolean; token: string }>('/api/settings/reset-token', { method: 'POST' });
      setRevealedToken(res.token);
      setData(d => d ? { ...d, authToken: res.token } : d);
    } finally {
      setResetting(false);
    }
  }

  async function handleClearToken() {
    setData(d => d ? { ...d, authToken: '' } : d);
    setRevealedToken(null);
  }

  function handleCopy() {
    const text = revealedToken ?? data.authToken ?? '';
    if (!text) return;
    copyToClipboard(text).then((ok) => {
      if (ok) toast.copy();
    });
  }

  return (
    <div className="space-y-4">
      {/* ── Card 1: Knowledge Base ── */}
      <SettingCard
        icon={<DatabaseIcon size={15} />}
        title={k.cardTitle ?? 'Knowledge Base'}
        description={k.mindRootHint}
      >
        <Field
          label={<>{k.mindRoot} <EnvBadge overridden={env.MIND_ROOT} /></>}
          hint={env.MIND_ROOT ? k.envNote : k.mindRootHint}
        >
          <Input
            value={data.mindRoot}
            onChange={e => setData(d => d ? { ...d, mindRoot: e.target.value } : d)}
            placeholder="/path/to/your/notes"
          />
        </Field>

        <SettingRow label={k.showHiddenFiles} hint={k.showHiddenFilesHint}>
          <Toggle checked={showHidden} onChange={() => {
            const next = !showHidden;
            setShowHidden(next);
            setShowHiddenFiles(next);
          }} />
        </SettingRow>

        {exampleCount !== null && exampleCount > 0 && cleanupResult === null && (
          <SettingRow label={k.cleanupExamples} hint={k.cleanupExamplesHint}>
            <button
              onClick={() => setShowCleanupConfirm(true)}
              disabled={cleaningUp}
              title={cleaningUp ? t.hints.cleanupInProgress : undefined}
              className="flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium rounded-lg border border-border text-muted-foreground hover:text-foreground hover:bg-muted transition-colors shrink-0 disabled:opacity-50"
            >
              {cleaningUp ? <Loader2 size={12} className="animate-spin" /> : <Trash2 size={12} />}
              {k.cleanupExamplesButton}
              <span className="ml-1 tabular-nums text-2xs opacity-70">{exampleCount}</span>
            </button>
          </SettingRow>
        )}
        {cleanupResult !== null && (
          <div className="flex items-center gap-2 text-xs text-success">
            <Check size={14} />
            {k.cleanupExamplesDone(cleanupResult)}
          </div>
        )}
      </SettingCard>

      {/* ── Web UI Port ── */}
      <WebPortSection m={t.settings?.mcp ?? {}} />

      {/* ── Card 2: Security ── */}
      <SettingCard
        icon={<HardDrive size={15} />}
        title={k.securityTitle ?? 'Security'}
      >
        <Field label={k.webPassword} hint={k.webPasswordHint}>
          <PasswordInput
            value={data.webPassword ?? ''}
            onChange={v => setData(d => d ? { ...d, webPassword: v } : d)}
            placeholder={k.passwordPlaceholder ?? 'Leave empty to disable'}
          />
        </Field>

        <Field
          label={k.authToken}
          hint={hasToken ? k.authTokenHint : k.authTokenNone}
        >
          <div className="space-y-2">
            {/* Token display */}
            <div className="flex items-center gap-2 px-3 py-2 bg-background border border-border rounded-lg min-h-[38px]">
              <code className="flex-1 text-xs font-mono text-foreground break-all select-all">
                {displayToken || <span className="text-muted-foreground italic">{k.tokenNotSet ?? '— not set —'}</span>}
              </code>
              {displayToken && (
                <button
                  type="button"
                  onClick={handleCopy}
                  className="shrink-0 p-1 rounded text-muted-foreground hover:text-foreground transition-colors"
                  title={k.authTokenCopy}
                >
                  <Copy size={13} />
                </button>
              )}
            </div>
            {/* MCP port info */}
            {data.mcpPort && (
              <p className="text-xs text-muted-foreground">
                {k.authTokenMcpPort}: <code className="font-mono">{data.mcpPort}</code>
                {displayToken && (
                  <> &nbsp;·&nbsp; {k.mcpUrl ?? 'MCP URL'}: <code className="font-mono select-all">
                    {`${origin}:${data.mcpPort}/mcp`}
                  </code></>
                )}
              </p>
            )}
            {/* Action buttons */}
            <div className="flex gap-2">
              <button
                type="button"
                onClick={handleResetToken}
                disabled={resetting}
                title={resetting ? t.hints.tokenResetInProgress : undefined}
                className="flex items-center gap-1.5 px-3 py-1.5 text-sm rounded-lg border border-border text-muted-foreground hover:text-foreground hover:bg-muted disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
              >
                <RefreshCw size={14} className={resetting ? 'animate-spin' : ''} />
                {k.authTokenReset}
              </button>
              {hasToken && (
                <button
                  type="button"
                  onClick={handleClearToken}
                  className="flex items-center gap-1.5 px-3 py-1.5 text-sm rounded-lg border border-border text-muted-foreground hover:text-destructive hover:border-destructive/50 transition-colors"
                >
                  <Trash2 size={14} />
                  {k.authTokenClear}
                </button>
              )}
            </div>
            {revealedToken && (
              <p className="text-xs text-[var(--amber-text)]">
                {k.tokenGenerated}
              </p>
            )}
          </div>
        </Field>
      </SettingCard>

      {/* ── Card 3: Getting Started ── */}
      {guideActive !== null && (
        <SettingCard
          icon={<Sparkles size={15} />}
          title={t.guide?.title ?? 'Getting Started'}
        >
          <SettingRow label={t.guide?.showGuide ?? 'Show getting started guide'}>
            <Toggle checked={!guideDismissed} onChange={() => handleGuideToggle()} />
          </SettingRow>
          <button
            onClick={handleRestartWalkthrough}
            className="flex items-center gap-1.5 mt-2 px-3 py-1.5 text-sm rounded-lg border border-border text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
          >
            <RotateCcw size={14} />
            {k.restartWalkthrough ?? 'Restart walkthrough'}
          </button>
        </SettingCard>
      )}

      {/* ── Card 4: Labs — experimental features ── */}
      <SettingCard icon={<FlaskConical size={15} />} title={a.labsTitle ?? 'Labs'} description={a.labsDesc ?? 'Experimental features that are still in development.'}>
        <div className="space-y-3">
          <LabsToggle
            label={a.labsEcho ?? 'Echo'}
            description={a.labsEchoDesc ?? 'Reflective journaling powered by your notes.'}
            checked={labsEcho}
            onChange={v => {
              setLabsEcho(v);
              localStorage.setItem('mindos:labs-echo', v ? '1' : '0');
              window.dispatchEvent(new Event('mindos:labs-changed'));
            }}
          />
          <LabsToggle
            label={a.labsWorkflows ?? 'Flows'}
            description={a.labsWorkflowsDesc ?? 'Visual workflow automation for agents.'}
            checked={labsWorkflows}
            onChange={v => {
              setLabsWorkflows(v);
              localStorage.setItem('mindos:labs-workflows', v ? '1' : '0');
              window.dispatchEvent(new Event('mindos:labs-changed'));
            }}
          />
        </div>
      </SettingCard>

      {/* System Monitoring — collapsible */}
      <MonitoringSection k={k} />

      <ConfirmDialog
        open={showResetConfirm}
        title={k.authTokenReset ?? 'Regenerate Token'}
        message={k.authTokenResetConfirm}
        confirmLabel={k.authTokenReset ?? 'Regenerate'}
        cancelLabel={k.cancel ?? 'Cancel'}
        onConfirm={() => { setShowResetConfirm(false); doResetToken(); }}
        onCancel={() => setShowResetConfirm(false)}
      />
      <ConfirmDialog
        open={showCleanupConfirm}
        title={k.cleanupExamples ?? 'Cleanup Examples'}
        message={exampleCount !== null ? k.cleanupExamplesConfirm(exampleCount) : ''}
        confirmLabel={k.cleanupExamplesButton ?? 'Clean up'}
        cancelLabel={k.cancel ?? 'Cancel'}
        variant="destructive"
        onConfirm={async () => {
          setShowCleanupConfirm(false);
          setCleaningUp(true);
          const r = await cleanupExamplesAction();
          setCleaningUp(false);
          if (r.success) {
            setCleanupResult(r.deleted);
            setExampleCount(0);
          }
        }}
        onCancel={() => setShowCleanupConfirm(false)}
      />
    </div>
  );
}

/* ── Labs Toggle ── */
function LabsToggle({ label, description, checked, onChange }: {
  label: string;
  description: string;
  checked: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <label className="flex items-center gap-3 cursor-pointer group">
      <div className="flex-1 min-w-0">
        <span className="text-sm font-medium text-foreground block">{label}</span>
        <span className="text-xs text-muted-foreground">{description}</span>
      </div>
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        onClick={() => onChange(!checked)}
        className={`relative w-9 h-5 rounded-full transition-colors shrink-0 ${
          checked ? 'bg-[var(--amber)]' : 'bg-muted-foreground/20'
        }`}
      >
        <span className={`absolute top-0.5 left-0.5 w-4 h-4 rounded-full bg-white shadow-sm transition-transform ${
          checked ? 'translate-x-4' : 'translate-x-0'
        }`} />
      </button>
    </label>
  );
}

/* ── Inline Monitoring Section ── */

interface MonitoringData {
  system: {
    uptimeMs: number;
    memory: { heapUsed: number; heapTotal: number; rss: number };
    nodeVersion: string;
  };
  application: {
    agentRequests: number;
    toolExecutions: number;
    totalTokens: { input: number; output: number };
    avgResponseTimeMs: number;
    errors: number;
  };
  knowledgeBase: {
    root: string;
    fileCount: number;
    totalSizeBytes: number;
  };
  mcp: { running: boolean; port: number };
}

function MonitoringSection({ k }: { k: Record<string, unknown> }) {
  const [expanded, setExpanded] = useState(false);
  const [data, setData] = useState<MonitoringData | null>(null);
  const [loading, setLoading] = useState(false);

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const d = await apiFetch<MonitoringData>('/api/monitoring', { timeout: 5000 });
      setData(d);
    } catch { /* ignore */ }
    setLoading(false);
  }, []);

  // Fetch on first expand, then refresh every 10s while expanded
  const hasFetched = useRef(false);
  useEffect(() => {
    if (!expanded) { hasFetched.current = false; return; }
    if (!hasFetched.current) { fetchData(); hasFetched.current = true; }
    const id = setInterval(fetchData, 10_000);
    return () => clearInterval(id);
  }, [expanded, fetchData]);

  return (
    <div className="border-t border-border pt-5">
      <button
        onClick={() => setExpanded(v => !v)}
        className="flex items-center gap-1.5 text-sm font-medium text-muted-foreground hover:text-foreground transition-colors w-full"
      >
        {expanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
        <Cpu size={12} />
        {(k.monitoringTitle as string) ?? 'System Monitoring'}
        {loading && <Loader2 size={10} className="animate-spin ml-1" />}
      </button>

      {expanded && data && (
        <div className="mt-3 grid grid-cols-2 gap-x-6 gap-y-2 text-xs">
          <div>
            <span className="text-muted-foreground">{(k.monitorHeap as string) ?? 'Heap'}</span>
            <span className="ml-2 tabular-nums">{formatBytes(data.system.memory.heapUsed)} / {formatBytes(data.system.memory.heapTotal)}</span>
          </div>
          <div>
            <span className="text-muted-foreground">{(k.monitorRss as string) ?? 'RSS'}</span>
            <span className="ml-2 tabular-nums">{formatBytes(data.system.memory.rss)}</span>
          </div>
          <div>
            <span className="text-muted-foreground">{(k.monitorUptime as string) ?? 'Uptime'}</span>
            <span className="ml-2 tabular-nums">{formatUptime(data.system.uptimeMs)}</span>
          </div>
          <div>
            <span className="text-muted-foreground">{(k.monitorNode as string) ?? 'Node'}</span>
            <span className="ml-2">{data.system.nodeVersion}</span>
          </div>
          <div>
            <span className="text-muted-foreground">{(k.monitorRequests as string) ?? 'Requests'}</span>
            <span className="ml-2 tabular-nums">{data.application.agentRequests}</span>
          </div>
          <div>
            <span className="text-muted-foreground">{(k.monitorToolCalls as string) ?? 'Tool Calls'}</span>
            <span className="ml-2 tabular-nums">{data.application.toolExecutions}</span>
          </div>
          <div>
            <span className="text-muted-foreground">{(k.monitorTokens as string) ?? 'Tokens'}</span>
            <span className="ml-2 tabular-nums">{(data.application.totalTokens.input + data.application.totalTokens.output).toLocaleString()}</span>
          </div>
          <div>
            <span className="text-muted-foreground">{(k.monitorFiles as string) ?? 'Files'}</span>
            <span className="ml-2 tabular-nums">{data.knowledgeBase.fileCount} ({formatBytes(data.knowledgeBase.totalSizeBytes)})</span>
          </div>
          <div>
            <span className="text-muted-foreground">MCP</span>
            <span className="ml-2">{data.mcp.running ? ((k.monitorMcpRunning as (p: number) => string)?.(data.mcp.port) ?? `Running :${data.mcp.port}`) : ((k.monitorMcpStopped as string) ?? 'Stopped')}</span>
          </div>
          <div>
            <span className="text-muted-foreground">{(k.monitorErrors as string) ?? 'Errors'}</span>
            <span className="ml-2 tabular-nums">{data.application.errors}</span>
          </div>
        </div>
      )}

      {expanded && !data && !loading && (
        <p className="mt-2 text-xs text-muted-foreground">{(k.monitoringFailed as string) ?? 'Failed to load monitoring data'}</p>
      )}
    </div>
  );
}
