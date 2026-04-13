'use client';

import { useState } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { CheckCircle2, XCircle, Inbox, Send, ChevronDown, ChevronRight, MessageSquare, Reply } from 'lucide-react';
import type { IMActivity } from '@/lib/im/types';
import { SectionCard, formatRelativeTime, formatActivityType, parseMessageSummary } from './shared';
import { maskForLog } from '@/lib/im/format';

function ActivityIcon({ type, status }: { type: IMActivity['type']; status: IMActivity['status'] }) {
  if (status === 'failed') return <XCircle size={14} className="text-error" />;
  if (type === 'conversation_inbound') return <MessageSquare size={14} className="text-[var(--amber)]" />;
  if (type === 'conversation_reply') return <Reply size={14} className="text-success" />;
  return <CheckCircle2 size={14} className="text-success" />;
}

function ActivityItem({ activity, im, locale }: {
  activity: IMActivity;
  im: Record<string, any>;
  locale: string;
}) {
  const [expanded, setExpanded] = useState(false);
  const [showThinking, setShowThinking] = useState(false);
  const { body, thinking } = parseMessageSummary(activity.messageSummary);
  const hasBodyContent = body.length > 0;
  const summaryLine = hasBodyContent ? body : (thinking ? `(${im.showThinking ?? 'Thinking'}...)` : activity.messageSummary);

  return (
    <div className="rounded-md border border-border/50 overflow-hidden">
      {/* Collapsed row — always clickable */}
      <button
        type="button"
        onClick={() => setExpanded(e => !e)}
        className="w-full flex items-start gap-3 px-3 py-2.5 text-left hover:bg-muted/30 transition-colors"
        aria-expanded={expanded}
      >
        <span className="mt-0.5 shrink-0">
          <ActivityIcon type={activity.type} status={activity.status} />
        </span>
        <div className="flex-1 min-w-0">
          <p className="text-sm text-foreground truncate">
            {hasBodyContent ? summaryLine : (
              <span className="italic text-muted-foreground">{summaryLine}</span>
            )}
          </p>
          <div className="flex flex-wrap items-center gap-x-3 gap-y-0.5 text-[11px] text-muted-foreground mt-0.5">
            <span className="font-medium">{formatActivityType(activity.type, {
              test: im.activityTypeTest,
              agent: im.activityTypeAgent,
              manual: im.activityTypeManual,
              inbound: im.activityTypeInbound,
              reply: im.activityTypeReply,
            })}</span>
            <span className="font-mono">{maskForLog(activity.recipient)}</span>
            {activity.error && <span className="text-error">{activity.error}</span>}
          </div>
        </div>
        <div className="flex items-center gap-1.5 shrink-0 mt-0.5">
          <span className="text-[11px] text-muted-foreground">
            {locale === 'zh' ? new Date(activity.timestamp).toLocaleString('zh-CN') : formatRelativeTime(activity.timestamp)}
          </span>
          <ChevronRight size={12} className={`text-muted-foreground/40 transition-transform duration-150 ${expanded ? 'rotate-90' : ''}`} />
        </div>
      </button>

      {/* Expanded content */}
      {expanded && (
        <div className="border-t border-border/50 px-4 py-3 bg-muted/10">
          {hasBodyContent && (
            <div className="prose prose-sm max-w-none text-foreground [&_p]:my-1 [&_ul]:my-1 [&_ol]:my-1 [&_li]:my-0 [&_pre]:my-2 [&_code]:text-xs [&_pre]:bg-muted/50 [&_pre]:rounded [&_pre]:px-3 [&_pre]:py-2 [&_h1]:text-base [&_h2]:text-sm [&_h3]:text-sm [&_a]:text-[var(--amber)] break-words">
              <ReactMarkdown remarkPlugins={[remarkGfm]}>
                {body}
              </ReactMarkdown>
            </div>
          )}

          {thinking && (
            <div className={hasBodyContent ? 'mt-3 pt-3 border-t border-border/30' : ''}>
              <button
                type="button"
                onClick={() => setShowThinking(t => !t)}
                className="inline-flex items-center gap-1 text-[11px] text-muted-foreground/60 hover:text-muted-foreground transition-colors"
              >
                <ChevronDown size={10} className={`transition-transform ${showThinking ? 'rotate-180' : ''}`} />
                {showThinking ? (im.hideThinking ?? 'Hide thinking') : (im.showThinking ?? 'Show thinking')}
              </button>
              {showThinking && (
                <div className="mt-2 prose prose-sm max-w-none text-muted-foreground/70 [&_p]:my-1 [&_ul]:my-1 [&_ol]:my-1 [&_li]:my-0 [&_pre]:my-2 [&_code]:text-xs [&_pre]:bg-muted/30 [&_pre]:rounded [&_pre]:px-3 [&_pre]:py-2 break-words max-h-48 overflow-y-auto">
                  <ReactMarkdown remarkPlugins={[remarkGfm]}>
                    {thinking}
                  </ReactMarkdown>
                </div>
              )}
            </div>
          )}

          {!hasBodyContent && !thinking && (
            <p className="text-sm text-muted-foreground italic">{activity.messageSummary}</p>
          )}
        </div>
      )}
    </div>
  );
}

export function ChannelActivityFeed({ activities, im, locale, onScrollToTest }: {
  activities: IMActivity[];
  im: Record<string, any>;
  locale: string;
  onScrollToTest?: () => void;
}) {
  return (
    <SectionCard title={im.recentActivity} icon={<Inbox size={15} className="text-muted-foreground" />}>
      {activities.length === 0 ? (
        <div className="text-center py-6">
          <Inbox size={20} className="mx-auto mb-2 text-muted-foreground/50" />
          <p className="text-sm text-foreground mb-0.5">{im.noActivityYet}</p>
          <p className="text-xs text-muted-foreground mb-3 max-w-[280px] mx-auto">{im.noActivityHint}</p>
          {onScrollToTest && (
            <button
              type="button"
              onClick={onScrollToTest}
              className="inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs bg-[var(--amber-dim)] text-[var(--amber)] hover:bg-[var(--amber-dim)]/80 transition-colors"
            >
              <Send size={12} />
              {im.sendSample}
            </button>
          )}
        </div>
      ) : (
        <div className="space-y-2">
          {activities.map(activity => (
            <ActivityItem key={activity.id} activity={activity} im={im} locale={locale} />
          ))}
        </div>
      )}
    </SectionCard>
  );
}
