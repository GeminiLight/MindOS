'use client';

import { useState, useEffect, useCallback } from 'react';
import {
  MessageSquare, Send, ChevronDown, ChevronRight, CheckCircle2, XCircle,
  Loader2, Trash2, Eye, EyeOff, Settings2, AlertTriangle,
} from 'lucide-react';
import PanelHeader from './PanelHeader';
import { useLocale } from '@/lib/stores/locale-store';

// ─── Platform Definitions ─────────────────────────────────────────────────────

interface PlatformDef {
  id: string;
  name: string;
  icon: string;
  fields: { key: string; label: string; placeholder: string; hint?: string }[];
}

const PLATFORMS: PlatformDef[] = [
  {
    id: 'telegram', name: 'Telegram', icon: '📱',
    fields: [
      { key: 'bot_token', label: 'Bot Token', placeholder: '123456:ABC-DEF...', hint: 'From @BotFather' },
    ],
  },
  {
    id: 'feishu', name: 'Feishu', icon: '🐦',
    fields: [
      { key: 'app_id', label: 'App ID', placeholder: 'cli_xxxxx' },
      { key: 'app_secret', label: 'App Secret', placeholder: 'xxxxxx', hint: 'Open Platform console' },
    ],
  },
  {
    id: 'discord', name: 'Discord', icon: '💬',
    fields: [
      { key: 'bot_token', label: 'Bot Token', placeholder: 'MTIx...', hint: 'Developer Portal → Bot → Token' },
    ],
  },
  {
    id: 'slack', name: 'Slack', icon: '💼',
    fields: [
      { key: 'bot_token', label: 'Bot Token', placeholder: 'xoxb-...', hint: 'OAuth & Permissions → Bot Token' },
    ],
  },
  {
    id: 'wecom', name: 'WeCom', icon: '🏢',
    fields: [
      { key: 'webhook_key', label: 'Webhook Key', placeholder: 'xxxxxxxx-xxxx-xxxx-xxxx', hint: 'Group Robot → Webhook URL key' },
    ],
  },
  {
    id: 'dingtalk', name: 'DingTalk', icon: '🔔',
    fields: [
      { key: 'webhook_url', label: 'Webhook URL', placeholder: 'https://oapi.dingtalk.com/robot/send?access_token=...', hint: 'Custom Robot → Webhook' },
    ],
  },
  {
    id: 'wechat', name: 'WeChat', icon: '💚',
    fields: [
      { key: 'bot_token', label: 'Bot Token', placeholder: 'wx_xxxxx', hint: 'iLink Bot → QR scan → token' },
    ],
  },
  {
    id: 'qq', name: 'QQ', icon: '🐧',
    fields: [
      { key: 'app_id', label: 'App ID', placeholder: '102xxx' },
      { key: 'app_secret', label: 'App Secret', placeholder: 'xxxxxx', hint: 'QQ Open Platform → Bot' },
    ],
  },
];

// ─── Types ────────────────────────────────────────────────────────────────────

type PlatformStatus = {
  platform: string;
  connected: boolean;
  botName?: string;
  capabilities: string[];
};

type ExpandedView = 'status' | 'configure';

interface IMPanelProps {
  active: boolean;
  maximized?: boolean;
  onMaximize?: () => void;
}

// ─── Component ────────────────────────────────────────────────────────────────

