import type { IMActivity } from '@/lib/im/types';

export function formatRelativeTime(timestamp?: string, fallback?: string) {
  if (!timestamp) return fallback ?? '--';
  const value = new Date(timestamp).getTime();
  if (Number.isNaN(value)) return fallback ?? timestamp;

  const diffMs = Date.now() - value;
  const diffMin = Math.floor(diffMs / 60000);
  if (diffMin < 1) return 'just now';
  if (diffMin < 60) return `${diffMin} min ago`;
  const diffHours = Math.floor(diffMin / 60);
  if (diffHours < 24) return `${diffHours} hr ago`;
  const diffDays = Math.floor(diffHours / 24);
  if (diffDays < 7) return `${diffDays} day${diffDays > 1 ? 's' : ''} ago`;
  return new Date(timestamp).toLocaleString();
}

export function formatActivityType(
  type: IMActivity['type'],
  labels: { test: string; agent: string; manual: string; inbound?: string; reply?: string },
) {
  switch (type) {
    case 'test': return labels.test;
    case 'agent': return labels.agent;
    case 'conversation_inbound': return labels.inbound ?? 'Inbound';
    case 'conversation_reply': return labels.reply ?? 'Reply';
    default: return labels.manual;
  }
}

/** Extract thinking content and clean body for display. */
export function parseMessageSummary(text: string): { body: string; thinking: string | null } {
  const thinkingMatch = text.match(/<thinking>([\s\S]*?)(<\/thinking>|$)/i);
  const thinking = thinkingMatch ? thinkingMatch[1].trim() : null;
  const body = text
    .replace(/<thinking>[\s\S]*?<\/thinking>/gi, '')
    .replace(/<thinking>[\s\S]*/gi, '')
    .trim();
  return { body, thinking };
}

export function SectionCard({ title, children, icon, className }: {
  title: string;
  children: React.ReactNode;
  icon?: React.ReactNode;
  className?: string;
}) {
  return (
    <section className={`rounded-lg border border-border bg-card p-5 shadow-sm ${className ?? ''}`}>
      <div className="flex items-center gap-2 mb-4">
        {icon}
        <h3 className="text-sm font-semibold text-foreground tracking-tight">{title}</h3>
      </div>
      {children}
    </section>
  );
}

export function StatusDot({ ok, size = 8 }: { ok: boolean; size?: number }) {
  return (
    <span
      className={`inline-block rounded-full shrink-0 ${ok ? 'bg-success' : 'bg-muted-foreground/40'}`}
      style={{ width: size, height: size }}
      aria-hidden="true"
    />
  );
}

export function ActionResult({ result }: { result: { ok: boolean; msg: string } | null }) {
  if (!result) return null;
  return (
    <div role="alert" aria-live="polite" className={`flex items-start gap-2 text-sm ${result.ok ? 'text-success' : 'text-error'}`}>
      <span className="shrink-0 mt-0.5">{result.ok ? '✓' : '✗'}</span>
      <span className="break-all">{result.msg}</span>
    </div>
  );
}

export function SkeletonBlock({ className }: { className: string }) {
  return <div className={`rounded bg-muted animate-pulse ${className}`} />;
}
