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

export function ObsidianCapabilityGatePanel({ plugin }: { plugin: ObsidianPluginStatus }) {
  const review = capabilityApprovalReview(plugin);
  const highRiskItems = review.items.filter((item) => item.risk === 'high risk').length;

  return (
    <div
      className="rounded-lg border border-border/50 bg-card/60 px-3 py-2.5 sm:col-span-2"
      data-obsidian-capability-approval-status={review.status}
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-2xs font-medium uppercase tracking-wider text-muted-foreground">Capability gate</p>
        <span className={`rounded border px-1.5 py-0.5 font-mono text-2xs ${capabilityGateStatusClass(review.status)}`}>
          {review.label}
        </span>
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