export default function IMPanel({ active, maximized, onMaximize }: IMPanelProps) {
  const { t } = useLocale();
  const im = t.panels.im;

  const [statuses, setStatuses] = useState<PlatformStatus[]>([]);
  const [loading, setLoading] = useState(true);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [expandedView, setExpandedView] = useState<ExpandedView>('status');

  // Config form state
  const [formValues, setFormValues] = useState<Record<string, string>>({});
  const [showSecrets, setShowSecrets] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saveResult, setSaveResult] = useState<{ ok: boolean; msg: string } | null>(null);

  // Test send state
  const [testRecipient, setTestRecipient] = useState('');
  const [testMsg, setTestMsg] = useState('');
  const [testStatus, setTestStatus] = useState<'idle' | 'sending' | 'success' | 'error'>('idle');
  const [testResult, setTestResult] = useState('');

  // Deleting state
  const [deleting, setDeleting] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);

  const fetchStatuses = useCallback(async () => {
    try {
      const res = await fetch('/api/im/status');
      if (res.ok) {
        const data = await res.json();
        setStatuses(data.platforms ?? []);
      }
    } catch { /* silent */ }
    setLoading(false);
  }, []);

  useEffect(() => {
    if (active) fetchStatuses();
  }, [active, fetchStatuses]);

  const configuredCount = statuses.filter(s => s.connected).length;

  const getStatus = (platformId: string): PlatformStatus | undefined => {
    return statuses.find(s => s.platform === platformId);
  };

  const isConfigured = (platformId: string): boolean => {
    return statuses.some(s => s.platform === platformId && s.connected);
  };

  // ── Expand / Collapse ───────────────────────────────────────────────────────

  const toggleExpand = (id: string, view: ExpandedView = 'status') => {
    if (expanded === id && expandedView === view) {
      setExpanded(null);
    } else {
      setExpanded(id);
      setExpandedView(isConfigured(id) ? view : 'configure');
      // Reset form
      setFormValues({});
      setShowSecrets(false);
      setSaving(false);
      setSaveResult(null);
      setTestStatus('idle');
      setTestResult('');
      setTestMsg('Hello from MindOS');
      setTestRecipient('');
    }
  };

  // ── Save Config ─────────────────────────────────────────────────────────────

  const handleSave = async (platformId: string) => {
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
        await fetchStatuses();
        // Switch to status view after successful save
        setTimeout(() => setExpandedView('status'), 800);
      } else {
        setSaveResult({ ok: false, msg: data.error || 'Failed' });
      }
    } catch (err) {
      setSaveResult({ ok: false, msg: err instanceof Error ? err.message : 'Network error' });
    }
    setSaving(false);
  };

  // ── Delete Config ───────────────────────────────────────────────────────────

  const handleDelete = async (platformId: string) => {
    if (confirmDelete !== platformId) {
      setConfirmDelete(platformId);
      return;
    }
    setDeleting(platformId);
    setConfirmDelete(null);
    try {
      const res = await fetch(`/api/im/config?platform=${platformId}`, { method: 'DELETE' });
      if (res.ok) {
        await fetchStatuses();
        setExpanded(null);
      }
    } catch { /* silent */ }
    setDeleting(null);
  };

  // ── Test Send ───────────────────────────────────────────────────────────────

  const handleTest = async (platformId: string) => {
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

  // ── Check if form is complete ───────────────────────────────────────────────

  const isFormComplete = (platform: PlatformDef): boolean => {
    return platform.fields.every(f => formValues[f.key]?.trim());
  };

  // ── Render ──────────────────────────────────────────────────────────────────

  return (
    <div className={`flex flex-col h-full ${active ? '' : 'hidden'}`}>
      <PanelHeader title={im.title} maximized={maximized} onMaximize={onMaximize}>
        <span className="text-xs text-muted-foreground">
          {!loading && configuredCount > 0 ? `${configuredCount} ${im.connected}` : ''}
        </span>
      </PanelHeader>

      <div className="flex-1 overflow-y-auto min-h-0">
        {loading ? (
          <div className="flex items-center justify-center h-32">
            <Loader2 size={20} className="animate-spin text-muted-foreground" />
          </div>
        ) : statuses.length === 0 ? (
          /* ── Empty State ── */
          <div className="flex flex-col items-center justify-center px-6 py-16 text-center">
            <div className="w-12 h-12 rounded-xl bg-muted flex items-center justify-center mb-4">
              <MessageSquare size={24} className="text-muted-foreground" />
            </div>
            <h3 className="text-sm font-medium text-foreground mb-1.5">{im.emptyTitle}</h3>
            <p className="text-xs text-muted-foreground leading-relaxed max-w-[240px] mb-5">
              {im.emptyDesc}
            </p>
            <button
              type="button"
              onClick={() => toggleExpand('telegram')}
              className="h-8 px-4 text-xs rounded-md bg-[var(--amber)] text-[var(--amber-foreground)] hover:opacity-90 transition-opacity duration-150"
            >
              {im.getStarted}
            </button>
          </div>
        ) : (
          <div className="flex flex-col gap-0.5 p-1.5">
            {PLATFORMS.map((platform) => {
              const status = getStatus(platform.id);
              const configured = isConfigured(platform.id);
              const isExpanded = expanded === platform.id;

              return (
                <div key={platform.id} className="rounded-md overflow-hidden">
                  {/* ── Row ── */}
                  <button
                    type="button"
                    onClick={() => toggleExpand(platform.id)}
                    className={`
                      w-full flex items-center gap-2.5 px-3 py-2 text-left rounded-md transition-colors cursor-pointer
                      ${isExpanded
                        ? 'bg-[var(--amber-dim)] text-foreground'
                        : 'hover:bg-muted text-foreground'
                      }
                    `}
                    aria-expanded={isExpanded}
                  >
                    <span className="w-3 shrink-0">
                      {isExpanded ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
                    </span>
                    <span className="text-sm">{platform.icon}</span>
                    <span className="text-sm flex-1 truncate">{platform.name}</span>

                    {configured ? (
                      <span className="w-2 h-2 rounded-full bg-success shrink-0" title={im.statusConnected} />
                    ) : (
                      <span className="text-2xs text-muted-foreground/60">{im.notConfigured}</span>
                    )}
                  </button>

                  {/* ── Expanded Panel ── */}
                  {isExpanded && (
                    <div className="px-3 pb-3 pt-1 ml-5 border-l-2 border-[var(--amber-dim)] animate-in fade-in-0 slide-in-from-top-1 duration-150">

                      {/* Tab switcher for configured platforms */}
                      {configured && (
                        <div className="flex gap-1 mb-3" role="tablist" aria-label={platform.name}>
                          <button
                            type="button"
                            onClick={() => setExpandedView('status')}
                            className={`text-2xs px-2 py-0.5 rounded transition-colors ${expandedView === 'status' ? 'bg-muted text-foreground' : 'text-muted-foreground hover:text-foreground'}`}
                          >
                            {im.tabStatus}
                          </button>
                          <button
                            type="button"
                            onClick={() => setExpandedView('configure')}
                            className={`text-2xs px-2 py-0.5 rounded transition-colors ${expandedView === 'configure' ? 'bg-muted text-foreground' : 'text-muted-foreground hover:text-foreground'}`}
                          >
                            {im.tabConfigure}
                          </button>
                        </div>
                      )}

                      {/* ── Status View ── */}
                      {configured && expandedView === 'status' && status && (
                        <div className="flex flex-col gap-3">
                          {/* Bot info */}
                          <div className="flex flex-col gap-1">
                            <div className="flex items-center gap-1.5">
                              <CheckCircle2 size={12} className="text-success" />
                              <span className="text-xs text-foreground">{im.statusConnected}</span>
                            </div>
                            {status.botName && (
                              <div className="flex items-center gap-1.5 ml-[18px]">
                                <span className="text-2xs text-muted-foreground">Bot:</span>
                                <span className="text-xs text-foreground font-mono">{status.botName}</span>
                              </div>
                            )}
                            {status.capabilities.length > 0 && (
                              <div className="flex flex-wrap gap-1 ml-[18px] mt-0.5">
                                {status.capabilities.map(cap => (
                                  <span key={cap} className="text-2xs px-1.5 py-0.5 rounded bg-muted text-muted-foreground">{cap}</span>
                                ))}
                              </div>
                            )}
                          </div>

                          {/* Test send */}
                          <div className="flex flex-col gap-2 pt-2 border-t border-border">
                            <span className="text-2xs text-muted-foreground uppercase tracking-wider">{im.testSend}</span>
                            <input
                              type="text"
                              placeholder={im.recipientPlaceholder}
                              value={testRecipient}
                              onChange={e => setTestRecipient(e.target.value)}
                              aria-label={im.recipientPlaceholder}
                              className="h-7 px-2 text-xs bg-background border border-border rounded-md focus:outline-none focus:ring-1 focus:ring-ring"
                            />
                            <form onSubmit={e => { e.preventDefault(); handleTest(platform.id); }} className="contents">
                            <input
                              type="text"
                              placeholder={im.messagePlaceholder}
                              value={testMsg}
                              onChange={e => setTestMsg(e.target.value)}
                              aria-label={im.messagePlaceholder}
                              className="h-7 px-2 text-xs bg-background border border-border rounded-md focus:outline-none focus:ring-1 focus:ring-ring"
                            />
                            <div className="flex items-center gap-2">
                              <button
                                type="button"
                                onClick={() => handleTest(platform.id)}
                                disabled={testStatus === 'sending' || !testRecipient.trim()}
                                className="h-7 px-3 text-xs rounded-md inline-flex items-center gap-1.5 bg-[var(--amber)] text-[var(--amber-foreground)] hover:opacity-90 disabled:opacity-50 disabled:cursor-not-allowed transition-opacity duration-150"
                              >
                                {testStatus === 'sending' ? <Loader2 size={12} className="animate-spin" /> : <Send size={12} />}
                                {im.sendTest}
                              </button>
                              <button
                                type="button"
                                onClick={() => handleDelete(platform.id)}
                                disabled={deleting === platform.id}
                                className={`h-7 px-2 text-xs rounded-md inline-flex items-center gap-1 border transition-colors ${
                                  confirmDelete === platform.id
                                    ? 'text-error border-error/40 bg-error/5'
                                    : 'text-muted-foreground hover:text-error border-transparent hover:border-error/30'
                                }`}
                                aria-label={im.disconnect}
                              >
                                {deleting === platform.id ? (
                                  <Loader2 size={12} className="animate-spin" />
                                ) : confirmDelete === platform.id ? (
                                  <><AlertTriangle size={12} /> {im.confirmDisconnect}</>
                                ) : (
                                  <Trash2 size={12} />
                                )}
                              </button>
                            </div>
                            </form>

                            {testResult && (
                              <div className={`flex items-start gap-1.5 text-xs ${testStatus === 'success' ? 'text-success' : 'text-error'}`}>
                                {testStatus === 'success' ? <CheckCircle2 size={14} className="shrink-0 mt-0.5" /> : <XCircle size={14} className="shrink-0 mt-0.5" />}
                                <span className="break-all">{testResult}</span>
                              </div>
                            )}
                          </div>
                        </div>
                      )}

                      {/* ── Configure View ── */}
                      {expandedView === 'configure' && (
                        <div className="flex flex-col gap-2.5">
                          {platform.fields.map(field => (
                            <div key={field.key} className="flex flex-col gap-1">
                              <label className="text-2xs text-muted-foreground uppercase tracking-wider">{field.label}</label>
                              <div className="relative">
                                <input
                                  type={showSecrets ? 'text' : 'password'}
                                  placeholder={field.placeholder}
                                  value={formValues[field.key] ?? ''}
                                  onChange={e => setFormValues(prev => ({ ...prev, [field.key]: e.target.value }))}
                                  className="h-7 w-full px-2 pr-7 text-xs font-mono bg-background border border-border rounded-md focus:outline-none focus:ring-1 focus:ring-ring"
                                  autoComplete="off"
                                />
                                <button
                                  type="button"
                                  onClick={() => setShowSecrets(!showSecrets)}
                                  className="absolute right-1 top-1/2 -translate-y-1/2 p-1 text-muted-foreground hover:text-foreground rounded-sm"
                                  aria-label={showSecrets ? im.hideSecret : im.showSecret}
                                >
                                  {showSecrets ? <EyeOff size={12} /> : <Eye size={12} />}
                                </button>
                              </div>
                              {field.hint && (
                                <span className="text-2xs text-muted-foreground/60">{field.hint}</span>
                              )}
                            </div>
                          ))}

                          <div className="flex items-center gap-2 pt-1">
                            <button
                              type="button"
                              onClick={() => handleSave(platform.id)}
                              disabled={saving || !isFormComplete(platform)}
                              className="h-7 px-3 text-xs rounded-md inline-flex items-center gap-1.5 bg-[var(--amber)] text-[var(--amber-foreground)] hover:opacity-90 disabled:opacity-50 disabled:cursor-not-allowed transition-opacity duration-150"
                            >
                              {saving ? <Loader2 size={12} className="animate-spin" /> : <Settings2 size={12} />}
                              {im.saveConfig}
                            </button>
                            {configured && (
                              <button
                                type="button"
                                onClick={() => setExpandedView('status')}
                                className="h-7 px-2 text-xs text-muted-foreground hover:text-foreground transition-colors"
                              >
                                {im.cancel}
                              </button>
                            )}
                          </div>

                          {saveResult && (
                            <div className={`flex items-start gap-1.5 text-xs ${saveResult.ok ? 'text-success' : 'text-error'}`}>
                              {saveResult.ok ? <CheckCircle2 size={14} className="shrink-0 mt-0.5" /> : <XCircle size={14} className="shrink-0 mt-0.5" />}
                              <span className="break-all">{saveResult.msg}</span>
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
