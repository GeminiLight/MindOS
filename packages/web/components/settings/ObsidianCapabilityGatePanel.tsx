import {
  ShieldOff,
} from 'lucide-react';
import {
  capabilityApprovalReview,
  type CapabilityApprovalReviewStatus,
  type ObsidianPluginStatus,
} from './ObsidianPluginHostModel';

function capabilityGateStatusClass(status: CapabilityApprovalReviewStatus): string {
  if (status === 'blocked' || status === 'policy-denied') {
    return 'border-[var(--error)]/30 bg-[color-mix(in_srgb,var(--error)_12%,transparent)] text-[var(--error)]';
  }
  if (status === 'needs-review') return 'border-[var(--amber)]/25 bg-[var(--amber-subtle)] text-[var(--amber-text)]';
  if (status === 'confirmed' || status === 'ready') {
    return 'border-success/30 bg-[color-mix(in_srgb,var(--success)_12%,transparent)] text-success';
  }
  return 'border-border bg-muted/60 text-muted-foreground';
}

export function capabilityGateEnableMessage(plugin: ObsidianPluginStatus): string {
  const review = capabilityApprovalReview(plugin);
  const reasons = plugin.capabilityGate?.confirmReasons.slice(0, 4) ?? [];
  const surfaceText = review.pendingSurfaces.length > 0
    ? ` Requested surfaces: ${review.pendingSurfaces.join(', ')}.`
    : '';
  const deniedText = review.deniedEvents > 0
    ? ` MindOS has ${review.deniedEvents} denied runtime policy event${review.deniedEvents === 1 ? '' : 's'} for this plugin; review the denied evidence before enabling.`
    : '';
  const reasonText = reasons.length > 0 ? ` ${reasons.join(' ')}` : '';
  return `${plugin.name} uses Obsidian compatibility capabilities that can touch local data, secrets, metadata, or external services.${surfaceText}${reasonText}${deniedText} MindOS will persist this confirmation for the current detected capability fingerprint and ask again if the plugin capability profile changes.`;
}

export function capabilityGateRevokeMessage(plugin: ObsidianPluginStatus): string {
  return `MindOS will clear the current capability approval for ${plugin.name}, unload and disable the plugin if it is active, and require approval again before gated Obsidian compatibility capabilities can be enabled. Runtime denial history is kept for audit.`;
}

