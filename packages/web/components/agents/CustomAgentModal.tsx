'use client';

import { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { X, Loader2, ChevronRight, ChevronDown, CheckCircle2, Info, AlertCircle, Server, Zap } from 'lucide-react';
import { useLocale } from '@/lib/stores/locale-store';
import { useFocusTrap } from '@/lib/hooks/useFocusTrap';
import { toast } from '@/lib/toast';
import { Field, Input } from '@/components/settings/Primitives';
import type { AgentInfo } from '@/components/settings/types';

/* ─── Types ─── */

interface DetectResult {
  exists: boolean;
  detectedConfig?: string;
  detectedFormat?: 'json' | 'toml';
  detectedConfigKey?: string;
  hasSkillsDir: boolean;
  detectedSkillDir?: string;
  skillCount?: number;
  skillNames?: string[];
  mcpServers?: string[];
  mcpParseError?: string;
  suggestedName?: string;
}

interface FormState {
  name: string;
  baseDir: string;
  global: string;
  configKey: string;
  format: 'json' | 'toml';
  preferredTransport: 'stdio' | 'http';
  project: string;
  presenceCli: string;
  skillDir: string;
}

interface CustomAgentModalProps {
  open: boolean;
  onClose: () => void;
  onSuccess: () => void;
  existingAgents: AgentInfo[];
  /** If provided, modal is in "edit" mode. */
  editAgent?: AgentInfo | null;
}

/* ─── Slugify (client-side mirror) ─── */

function slugify(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^\x20-\x7E]/g, '')
    .replace(/[_\s]+/g, '-')
    .replace(/[^a-z0-9-]/g, '')
    .replace(/-{2,}/g, '-')
    .replace(/^-|-$/g, '');
}

/* ─── Component ─── */

