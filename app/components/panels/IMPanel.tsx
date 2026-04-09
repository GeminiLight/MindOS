'use client';

import { useState, useEffect, useCallback } from 'react';
import { MessageSquare, Send, ChevronDown, ChevronRight, CheckCircle2, XCircle, Loader2 } from 'lucide-react';
import PanelHeader from './PanelHeader';
import { useLocale } from '@/lib/stores/locale-store';

// Platform metadata — icon + display name + docs URL
const PLATFORMS = [
  { id: 'telegram', name: 'Telegram', icon: '📱', docsHint: 'Talk to @BotFather' },
  { id: 'feishu', name: 'Feishu', icon: '🐦', docsHint: 'Open Platform → App' },
  { id: 'discord', name: 'Discord', icon: '💬', docsHint: 'Developer Portal → Bot' },
  { id: 'slack', name: 'Slack', icon: '💼', docsHint: 'api.slack.com → New App' },
  { id: 'wecom', name: 'WeCom', icon: '🏢', docsHint: 'Group Robot Webhook' },
  { id: 'dingtalk', name: 'DingTalk', icon: '🔔', docsHint: 'Open Platform → Robot' },
  { id: 'wechat', name: 'WeChat', icon: '💚', docsHint: 'iLink Bot → QR Scan' },
  { id: 'qq', name: 'QQ', icon: '🐧', docsHint: 'QQ Open Platform → Bot' },
] as const;

type PlatformStatus = {
  platform: string;
  connected: boolean;
  botName?: string;
  capabilities: string[];
};

interface IMPanelProps {
  active: boolean;
  maximized?: boolean;
  onMaximize?: () => void;
}

