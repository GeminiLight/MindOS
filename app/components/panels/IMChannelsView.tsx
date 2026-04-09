'use client';

import { useState, useEffect, useCallback } from 'react';
import {
  Send, ChevronDown, ChevronRight, CheckCircle2, XCircle,
  Loader2, Trash2, Eye, EyeOff, Settings2, AlertTriangle, RefreshCw, AlertCircle,
} from 'lucide-react';
import { useLocale } from '@/lib/stores/locale-store';

// ─── Platform Definitions ─────────────────────────────────────────────────────

interface PlatformDef {
  id: string;
  name: string;
  icon: string;
  fields: { key: string; label: string; placeholder: string; hint?: string }[];
  guide?: string; // Brief setup steps shown above the form
}

const PLATFORMS: PlatformDef[] = [
  {
    id: 'telegram', name: 'Telegram', icon: '📱',
    guide: '1. Open Telegram → search @BotFather\n2. Send /newbot → follow prompts\n3. Copy the token below',
    fields: [
      { key: 'bot_token', label: 'Bot Token', placeholder: '123456789:AABBccDD-EeFfGgHh...', hint: 'Format: number:alphanumeric' },
    ],
  },
  {
    id: 'feishu', name: 'Feishu', icon: '🐦',
    guide: '1. open.feishu.cn → Create App\n2. Credentials page → copy App ID & Secret\n3. Enable Bot capability + add permissions',
    fields: [
      { key: 'app_id', label: 'App ID', placeholder: 'cli_a5xxxxxxxxxxxxx' },
      { key: 'app_secret', label: 'App Secret', placeholder: 'xxxxxxxxxxxxxxxxxxxxxxxx' },
    ],
  },
  {
    id: 'discord', name: 'Discord', icon: '💬',
    guide: '1. discord.com/developers → New Application\n2. Bot tab → Reset Token → copy\n3. Enable Message Content Intent',
    fields: [
      { key: 'bot_token', label: 'Bot Token', placeholder: 'MTIxNzM...' },
    ],
  },
  {
    id: 'slack', name: 'Slack', icon: '💼',
    guide: '1. api.slack.com/apps → Create New App\n2. OAuth & Permissions → add chat:write scope\n3. Install to Workspace → copy Bot Token',
    fields: [
      { key: 'bot_token', label: 'Bot Token', placeholder: 'xoxb-xxxx-xxxx-xxxx', hint: 'Starts with xoxb-' },
    ],
  },
  {
    id: 'wecom', name: 'WeCom', icon: '🏢',
    guide: '1. Group chat → Add Robot → Custom\n2. Copy Webhook URL\n3. Extract the key parameter from URL',
    fields: [
      { key: 'webhook_key', label: 'Webhook Key', placeholder: 'xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx', hint: 'The key= value from webhook URL' },
    ],
  },
  {
    id: 'dingtalk', name: 'DingTalk', icon: '🔔',
    guide: '1. Group → Settings → Smart Assistant → Add Robot\n2. Select Custom (Webhook)\n3. Copy the full Webhook URL',
    fields: [
      { key: 'webhook_url', label: 'Webhook URL', placeholder: 'https://oapi.dingtalk.com/robot/send?access_token=...', hint: 'Full URL including access_token' },
    ],
  },
  {
    id: 'wechat', name: 'WeChat', icon: '💚',
    guide: '1. Visit ilinkai.weixin.qq.com\n2. Register & create a bot application\n3. QR login in the console → copy Bot Token from dashboard',
    fields: [
      { key: 'bot_token', label: 'Bot Token', placeholder: 'wx_xxxxxxxxxxxxxxxx', hint: 'From iLink Bot console after QR login' },
    ],
  },
  {
    id: 'qq', name: 'QQ', icon: '🐧',
    guide: '1. q.qq.com → Create Bot\n2. Development tab → copy App ID & Secret\n3. Add group/C2C intents as needed',
    fields: [
      { key: 'app_id', label: 'App ID', placeholder: '102xxxxxx' },
      { key: 'app_secret', label: 'App Secret', placeholder: 'xxxxxxxxxxxxxxxxxxxxxxxx' },
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

// ─── Component ────────────────────────────────────────────────────────────────

/** Headless IM channel list — used inside AgentsPanel and standalone IMPanel. */
export default function IMChannelsView() {
  const { t } = useLocale();
  const im = t.panels.im;

  const [statuses, setStatuses] = useState<PlatformStatus[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [expandedView, setExpandedView] = useState<ExpandedView>('status');

  const [formValues, setFormValues] = useState<Record<string, string>>({});
  const [showSecrets, setShowSecrets] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saveResult, setSaveResult] = useState<{ ok: boolean; msg: string } | null>(null);

  const [testRecipient, setTestRecipient] = useState('');
  const [testMsg, setTestMsg] = useState('');
  const [testStatus, setTestStatus] = useState<'idle' | 'sending' | 'success' | 'error'>('idle');
  const [testResult, setTestResult] = useState('');

  const [deleting, setDeleting] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);

  const fetchStatuses = useCallback(async () => {
    setError(false);
    try {
      const res = await fetch('/api/im/status');
      if (res.ok) {
        const data = await res.json();
        setStatuses(data.platforms ?? []);
      } else {
        setError(true);
      }
    } catch {
      setError(true);
    }
    setLoading(false);
  }, []);

  useEffect(() => { fetchStatuses(); }, [fetchStatuses]);

  const isConfigured = (pid: string) => statuses.some(s => s.platform === pid && s.connected);
  const getStatus = (pid: string) => statuses.find(s => s.platform === pid);

  const toggleExpand = (id: string) => {
    if (expanded === id) {
      setExpanded(null);
    } else {
      setExpanded(id);
      setExpandedView(isConfigured(id) ? 'status' : 'configure');
      setFormValues({});
      setShowSecrets(false);
      setSaving(false);
      setSaveResult(null);
      setTestStatus('idle');
      setTestResult('');
      setTestMsg('Hello from MindOS');
      setTestRecipient('');
      setConfirmDelete(null);
    }
  };

  const handleSave = async (pid: string) => {
    setSaving(true);
    setSaveResult(null);
    try {
      const res = await fetch('/api/im/config', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ platform: pid, credentials: formValues }),
      });
      const data = await res.json();
      if (data.ok) {
        setSaveResult({ ok: true, msg: im.saved });
        await fetchStatuses();
        setTimeout(() => setExpandedView('status'), 800);
      } else {
        setSaveResult({ ok: false, msg: data.error || 'Failed' });
      }
    } catch (err) {
      setSaveResult({ ok: false, msg: err instanceof Error ? err.message : 'Network error' });
    }
    setSaving(false);
  };

  const handleDelete = async (pid: string) => {
    if (confirmDelete !== pid) { setConfirmDelete(pid); return; }
    setDeleting(pid);
    setConfirmDelete(null);
    try {
      const res = await fetch(`/api/im/config?platform=${pid}`, { method: 'DELETE' });
      if (res.ok) { await fetchStatuses(); setExpanded(null); }
    } catch { /* silent */ }
    setDeleting(null);
  };

  const handleTest = async (pid: string) => {
    if (!testRecipient.trim() || !testMsg.trim()) return;
    setTestStatus('sending');
    setTestResult('');
    try {
      const res = await fetch('/api/im/test', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ platform: pid, recipient_id: testRecipient, message: testMsg }),
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

  const isFormComplete = (p: PlatformDef) => p.fields.every(f => formValues[f.key]?.trim());

  if (loading) {
    return (
      <div className="flex justify-center py-8">
        <Loader2 size={16} className="animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex flex-col items-center gap-2 py-8 px-3">
        <AlertCircle size={16} className="text-muted-foreground" />
        <p className="text-2xs text-muted-foreground">{im.fetchError}</p>
        <button
          type="button"
          onClick={() => { setLoading(true); fetchStatuses(); }}
          className="inline-flex items-center gap-1 text-2xs text-muted-foreground hover:text-foreground transition-colors"
        >
          <RefreshCw size={11} /> {im.retry}
        </button>
      </div>
    );
  }

  const configuredCount = statuses.filter(s => s.connected).length;

  return (
    <div className="flex flex-col p-1.5">
      {/* Section header */}
      <div className="flex items-center gap-2 px-3 py-1.5 mb-1">
        <span className="text-2xs font-medium text-muted-foreground uppercase tracking-wider">{im.title}</span>
        {configuredCount > 0 && (
          <span className="text-2xs text-muted-foreground/60">{configuredCount} {im.connected}</span>
        )}
      </div>

      <div className="flex flex-col gap-0.5">
        {PLATFORMS.map((platform) => {
          const status = getStatus(platform.id);
          const configured = isConfigured(platform.id);
          const isExp = expanded === platform.id;

          return (
            <div key={platform.id} className="rounded-md overflow-hidden">
              <button
                type="button"
                onClick={() => toggleExpand(platform.id)}
                className={`
                  w-full flex items-center gap-2.5 px-3 py-2 text-left rounded-md transition-colors cursor-pointer
                  ${isExp ? 'bg-[var(--amber-dim)] text-foreground' : 'hover:bg-muted text-foreground'}
                `}
                aria-expanded={isExp}
              >
                <span className="w-3 shrink-0">
                  {isExp ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
                </span>
                <span className="text-sm">{platform.icon}</span>
                <span className="text-sm flex-1 truncate">{platform.name}</span>
                {configured ? (
                  <span className="w-2 h-2 rounded-full bg-success shrink-0" title={im.statusConnected} />
                ) : (
                  <span className="text-2xs text-muted-foreground/60">{im.notConfigured}</span>
                )}
              </button>

              {isExp && (
                <div className="px-3 pb-3 pt-1 ml-5 border-l-2 border-[var(--amber-dim)] animate-in fade-in-0 slide-in-from-top-1 duration-150">
                  {/* Tab switcher */}
                  {configured && (
                    <div className="flex gap-1 mb-3" role="tablist" aria-label={platform.name}>
                      <button type="button" onClick={() => setExpandedView('status')}
                        className={`text-2xs px-2 py-0.5 rounded transition-colors ${expandedView === 'status' ? 'bg-muted text-foreground' : 'text-muted-foreground hover:text-foreground'}`}
                      >{im.tabStatus}</button>
                      <button type="button" onClick={() => setExpandedView('configure')}
                        className={`text-2xs px-2 py-0.5 rounded transition-colors ${expandedView === 'configure' ? 'bg-muted text-foreground' : 'text-muted-foreground hover:text-foreground'}`}
                      >{im.tabConfigure}</button>
                    </div>
                  )}

                  {/* Status view */}
                  {configured && expandedView === 'status' && status && (
                    <div className="flex flex-col gap-3">
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

                      <div className="flex flex-col gap-2 pt-2 border-t border-border">
                        <span className="text-2xs text-muted-foreground uppercase tracking-wider">{im.testSend}</span>
                        <input type="text" placeholder={im.recipientPlaceholder} value={testRecipient}
                          onChange={e => setTestRecipient(e.target.value)} aria-label={im.recipientPlaceholder}
                          className="h-7 px-2 text-xs bg-background border border-border rounded-md focus:outline-none focus:ring-1 focus:ring-ring" />
                        <form onSubmit={e => { e.preventDefault(); handleTest(platform.id); }} className="contents">
                          <input type="text" placeholder={im.messagePlaceholder} value={testMsg}
                            onChange={e => setTestMsg(e.target.value)} aria-label={im.messagePlaceholder}
                            className="h-7 px-2 text-xs bg-background border border-border rounded-md focus:outline-none focus:ring-1 focus:ring-ring" />
                          <div className="flex items-center gap-2">
                            <button type="submit" disabled={testStatus === 'sending' || !testRecipient.trim()}
                              className="h-7 px-3 text-xs rounded-md inline-flex items-center gap-1.5 bg-[var(--amber)] text-[var(--amber-foreground)] hover:opacity-90 disabled:opacity-50 disabled:cursor-not-allowed transition-opacity duration-150">
                              {testStatus === 'sending' ? <Loader2 size={12} className="animate-spin" /> : <Send size={12} />}
                              {im.sendTest}
                            </button>
                            <button type="button" onClick={() => handleDelete(platform.id)} disabled={deleting === platform.id}
                              className={`h-7 px-2 text-xs rounded-md inline-flex items-center gap-1 border transition-colors ${
                                confirmDelete === platform.id ? 'text-error border-error/40 bg-error/5' : 'text-muted-foreground hover:text-error border-transparent hover:border-error/30'
                              }`} aria-label={im.disconnect}>
                              {deleting === platform.id ? <Loader2 size={12} className="animate-spin" />
                                : confirmDelete === platform.id ? <><AlertTriangle size={12} /> {im.confirmDisconnect}</>
                                : <Trash2 size={12} />}
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

                  {/* Configure view */}
                  {expandedView === 'configure' && (
                    <div className="flex flex-col gap-2.5">
                      {platform.guide && (
                        <div className="text-2xs text-muted-foreground leading-relaxed whitespace-pre-line bg-muted/30 rounded-md px-2.5 py-2 mb-0.5">
                          {platform.guide}
                        </div>
                      )}
                      {platform.fields.map(field => (
                        <div key={field.key} className="flex flex-col gap-1">
                          <label className="text-2xs text-muted-foreground uppercase tracking-wider">{field.label}</label>
                          <div className="relative">
                            <input type={showSecrets ? 'text' : 'password'} placeholder={field.placeholder}
                              value={formValues[field.key] ?? ''}
                              onChange={e => setFormValues(prev => ({ ...prev, [field.key]: e.target.value }))}
                              className="h-7 w-full px-2 pr-7 text-xs font-mono bg-background border border-border rounded-md focus:outline-none focus:ring-1 focus:ring-ring"
                              autoComplete="off" />
                            <button type="button" onClick={() => setShowSecrets(!showSecrets)}
                              className="absolute right-1 top-1/2 -translate-y-1/2 p-1 text-muted-foreground hover:text-foreground rounded-sm"
                              aria-label={showSecrets ? im.hideSecret : im.showSecret}>
                              {showSecrets ? <EyeOff size={12} /> : <Eye size={12} />}
                            </button>
                          </div>
                          {field.hint && <span className="text-2xs text-muted-foreground/60">{field.hint}</span>}
                        </div>
                      ))}
                      <div className="flex items-center gap-2 pt-1">
                        <button type="button" onClick={() => handleSave(platform.id)}
                          disabled={saving || !isFormComplete(platform)}
                          className="h-7 px-3 text-xs rounded-md inline-flex items-center gap-1.5 bg-[var(--amber)] text-[var(--amber-foreground)] hover:opacity-90 disabled:opacity-50 disabled:cursor-not-allowed transition-opacity duration-150">
                          {saving ? <Loader2 size={12} className="animate-spin" /> : <Settings2 size={12} />}
                          {im.saveConfig}
                        </button>
                        {configured && (
                          <button type="button" onClick={() => setExpandedView('status')}
                            className="h-7 px-2 text-xs text-muted-foreground hover:text-foreground transition-colors">
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
    </div>
  );
}