export function ObsidianCapabilityGatePanel({
  plugin,
  busy = false,
  onRevokeApproval,
}: {
  plugin: ObsidianPluginStatus;
  busy?: boolean;
  onRevokeApproval?: () => void;
}) {
  const review = capabilityApprovalReview(plugin);
  const highRiskItems = review.items.filter((item) => item.risk === 'high risk').length;
  const evidencePreview = review.evidence.slice(0, 5);

  return (
    <div
      className="rounded-lg border border-border/50 bg-card/60 px-3 py-2.5 sm:col-span-2"
      data-obsidian-capability-approval-status={review.status}
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-2xs font-medium uppercase tracking-wider text-muted-foreground">Capability gate</p>
        <div className="flex flex-wrap items-center gap-1.5">
          <span className={`rounded border px-1.5 py-0.5 font-mono text-2xs ${capabilityGateStatusClass(review.status)}`}>
            {review.label}
          </span>
          {review.approved && onRevokeApproval && (
            <button
              type="button"
              onClick={onRevokeApproval}
              disabled={busy}
              className="inline-flex items-center gap-1 rounded border border-border bg-background px-1.5 py-0.5 text-2xs text-muted-foreground transition-colors hover:border-[var(--amber)]/40 hover:bg-[var(--amber-subtle)] hover:text-[var(--amber-text)] disabled:cursor-not-allowed disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              title="Revoke the current capability approval"
            >
              <ShieldOff size={10} />
              Revoke approval
            </button>
          )}
        </div>
      </div>
      <p className="mt-1 text-2xs text-muted-foreground">{review.summary}</p>
      <p className="mt-1 line-clamp-2 text-2xs text-muted-foreground/70">{review.nextStep}</p>
      <p className="mt-1 font-mono text-2xs text-muted-foreground">
        {review.fingerprint ? `fingerprint ${review.fingerprint}` : 'No gate fingerprint available'}
        {review.confirmedAt ? ` · confirmed ${review.confirmedAt}` : ''}
      </p>

      {(review.pendingSurfaces.length > 0 || review.deniedEvents > 0 || review.blockedEvents > 0 || highRiskItems > 0) && (
        <div className="mt-2 flex flex-wrap gap-1.5">
          {review.pendingSurfaces.map((surface) => (
            <span key={surface} className="rounded border border-border bg-background px-1.5 py-0.5 font-mono text-2xs text-muted-foreground">
              {surface}
            </span>
          ))}
          {highRiskItems > 0 && (
            <span className="rounded border border-[var(--amber)]/25 bg-[var(--amber-subtle)] px-1.5 py-0.5 font-mono text-2xs text-[var(--amber-text)]">
              {highRiskItems} high risk
            </span>
          )}
          {review.deniedEvents > 0 && (
            <span className="rounded border border-[var(--error)]/30 bg-[color-mix(in_srgb,var(--error)_12%,transparent)] px-1.5 py-0.5 font-mono text-2xs text-[var(--error)]">
              {review.deniedEvents} denied event{review.deniedEvents === 1 ? '' : 's'}
            </span>
          )}
          {review.blockedEvents > 0 && (
            <span className="rounded border border-[var(--error)]/30 bg-[color-mix(in_srgb,var(--error)_12%,transparent)] px-1.5 py-0.5 font-mono text-2xs text-[var(--error)]">
              {review.blockedEvents} blocked event{review.blockedEvents === 1 ? '' : 's'}
            </span>
          )}
        </div>
      )}

      {evidencePreview.length > 0 && (
        <div className="mt-2 border-t border-border/60 pt-2">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="text-2xs font-medium uppercase tracking-wider text-muted-foreground">Runtime evidence</p>
            <span className="font-mono text-2xs text-muted-foreground">
              {review.evidence.length} event{review.evidence.length === 1 ? '' : 's'}
            </span>
          </div>
          <div className="mt-1 divide-y divide-border/60">
            {evidencePreview.map((event, index) => (
              <div key={`${event.source}:${event.phase}:${event.capability}:${event.recordedAt ?? index}`} className="py-1.5">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="font-mono text-2xs text-muted-foreground">
                    {event.label} · {event.capability}
                  </span>
                  <span className={`rounded border px-1.5 py-0.5 font-mono text-2xs ${capabilityGateStatusClass(event.phase === 'blocked' ? 'blocked' : 'policy-denied')}`}>
                    {event.phase}
                  </span>
                </div>
                <p className="mt-1 line-clamp-2 text-2xs text-muted-foreground">
                  {event.evidence}
                </p>
                <p className="mt-1 font-mono text-2xs text-muted-foreground/70">
                  {event.sourceLabel}{event.recordedAt ? ` · ${event.recordedAt}` : ''}
                </p>
              </div>
            ))}
            {review.evidence.length > evidencePreview.length && (
              <p className="pt-1.5 font-mono text-2xs text-muted-foreground/70">
                +{review.evidence.length - evidencePreview.length} more runtime event{review.evidence.length - evidencePreview.length === 1 ? '' : 's'}
              </p>
            )}
          </div>
        </div>
      )}

      {review.items.length > 0 && (
        <div className="mt-2 divide-y divide-border/60 border-t border-border/60">
          {review.items.slice(0, 4).map((item) => (
            <div key={`${item.surface}:${item.decision}`} className="py-2">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="text-2xs font-medium text-foreground">{item.label}</span>
                <span className="font-mono text-2xs text-muted-foreground">
                  {item.decision} · {item.risk}
                </span>
              </div>
              <p className="mt-1 font-mono text-2xs text-muted-foreground/70">
                {item.apiCount} API{item.apiCount === 1 ? '' : 's'} · {item.support || 'no support summary'} · {item.apisPreview || 'no API preview'}
              </p>
              <p className="mt-1 line-clamp-2 text-2xs text-muted-foreground">
                {item.reason}
              </p>
            </div>
          ))}
          {review.items.length > 4 && (
            <p className="pt-2 font-mono text-2xs text-muted-foreground/70">
              +{review.items.length - 4} more surface{review.items.length - 4 === 1 ? '' : 's'}
            </p>
          )}
        </div>
      )}
    </div>
  );
}
