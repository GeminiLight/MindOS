'use client';

import { useState, useEffect, useCallback } from 'react';
import Link from 'next/link';
import {
  ArrowLeft, CheckCircle2, XCircle, Loader2, Send,
  Eye, EyeOff, Settings2, Trash2, AlertTriangle, AlertCircle, RefreshCw, ExternalLink,
} from 'lucide-react';
import { useLocale } from '@/lib/stores/locale-store';
import { getPlatform, type PlatformDef, type PlatformStatus } from '@/lib/im/platforms';

// ─── Component ────────────────────────────────────────────────────────────────

export default function AgentsContentChannelDetail({ platformId }: { platformId: string }) {
  const { t } = useLocale();
  const im = t.panels.im;
  const platform = getPlatform(platformId);

  const [status, setStatus] = useState<PlatformStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);

  // Configure form
  const [formValues, setFormValues] = useState<Record<string, string>>({});
  const [showSecrets, setShowSecrets] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saveResult, setSaveResult] = useState<{ ok: boolean; msg: string } | null>(null);

  // Test send
  const [testRecipient, setTestRecipient] = useState('');
  const [testMsg, setTestMsg] = useState('Hello from MindOS');
  const [testStatus, setTestStatus] = useState<'idle' | 'sending' | 'success' | 'error'>('idle');
  const [testResult, setTestResult] = useState('');

  // Disconnect
  const [deleting, setDeleting] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);

  const fetchStatus = useCallback(async () => {
    setError(false);
    try {
      const res = await fetch('/api/im/status');
      if (!res.ok) {
        setError(true);
        setLoading(false);
        return;
      }

      const data = await res.json();
      const platforms: PlatformStatus[] = data.platforms ?? [];
      setStatus(platforms.find(s => s.platform === platformId) ?? null);
    } catch {
      setError(true);
    }
    setLoading(false);
  }, [platformId]);

  useEffect(() => { fetchStatus(); }, [fetchStatus]);

  if (!platform) {
    return (
      <div className="text-center py-16">
        <p className="text-sm text-muted-foreground">Unknown platform: {platformId}</p>
        <Link href="/agents?tab=channels" className="text-xs text-[var(--amber)] hover:underline mt-2 inline-block">
          ← {im.backToChannels}
        </Link>
      </div>
    );
  }

  const isConnected = status?.connected ?? false;
  const hasExistingCredentials = isConnected;

  const handleSave = async () => {
    setSaving(true);
    setSaveResult(null);
    try {
      const res = await fetch('/api/im/config', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ platform: platformId, credentials: formValues }),
      });
      const data = await res.json();
      if (data.ok) {
        setSaveResult({ ok: true, msg: im.saved });
        setFormValues({});
        await fetchStatus();
      } else {
        setSaveResult({ ok: false, msg: data.error || 'Failed' });
      }
    } catch (err) {
      setSaveResult({ ok: false, msg: err instanceof Error ? err.message : 'Network error' });
    }
    setSaving(false);
  };

  const handleTest = async () => {
    if (!testRecipient.trim() || !testMsg.trim()) return;
    setTestStatus('sending');
    setTestResult('');
    try {
      const res = await fetch('/api/im/test', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ platform: platformId, recipient_id: testRecipient, message: testMsg }),
      });
      const data = await res.json();
      if (data.ok) {
        setTestStatus('success');
        setTestResult(data.messageId ? `Sent (ID: ${data.messageId})` : im.sentOk);
      } else {
        setTestStatus('error');
        setTestResult(data.error || 'Failed');
      }
    } catch (err) {
      setTestStatus('error');
      setTestResult(err instanceof Error ? err.message : 'Network error');
    }
  };

  const handleDisconnect = async () => {
    if (!confirmDelete) { setConfirmDelete(true); return; }
    setDeleting(true);
    setConfirmDelete(false);
    try {
      const res = await fetch(`/api/im/config?platform=${platformId}`, { method: 'DELETE' });
      if (res.ok) {
        await fetchStatus();
      }
    } catch { /* silent */ }
    setDeleting(false);
  };

  const isFormComplete = platform.fields.every(f => formValues[f.key]?.trim());

  if (loading) {
    return (
      <div className="flex justify-center py-16">
        <Loader2 size={20} className="animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="text-center py-16">
        <AlertCircle size={24} className="mx-auto mb-3 text-muted-foreground" />
        <p className="text-sm text-muted-foreground mb-3">{im.fetchError}</p>
        <button
          type="button"
          onClick={() => { setLoading(true); fetchStatus(); }}
          className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs rounded-md border border-border text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
        >
          <RefreshCw size={12} /> {im.retry}
        </button>
      </div>
    );
  }

  return (
    <div className="max-w-2xl">
      {/* Back link */}
      <Link
        href="/agents?tab=channels"
        className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors mb-6"
      >
        <ArrowLeft size={14} />
        {im.backToChannels}
      </Link>

      {/* Platform header */}
      <div className="flex items-start gap-3 mb-6">
        <span className="text-3xl shrink-0">{platform.icon}</span>
        <div className="flex-1">
          <h2 className="text-xl font-semibold text-foreground">{platform.name}</h2>
          {isConnected ? (
            <span className="inline-flex items-center gap-1.5 mt-1 text-xs font-medium px-2 py-0.5 rounded-md bg-success/10 text-success">
              <CheckCircle2 size={14} /> {im.statusConnected}
            </span>
          ) : (
            <span className="inline-flex items-center gap-1.5 mt-1 text-xs font-medium px-2 py-0.5 rounded-md bg-muted text-muted-foreground">
              {im.notConfigured}
            </span>
          )}
        </div>
      </div>

      {isConnected ? (
        /* ─── Connected View ─── */
        <div className="flex flex-col gap-6">
          {/* Status info */}
          <div className="rounded-lg border border-border bg-muted/30 p-4 shadow-sm">
            <h3 className="text-sm font-medium text-foreground mb-3">{im.tabStatus}</h3>
            {status?.botName && (
              <div className="flex items-center gap-2 mb-3">
                <span className="text-xs font-medium text-muted-foreground">Bot</span>
                <span className="text-sm text-foreground font-mono">{status.botName}</span>
              </div>
            )}
            {status?.capabilities && status.capabilities.length > 0 && (
              <div className="flex flex-wrap gap-1.5">
                {status.capabilities.map(cap => (
                  <span key={cap} className="text-xs px-2 py-1 rounded-md bg-muted text-muted-foreground">{cap}</span>
                ))}
              </div>
            )}
          </div>

          {/* Credential update */}
          <div className="rounded-lg border border-border bg-card p-4 shadow-sm">
            <h3 className="text-sm font-medium text-foreground mb-2">{im.editCredentials}</h3>
            <p className="text-sm text-muted-foreground leading-6 mb-4 max-w-prose">{platform.editHint || im.editCredentialsHint}</p>
            {hasExistingCredentials && (
              <p className="text-xs text-muted-foreground/80 leading-5 mb-4 max-w-prose">{im.savedValuesHint}</p>
            )}
            <div className="flex flex-col gap-4">
              {platform.fields.map(field => (
                <div key={field.key} className="flex flex-col gap-1.5">
                  <label className="text-xs font-medium text-muted-foreground">
                    {field.label}
                    <span className="text-muted-foreground/50 font-normal"> ({im.required})</span>
                  </label>
                  <div className="relative">
                    <input
                      type={showSecrets ? 'text' : 'password'}
                      placeholder={field.placeholder}
                      value={formValues[field.key] ?? ''}
                      onChange={e => setFormValues(prev => ({ ...prev, [field.key]: e.target.value }))}
                      className="h-11 w-full px-3 pr-10 text-sm font-mono bg-background border border-border rounded-md focus:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                      autoComplete="off"
                      aria-required="true"
                      aria-describedby={field.hint ? `connected-hint-${field.key}` : undefined}
                    />
                    <button
                      type="button"
                      onClick={() => setShowSecrets(!showSecrets)}
                      className="absolute right-2.5 top-1/2 -translate-y-1/2 p-1.5 text-muted-foreground hover:text-foreground rounded transition-colors"
                      aria-label={showSecrets ? im.hideSecret : im.showSecret}
                      title={showSecrets ? im.hideSecret : im.showSecret}
                    >
                      {showSecrets ? <EyeOff size={16} /> : <Eye size={16} />}
                    </button>
                  </div>
                  {field.hint && (
                    <span id={`connected-hint-${field.key}`} className="text-xs text-muted-foreground">{field.hint}</span>
                  )}
                </div>
              ))}
              <div className="flex items-center gap-3 pt-1">
                <button
                  type="button"
                  onClick={handleSave}
                  disabled={saving || !isFormComplete}
                  className="h-11 px-4 text-sm rounded-md inline-flex items-center gap-1.5 bg-[var(--amber)] text-[var(--amber-foreground)] shadow-sm hover:opacity-90 hover:shadow disabled:opacity-50 disabled:cursor-not-allowed transition-all"
                  aria-label={saving ? im.saving : im.saveConfig}
                >
                  {saving ? <Loader2 size={14} className="animate-spin" /> : <Settings2 size={14} />}
                  {saving ? im.saving : im.saveConfig}
                </button>
              </div>
              {saveResult && (
                <div 
                  role="alert" 
                  aria-live="polite"
                  className={`flex items-start gap-1.5 text-sm ${saveResult.ok ? 'text-success' : 'text-error'}`}
                >
                  {saveResult.ok ? <CheckCircle2 size={16} className="shrink-0 mt-0.5" /> : <XCircle size={16} className="shrink-0 mt-0.5" />}
                  <span className="break-all">{saveResult.msg}</span>
                </div>
              )}
            </div>
          </div>

          {/* Test send */}
          <div className="rounded-lg border border-border bg-card p-4 shadow-sm">
            <h3 className="text-sm font-medium text-foreground mb-3">{im.testSend}</h3>
            <div className="flex flex-col gap-3">
              <div>
                <label className="text-xs font-medium text-muted-foreground block mb-1.5">{im.recipientPlaceholder}</label>
                <input
                  type="text"
                  placeholder={im.recipientPlaceholder}
                  value={testRecipient}
                  onChange={e => setTestRecipient(e.target.value)}
                  className="h-11 w-full px-3 text-sm bg-background border border-border rounded-md focus:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                  aria-label={im.recipientPlaceholder}
                />
                <p className="text-xs text-muted-foreground mt-1.5 leading-5">{im.recipientHint}</p>
              </div>
              <div>
                <label className="text-xs font-medium text-muted-foreground block mb-1.5">{im.messagePlaceholder}</label>
                <input
                  type="text"
                  placeholder={im.messagePlaceholder}
                  value={testMsg}
                  onChange={e => setTestMsg(e.target.value)}
                  className="h-11 w-full px-3 text-sm bg-background border border-border rounded-md focus:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                  aria-label={im.messagePlaceholder}
                />
              </div>
              <div className="flex items-center gap-3 pt-1">
                <button
                  type="button"
                  onClick={handleTest}
                  disabled={testStatus === 'sending' || !testRecipient.trim()}
                  className="h-11 px-4 text-sm rounded-md inline-flex items-center gap-1.5 bg-[var(--amber)] text-[var(--amber-foreground)] shadow-sm hover:opacity-90 hover:shadow disabled:opacity-50 disabled:cursor-not-allowed transition-all"
                  aria-label={im.sendTest}
                >
                  {testStatus === 'sending' ? <Loader2 size={14} className="animate-spin" /> : <Send size={14} />}
                  {im.sendTest}
                </button>
              </div>
              {testResult && (
                <div 
                  role="alert" 
                  aria-live="polite"
                  className={`flex items-start gap-1.5 text-sm ${testStatus === 'success' ? 'text-success' : 'text-error'}`}
                >
                  {testStatus === 'success' ? <CheckCircle2 size={16} className="shrink-0 mt-0.5" /> : <XCircle size={16} className="shrink-0 mt-0.5" />}
                  <span className="break-all">{testResult}</span>
                </div>
              )}
            </div>
          </div>

          {/* Disconnect */}
          <div className="rounded-lg border border-error/20 bg-card p-4 shadow-sm">
            <h3 className="text-sm font-medium text-foreground mb-2">{im.disconnect}</h3>
            <p className="text-xs text-muted-foreground mb-3">{im.disconnectHint}</p>
            <button
              type="button"
              onClick={handleDisconnect}
              disabled={deleting}
              className={`h-11 px-4 text-sm rounded-md inline-flex items-center gap-1.5 border transition-colors ${
                confirmDelete
                  ? 'text-error border-error/40 bg-error/5 hover:bg-error/10'
                  : 'text-muted-foreground border-border hover:text-error hover:border-error/30'
              }`}
              aria-label={im.disconnect}
            >
              {deleting ? <Loader2 size={14} className="animate-spin" />
                : confirmDelete ? <><AlertTriangle size={14} /> {im.confirmDisconnect}</>
                : <Trash2 size={14} />}
              {!confirmDelete && !deleting && im.disconnect}
            </button>
          </div>
        </div>
      ) : (
        /* ─── Not Configured View ─── */
        <div className="flex flex-col gap-6">
          {/* Guide */}
          {platform.guide && (
            <div className="rounded-lg border border-border border-l-4 border-l-[var(--amber)] bg-card p-4 shadow-sm">
              <div className="flex items-start justify-between gap-3 mb-3">
                <h3 className="text-sm font-medium text-foreground">{im.setupGuide}</h3>
                {platform.guideUrl && (
                  <Link
                    href={platform.guideUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-xs bg-[var(--amber-dim)] text-[var(--amber)] hover:bg-[var(--amber-dim)]/80 shrink-0 transition-colors"
                  >
                    {im.guideLink}
                    <ExternalLink size={12} />
                  </Link>
                )}
              </div>
              <div className="text-sm text-muted-foreground leading-7 space-y-1.5 max-w-prose">
                {platform.guide.split('\n').map((line, idx) => (
                  <div key={idx}>{line}</div>
                ))}
              </div>
            </div>
          )}

          {/* Credential form */}
          <div className="rounded-lg border border-border bg-card p-4 shadow-sm">
            <h3 className="text-sm font-medium text-foreground mb-4">{im.tabConfigure}</h3>
            <div className="flex flex-col gap-4">
              {platform.fields.map(field => (
                <div key={field.key} className="flex flex-col gap-1.5">
                  <label className="text-xs font-medium text-muted-foreground">
                    {field.label}
                    <span className="text-muted-foreground/50 font-normal"> ({im.required})</span>
                  </label>
                  <div className="relative">
                    <input
                      type={showSecrets ? 'text' : 'password'}
                      placeholder={field.placeholder}
                      value={formValues[field.key] ?? ''}
                      onChange={e => setFormValues(prev => ({ ...prev, [field.key]: e.target.value }))}
                      className="h-11 w-full px-3 pr-10 text-sm font-mono bg-background border border-border rounded-md focus:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                      autoComplete="off"
                      aria-required="true"
                      aria-describedby={field.hint ? `hint-${field.key}` : undefined}
                    />
                    <button
                      type="button"
                      onClick={() => setShowSecrets(!showSecrets)}
                      className="absolute right-2.5 top-1/2 -translate-y-1/2 p-1.5 text-muted-foreground hover:text-foreground rounded transition-colors"
                      aria-label={showSecrets ? im.hideSecret : im.showSecret}
                      title={showSecrets ? im.hideSecret : im.showSecret}
                    >
                      {showSecrets ? <EyeOff size={16} /> : <Eye size={16} />}
                    </button>
                  </div>
                  {field.hint && (
                    <span id={`hint-${field.key}`} className="text-xs text-muted-foreground">{field.hint}</span>
                  )}
                </div>
              ))}
              <div className="flex items-center gap-3 pt-2">
                <button
                  type="button"
                  onClick={handleSave}
                  disabled={saving || !isFormComplete}
                  className="h-11 px-4 text-sm rounded-md inline-flex items-center gap-1.5 bg-[var(--amber)] text-[var(--amber-foreground)] shadow-sm hover:opacity-90 hover:shadow disabled:opacity-50 disabled:cursor-not-allowed transition-all"
                  aria-label={saving ? im.saving : im.saveConfig}
                >
                  {saving ? <Loader2 size={14} className="animate-spin" /> : <Settings2 size={14} />}
                  {saving ? im.saving : im.saveConfig}
                </button>
              </div>
              {saveResult && (
                <div 
                  role="alert" 
                  aria-live="polite"
                  className={`flex items-start gap-1.5 text-sm ${saveResult.ok ? 'text-success' : 'text-error'}`}
                >
                  {saveResult.ok ? (
                    <>
                      <CheckCircle2 size={16} className="shrink-0 mt-0.5" />
                      <span className="break-all">{saveResult.msg}</span>
                    </>
                  ) : (
                    <>
                      <XCircle size={16} className="shrink-0 mt-0.5" />
                      <span className="break-all">{saveResult.msg}</span>
                    </>
                  )}
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