export default function IMPanel({ active, maximized, onMaximize }: IMPanelProps) {
  const { t } = useLocale();
  const im = t.panels.im;
  const [statuses, setStatuses] = useState<PlatformStatus[]>([]);
  const [loading, setLoading] = useState(true);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [testMsg, setTestMsg] = useState('');
  const [testRecipient, setTestRecipient] = useState('');
  const [testStatus, setTestStatus] = useState<'idle' | 'sending' | 'success' | 'error'>('idle');
  const [testResult, setTestResult] = useState('');

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

  const getStatus = (platformId: string) => {
    return statuses.find(s => s.platform === platformId);
  };

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
        setTestResult(data.messageId ? `Sent (ID: ${data.messageId})` : 'Sent successfully');
      } else {
        setTestStatus('error');
        setTestResult(data.error || 'Failed to send');
      }
    } catch (err) {
      setTestStatus('error');
      setTestResult(err instanceof Error ? err.message : 'Network error');
    }
  };

  const toggleExpand = (id: string) => {
    if (expanded === id) {
      setExpanded(null);
    } else {
      setExpanded(id);
      setTestStatus('idle');
      setTestResult('');
      setTestMsg('Hello from MindOS');
      setTestRecipient('');
    }
  };

  return (
    <div className={`flex flex-col h-full ${active ? '' : 'hidden'}`}>
      <PanelHeader title={im.title} maximized={maximized} onMaximize={onMaximize}>
        <span className="text-xs text-muted-foreground">
          {configuredCount > 0 ? `${configuredCount} connected` : ''}
        </span>
      </PanelHeader>

      <div className="flex-1 overflow-y-auto min-h-0">
        {loading ? (
          <div className="flex items-center justify-center h-32">
            <Loader2 size={20} className="animate-spin text-muted-foreground" />
          </div>
        ) : configuredCount === 0 && !loading ? (
          /* ── Empty State ── */
          <div className="flex flex-col items-center justify-center px-6 py-16 text-center">
            <div className="w-12 h-12 rounded-xl bg-muted flex items-center justify-center mb-4">
              <MessageSquare size={24} className="text-muted-foreground" />
            </div>
            <h3 className="text-sm font-medium text-foreground mb-1.5">{im.emptyTitle}</h3>
            <p className="text-xs text-muted-foreground leading-relaxed max-w-[240px] mb-4">
              {im.emptyDesc}
            </p>
            <p className="text-2xs text-muted-foreground/60 font-mono">
              ~/.mindos/im.json
            </p>
          </div>
        ) : (
          /* ── Platform List ── */
          <div className="flex flex-col gap-0.5 p-1.5">
            {PLATFORMS.map(({ id, name, icon }) => {
              const status = getStatus(id);
              const isConnected = status?.connected ?? false;
              const isExpanded = expanded === id;

              return (
                <div key={id} className="rounded-md overflow-hidden">
                  {/* Row */}
                  <button
                    type="button"
                    onClick={() => isConnected ? toggleExpand(id) : undefined}
                    className={`
                      w-full flex items-center gap-2.5 px-3 py-2 text-left rounded-md transition-colors
                      ${isExpanded
                        ? 'bg-[var(--amber-dim)] text-foreground'
                        : isConnected
                          ? 'hover:bg-muted text-foreground cursor-pointer'
                          : 'text-muted-foreground cursor-default'
                      }
                    `}
                    aria-expanded={isExpanded}
                    disabled={!isConnected}
                  >
                    {/* Expand arrow */}
                    <span className="w-3 shrink-0">
                      {isConnected && (isExpanded ? <ChevronDown size={12} /> : <ChevronRight size={12} />)}
                    </span>

                    {/* Platform icon + name */}
                    <span className="text-sm">{icon}</span>
                    <span className="text-sm flex-1 truncate">{name}</span>

                    {/* Status dot */}
                    {isConnected ? (
                      <span className="w-2 h-2 rounded-full bg-success shrink-0" title="Connected" />
                    ) : (
                      <span className="w-2 h-2 rounded-full bg-border shrink-0" title="Not configured" />
                    )}
                  </button>

                  {/* Expanded Details */}
                  {isExpanded && status && (
                    <div className="px-3 pb-3 pt-1 ml-[22px] border-l-2 border-[var(--amber-dim)]">
                      {/* Meta */}
                      <div className="flex flex-col gap-1 mb-3">
                        {status.botName && (
                          <div className="flex items-center gap-1.5">
                            <span className="text-2xs text-muted-foreground uppercase tracking-wider">Bot</span>
                            <span className="text-xs text-foreground font-mono">{status.botName}</span>
                          </div>
                        )}
                        {status.capabilities.length > 0 && (
                          <div className="flex flex-wrap gap-1 mt-0.5">
                            {status.capabilities.map(cap => (
                              <span key={cap} className="text-2xs px-1.5 py-0.5 rounded bg-muted text-muted-foreground">
                                {cap}
                              </span>
                            ))}
                          </div>
                        )}
                      </div>

                      {/* Test Send */}
                      <div className="flex flex-col gap-2">
                        <span className="text-2xs text-muted-foreground uppercase tracking-wider">{im.testSend}</span>
                        <input
                          type="text"
                          placeholder={im.recipientPlaceholder}
                          value={testRecipient}
                          onChange={e => setTestRecipient(e.target.value)}
                          className="h-7 px-2 text-xs bg-background border border-border rounded-md focus:outline-none focus:ring-1 focus:ring-ring"
                        />
                        <input
                          type="text"
                          placeholder={im.messagePlaceholder}
                          value={testMsg}
                          onChange={e => setTestMsg(e.target.value)}
                          className="h-7 px-2 text-xs bg-background border border-border rounded-md focus:outline-none focus:ring-1 focus:ring-ring"
                        />
                        <button
                          type="button"
                          onClick={() => handleTest(id)}
                          disabled={testStatus === 'sending' || !testRecipient.trim()}
                          className="
                            h-7 px-3 text-xs rounded-md inline-flex items-center gap-1.5 self-start
                            bg-[var(--amber)] text-[var(--amber-foreground)]
                            hover:brightness-110 disabled:opacity-50 disabled:cursor-not-allowed
                            transition-all duration-150
                          "
                        >
                          {testStatus === 'sending' ? (
                            <Loader2 size={12} className="animate-spin" />
                          ) : (
                            <Send size={12} />
                          )}
                          {im.sendTest}
                        </button>

                        {/* Result */}
                        {testResult && (
                          <div className={`flex items-start gap-1.5 text-xs ${testStatus === 'success' ? 'text-success' : 'text-error'}`}>
                            {testStatus === 'success' ? <CheckCircle2 size={14} className="shrink-0 mt-0.5" /> : <XCircle size={14} className="shrink-0 mt-0.5" />}
                            <span className="break-all">{testResult}</span>
                          </div>
                        )}
                      </div>
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