export default function CustomAgentModal({
  open,
  onClose,
  onSuccess,
  existingAgents,
  editAgent,
}: CustomAgentModalProps) {
  const { t } = useLocale();
  const p = t.agentsContent.overview;
  const dialogRef = useRef<HTMLDivElement>(null);
  const nameRef = useRef<HTMLInputElement>(null);

  const isEdit = !!editAgent;

  // Phase: 'input' (Phase A) or 'result' (Phase B)
  const [phase, setPhase] = useState<'input' | 'result'>('input');
  const [detecting, setDetecting] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [detectResult, setDetectResult] = useState<DetectResult | null>(null);
  const [detectTimedOut, setDetectTimedOut] = useState(false);
  const [customizeOpen, setCustomizeOpen] = useState(false);

  const [form, setForm] = useState<FormState>({
    name: '',
    baseDir: '',
    global: '',
    configKey: 'mcpServers',
    format: 'json',
    preferredTransport: 'stdio',
    project: '',
    presenceCli: '',
    skillDir: '',
  });

  // Reset state when modal opens/closes or editAgent changes
  useEffect(() => {
    if (!open) return;
    if (editAgent) {
      setForm({
        name: editAgent.name,
        baseDir: editAgent.customBaseDir || '',
        global: editAgent.globalPath || '',
        configKey: editAgent.configKey || 'mcpServers',
        format: editAgent.format || 'json',
        preferredTransport: editAgent.preferredTransport || 'stdio',
        project: editAgent.projectPath || '',
        presenceCli: '',
        skillDir: editAgent.skillWorkspacePath || '',
      });
      setPhase('result');
      setCustomizeOpen(true);
      setDetectResult(null);
      setError(null);
    } else {
      setForm({
        name: '',
        baseDir: '',
        global: '',
        configKey: 'mcpServers',
        format: 'json',
        preferredTransport: 'stdio',
        project: '',
        presenceCli: '',
        skillDir: '',
      });
      setPhase('input');
      setCustomizeOpen(false);
      setDetectResult(null);
      setError(null);
      setDetectTimedOut(false);
    }
  }, [open, editAgent]);

  // Focus name input on open
  useEffect(() => {
    if (open && phase === 'input') {
      setTimeout(() => nameRef.current?.focus(), 100);
    }
  }, [open, phase]);

  useFocusTrap(dialogRef, open);

  // Escape to close
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  const existingKeys = useMemo(() => {
    const keys = new Set(existingAgents.map(a => a.key));
    if (isEdit && editAgent) keys.delete(editAgent.key);
    return keys;
  }, [existingAgents, isEdit, editAgent]);

  const slug = useMemo(() => slugify(form.name), [form.name]);

  const nameError = useMemo(() => {
    if (isEdit) return null; // key is immutable on edit; name can change freely
    if (!form.name.trim()) return null;
    const key = slug || '';
    if (!key) return null;
    if (existingKeys.has(key)) {
      const conflict = existingAgents.find(a => a.key === key);
      if (conflict?.isCustom) return p.customAgentKeyConflict?.(key) ?? `An agent with key "${key}" already exists`;
      return p.customAgentBuiltinConflict?.(conflict?.name || key) ?? `Conflicts with built-in agent "${conflict?.name || key}"`;
    }
    return null;
  }, [isEdit, slug, existingKeys, existingAgents, form.name, p]);

  const canContinue = form.name.trim() && form.baseDir.trim() && !nameError;

  const setField = useCallback(<K extends keyof FormState>(key: K, value: FormState[K]) => {
    setForm(prev => ({ ...prev, [key]: value }));
  }, []);

  /* ─── Detect ─── */

  const handleContinue = useCallback(async () => {
    if (!canContinue) return;
    setError(null);
    setDetecting(true);

    const dir = form.baseDir.trim();

    // Detect API only scans ~/ paths for security; for other absolute paths,
    // skip detection and go straight to Phase B with sensible defaults.
    if (!dir.startsWith('~/')) {
      const normalized = dir.endsWith('/') ? dir : dir + '/';
      setField('global', normalized + 'mcp.json');
      setField('skillDir', normalized + 'skills/');
      setDetectResult({ exists: false, hasSkillsDir: false });
      setPhase('result');
      setDetecting(false);
      return;
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 3000);

    try {
      const res = await fetch('/api/agents/custom/detect', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ baseDir: dir }),
        signal: controller.signal,
      });

      clearTimeout(timeout);
      const data: DetectResult = await res.json();

      if (!res.ok) {
        setError((data as unknown as { error: string }).error || p.customAgentFailedSave);
        return;
      }

      setDetectResult(data);

      if (data.detectedConfig) setField('global', data.detectedConfig);
      else {
        setField('global', (dir.endsWith('/') ? dir : dir + '/') + 'mcp.json');
      }
      if (data.detectedFormat) setField('format', data.detectedFormat);
      if (data.detectedConfigKey) setField('configKey', data.detectedConfigKey);
      setField('skillDir', data.detectedSkillDir || (dir.endsWith('/') ? dir : dir + '/') + 'skills/');

      setPhase('result');
    } catch {
      clearTimeout(timeout);
      const normalized = dir.endsWith('/') ? dir : dir + '/';
      setField('global', normalized + 'mcp.json');
      setField('skillDir', normalized + 'skills/');
      setDetectResult({ exists: false, hasSkillsDir: false });
      setDetectTimedOut(true);
      setPhase('result');
    } finally {
      setDetecting(false);
    }
  }, [canContinue, form.baseDir, setField, p]);

  /* ─── Save ─── */

  const handleSave = useCallback(async () => {
    setSaving(true);
    setError(null);

    const body = isEdit
      ? {
          key: editAgent!.key,
          name: form.name.trim(),
          baseDir: form.baseDir.trim(),
          global: form.global.trim() || undefined,
          configKey: form.configKey.trim() || undefined,
          format: form.format,
          preferredTransport: form.preferredTransport,
          project: form.project.trim() || null,
          presenceCli: form.presenceCli.trim() || undefined,
          skillDir: form.skillDir.trim() || undefined,
        }
      : {
          name: form.name.trim(),
          baseDir: form.baseDir.trim(),
          global: form.global.trim() || undefined,
          configKey: form.configKey.trim() || undefined,
          format: form.format,
          preferredTransport: form.preferredTransport,
          project: form.project.trim() || null,
          presenceCli: form.presenceCli.trim() || undefined,
          skillDir: form.skillDir.trim() || undefined,
        };

    try {
      const res = await fetch('/api/agents/custom', {
        method: isEdit ? 'PUT' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });

      const data = await res.json();

      if (!res.ok) {
        setError(data.error || p.customAgentFailedSave);
        setSaving(false);
        return;
      }

      const toastMsg = isEdit
        ? p.customAgentUpdated(form.name.trim())
        : p.customAgentAdded(form.name.trim());
      toast.success(toastMsg);
      onSuccess();
      onClose();
    } catch {
      setError(p.customAgentNetworkError);
    } finally {
      setSaving(false);
    }
  }, [isEdit, editAgent, form, onSuccess, onClose, p]);

  /* ─── Keyboard: Enter ─── */

  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key !== 'Enter') return;
    if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) {
      e.preventDefault();
      if (phase === 'input' && canContinue && !detecting) {
        handleContinue();
      } else if (phase === 'result' && !saving) {
        handleSave();
      }
    }
  }, [phase, canContinue, detecting, saving, handleContinue, handleSave]);

  if (!open) return null;

  const title = isEdit
    ? p.editCustomAgentTitle(editAgent!.name)
    : p.addCustomAgentTitle;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center" role="dialog" aria-modal="true" aria-labelledby="custom-agent-modal-title">
      {/* Backdrop */}
      <div className="absolute inset-0 modal-backdrop" onClick={onClose} aria-hidden="true" />

      {/* Dialog */}
      <div
        ref={dialogRef}
        className="relative bg-card border border-border rounded-xl shadow-2xl max-w-md w-full mx-4 animate-in fade-in zoom-in-95 duration-200 max-h-[85vh] overflow-y-auto"
        onKeyDown={handleKeyDown}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-5 pt-5 pb-1">
          <h2 id="custom-agent-modal-title" className="text-base font-semibold text-foreground">{title}</h2>
          <button
            type="button"
            onClick={onClose}
            className="w-7 h-7 rounded-md flex items-center justify-center text-muted-foreground hover:text-foreground hover:bg-muted transition-colors duration-150 cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            aria-label="Close"
          >
            <X size={16} />
          </button>
        </div>

        {/* Body */}
        <div className="px-5 py-4 space-y-4">
          {/* Name */}
          <Field label={p.customAgentName}>
            <input
              ref={nameRef}
              value={form.name}
              onChange={(e) => setField('name', e.target.value)}
              placeholder={p.customAgentNamePlaceholder}
              aria-invalid={!!nameError}
              className={`w-full px-3 py-2 text-sm bg-background border rounded-lg text-foreground placeholder:text-muted-foreground outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:opacity-50 ${nameError ? 'border-[var(--error)] focus-visible:ring-[var(--error)]' : 'border-border'}`}
              autoComplete="off"
            />
            {nameError ? (
              <p className="text-xs text-[var(--error)] mt-1 flex items-center gap-1">
                <AlertCircle size={12} />
                {nameError}
              </p>
            ) : form.name.trim() && slug ? (
              <p className="text-[11px] text-muted-foreground mt-0.5">{p.customAgentKeyPreview(slug)}</p>
            ) : null}
          </Field>

          {/* Base Dir */}
          <Field label={p.customAgentDir} hint={phase === 'input' ? p.customAgentDirHint : undefined}>
            <Input
              value={form.baseDir}
              onChange={(e) => {
                setField('baseDir', e.target.value);
                if (phase === 'result') {
                  setPhase('input');
                  setDetectResult(null);
                }
              }}
              placeholder={p.customAgentDirPlaceholder}
              autoComplete="off"
            />
            {/* Detection status hints */}
            {phase === 'result' && detectResult?.exists && (
              <p className="text-xs text-[var(--success)] mt-1 flex items-center gap-1">
                <CheckCircle2 size={12} />
                {p.customAgentDirFound}
              </p>
            )}
            {phase === 'result' && detectResult && !detectResult.exists && !detectTimedOut && (
              <p className="text-xs text-[var(--info,var(--muted-foreground))] mt-1 flex items-center gap-1">
                <Info size={12} />
                {p.customAgentDirNotFound}
              </p>
            )}
            {phase === 'result' && detectTimedOut && (
              <p className="text-xs text-[var(--amber)] mt-1 flex items-center gap-1">
                <AlertCircle size={12} />
                {p.customAgentDetectTimeout}
              </p>
            )}
          </Field>

          {/* Phase B: Detection Results */}
          {phase === 'result' && (
            <>
              {/* Result Card */}
              <div className={`rounded-lg p-4 space-y-3 ${
                detectResult?.exists
                  ? 'border border-[var(--success)]/20 bg-[var(--success)]/5'
                  : 'border border-border bg-muted/30'
              }`}>
                <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
                  {detectResult?.exists ? p.customAgentDetectedTitle : p.customAgentDefaultTitle}
                </p>
                <div className="space-y-2.5">
                  {/* Config Path */}
                  <div>
                    <p className="text-xs text-muted-foreground mb-1">{p.customAgentConfigLabel}</p>
                    <span className="text-sm text-foreground font-mono truncate block">{form.global}</span>
                    {detectResult?.mcpParseError && (
                      <p className="text-xs text-[var(--error)] mt-1 flex items-center gap-1">
                        <AlertCircle size={12} className="shrink-0" />
                        {detectResult.mcpParseError}
                      </p>
                    )}
                  </div>

                  {/* Format & Key */}
                  <div className="grid grid-cols-2 gap-2">
                    <div>
                      <p className="text-xs text-muted-foreground mb-1">{p.customAgentFormatLabel}</p>
                      <span className="text-sm text-foreground">{form.format.toUpperCase()}</span>
                    </div>
                    <div>
                      <p className="text-xs text-muted-foreground mb-1">Config Key</p>
                      <span className="text-sm text-foreground font-mono">{form.configKey}</span>
                    </div>
                  </div>

                  {/* Transport */}
                  <div>
                    <p className="text-xs text-muted-foreground mb-1">{p.customAgentTransportLabel}</p>
                    <span className="text-sm text-foreground">{form.preferredTransport}</span>
                  </div>

                  {/* MCP Servers */}
                  <div>
                    <p className="text-xs text-muted-foreground mb-1 flex items-center gap-1">
                      <Server size={11} className="shrink-0" aria-hidden="true" />
                      MCP Servers
                    </p>
                    {detectResult?.mcpServers && detectResult.mcpServers.length > 0 ? (
                      <div className="flex flex-wrap gap-1">
                        {detectResult.mcpServers.map(name => (
                          <span key={name} className="text-xs bg-muted/60 text-foreground px-2 py-0.5 rounded font-mono">
                            {name}
                          </span>
                        ))}
                      </div>
                    ) : (
                      <span className="text-sm text-muted-foreground">—</span>
                    )}
                  </div>

                  {/* Skills */}
                  <div>
                    <p className="text-xs text-muted-foreground mb-1 flex items-center gap-1">
                      <Zap size={11} className="shrink-0" aria-hidden="true" />
                      {p.customAgentSkillsLabel}
                    </p>
                    {detectResult?.skillNames && detectResult.skillNames.length > 0 ? (
                      <div className="flex flex-wrap gap-1">
                        {detectResult.skillNames.map(name => (
                          <span key={name} className="text-xs bg-[var(--amber-dim)] text-[var(--amber-text,var(--foreground))] px-2 py-0.5 rounded font-mono">
                            {name}
                          </span>
                        ))}
                      </div>
                    ) : (
                      <span className="text-sm text-muted-foreground">—</span>
                    )}
                  </div>
                </div>
              </div>

              {/* Customize toggle */}
              <button
                type="button"
                onClick={() => setCustomizeOpen(prev => !prev)}
                className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors duration-150 cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring rounded"
              >
                {customizeOpen ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
                {p.customAgentCustomize}
              </button>

              {/* Customize panel — CSS Grid expand */}
              <div
                className="grid transition-[grid-template-rows] duration-200 ease-out"
                style={{ gridTemplateRows: customizeOpen ? '1fr' : '0fr' }}
              >
                <div className="overflow-hidden">
                  <div className="rounded-xl border border-border/50 bg-card/50 p-5 space-y-4">
                    {/* MCP Config Path */}
                    <Field label={p.customAgentConfigPath}>
                      <Input
                        value={form.global}
                        onChange={(e) => setField('global', e.target.value)}
                        autoComplete="off"
                      />
                    </Field>

                    {/* Config Key + Format */}
                    <div className="grid grid-cols-2 gap-3">
                      <Field label={p.customAgentConfigKey}>
                        <Input
                          value={form.configKey}
                          onChange={(e) => setField('configKey', e.target.value)}
                          autoComplete="off"
                        />
                      </Field>
                      <Field label={p.customAgentFormat}>
                        <div className="flex gap-2 pt-1">
                          <RadioPill
                            label="JSON"
                            checked={form.format === 'json'}
                            onChange={() => setField('format', 'json')}
                            name="format"
                          />
                          <RadioPill
                            label="TOML"
                            checked={form.format === 'toml'}
                            onChange={() => setField('format', 'toml')}
                            name="format"
                          />
                        </div>
                      </Field>
                    </div>

                    {/* Transport */}
                    <Field label={p.customAgentTransport}>
                      <div className="flex gap-2">
                        <RadioPill
                          label="stdio"
                          checked={form.preferredTransport === 'stdio'}
                          onChange={() => setField('preferredTransport', 'stdio')}
                          name="transport"
                        />
                        <RadioPill
                          label="http"
                          checked={form.preferredTransport === 'http'}
                          onChange={() => setField('preferredTransport', 'http')}
                          name="transport"
                        />
                      </div>
                    </Field>

                    {/* Skills Directory */}
                    <Field label={p.customAgentSkillDir} hint={p.customAgentSkillDirHint}>
                      <Input
                        value={form.skillDir}
                        onChange={(e) => setField('skillDir', e.target.value)}
                        placeholder={p.customAgentSkillDirPlaceholder}
                        autoComplete="off"
                      />
                    </Field>

                    {/* Project Config */}
                    <Field label={p.customAgentProjectConfig}>
                      <Input
                        value={form.project}
                        onChange={(e) => setField('project', e.target.value)}
                        autoComplete="off"
                      />
                    </Field>

                    {/* CLI Binary */}
                    <Field label={p.customAgentCliBinary}>
                      <Input
                        value={form.presenceCli}
                        onChange={(e) => setField('presenceCli', e.target.value)}
                        placeholder={p.customAgentCliBinaryPlaceholder}
                        autoComplete="off"
                      />
                    </Field>
                  </div>
                </div>
              </div>
            </>
          )}

          {/* Error Banner */}
          {error && (
            <div className="rounded-lg border border-[var(--error)]/30 bg-[var(--error)]/5 p-3 flex items-start gap-2">
              <AlertCircle size={14} className="text-[var(--error)] mt-0.5 shrink-0" />
              <p className="text-sm text-[var(--error)]">{error}</p>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex justify-end gap-2 px-5 pb-5 pt-1">
          <button
            type="button"
            onClick={onClose}
            className="px-4 min-h-[36px] text-sm rounded-lg border border-border hover:bg-muted cursor-pointer transition-colors duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            {p.customAgentCancel}
          </button>

          {phase === 'input' ? (
            <button
              type="button"
              onClick={handleContinue}
              disabled={!canContinue || detecting}
              className="px-4 min-h-[36px] text-sm rounded-lg bg-[var(--amber)] text-[var(--amber-foreground)] hover:bg-[var(--amber)]/90 disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer transition-colors duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring flex items-center gap-2"
            >
              {detecting ? (
                <>
                  <Loader2 size={14} className="animate-spin" />
                  {p.customAgentDetecting}
                </>
              ) : (
                <>
                  {p.customAgentContinue}
                  <ChevronRight size={14} />
                </>
              )}
            </button>
          ) : (
            <button
              type="button"
              onClick={handleSave}
              disabled={saving}
              className="px-4 min-h-[36px] text-sm rounded-lg bg-[var(--amber)] text-[var(--amber-foreground)] hover:bg-[var(--amber)]/90 disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer transition-colors duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring flex items-center gap-2"
            >
              {saving ? (
                <>
                  <Loader2 size={14} className="animate-spin" />
                  {isEdit ? p.customAgentSaving : p.customAgentAdding}
                </>
              ) : error ? (
                p.customAgentRetry
              ) : isEdit ? (
                p.customAgentSave
              ) : (
                p.customAgentAdd
              )}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

/* ─── Radio Pill (inline sub-component) ─── */

function RadioPill({
  label,
  checked,
  onChange,
  name,
}: {
  label: string;
  checked: boolean;
  onChange: () => void;
  name: string;
}) {
  return (
    <label
      className={`px-3 py-1.5 text-sm rounded-md border cursor-pointer transition-all duration-150 select-none ${
        checked
          ? 'border-[var(--amber)]/40 bg-[var(--amber-dim)] text-foreground font-medium'
          : 'border-border bg-background text-muted-foreground hover:bg-muted'
      }`}
    >
      <input
        type="radio"
        name={name}
        checked={checked}
        onChange={onChange}
        className="sr-only"
      />
      {label}
    </label>
  );
}
