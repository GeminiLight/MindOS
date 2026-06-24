import type { ObsidianPluginStatus } from './ObsidianPluginHostModel';

function capabilityGateStatusLabel(plugin: ObsidianPluginStatus): string {
  const gate = plugin.capabilityGate;
  if (!gate) return 'Not evaluated';
  if (gate.blocked) return 'Blocked';
  if (gate.requiresConfirmation && !gate.confirmed) return 'Review before enable';
  if (gate.requiresConfirmation && gate.confirmed) return 'Confirmed';
  if (gate.status === 'limited') return 'Limited host';
  return 'Ready';
}

function capabilityGateStatusClass(plugin: ObsidianPluginStatus): string {
  const gate = plugin.capabilityGate;
  if (!gate) return 'border-border bg-muted/60 text-muted-foreground';
  if (gate.blocked) return 'border-[var(--error)]/30 bg-[color-mix(in_srgb,var(--error)_12%,transparent)] text-[var(--error)]';
  if (gate.requiresConfirmation && !gate.confirmed) return 'border-[var(--amber)]/25 bg-[var(--amber-subtle)] text-[var(--amber-text)]';
  if (gate.requiresConfirmation && gate.confirmed) return 'border-success/30 bg-[color-mix(in_srgb,var(--success)_12%,transparent)] text-success';
  if (gate.status === 'limited') return 'border-border bg-muted/60 text-muted-foreground';
  return 'border-success/30 bg-[color-mix(in_srgb,var(--success)_12%,transparent)] text-success';
}

export function capabilityGateEnableMessage(plugin: ObsidianPluginStatus): string {
  const reasons = plugin.capabilityGate?.confirmReasons.slice(0, 4) ?? [];
  const reasonText = reasons.length > 0 ? ` ${reasons.join(' ')}` : '';
  return `${plugin.name} uses Obsidian compatibility capabilities that can touch local data, secrets, metadata, or external services.${reasonText} MindOS will persist this confirmation for the current detected capability fingerprint and ask again if the plugin capability profile changes.`;
}

export function ObsidianCapabilityGatePanel({ plugin }: { plugin: ObsidianPluginStatus }) {
  return (
    <div className="rounded-lg border border-border/50 bg-card/60 px-3 py-2.5 sm:col-span-2">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-2xs font-medium uppercase tracking-wider text-muted-foreground">Capability gate</p>
        <span className={`rounded border px-1.5 py-0.5 font-mono text-2xs ${capabilityGateStatusClass(plugin)}`}>
          {capabilityGateStatusLabel(plugin)}
        </span>
      </div>
      <p className="mt-1 font-mono text-2xs text-muted-foreground">
        {plugin.capabilityGate?.fingerprint ? `fingerprint ${plugin.capabilityGate.fingerprint}` : 'No gate fingerprint available'}
        {plugin.capabilityGate?.confirmedAt ? ` · confirmed ${plugin.capabilityGate.confirmedAt}` : ''}
      </p>
      {(plugin.capabilityGate?.confirmReasons.length ?? 0) > 0 && (
        <div className="mt-2 space-y-1">
          {plugin.capabilityGate?.confirmReasons.slice(0, 3).map((reason) => (
            <p key={reason} className="text-2xs text-muted-foreground">{reason}</p>
          ))}
        </div>
      )}
      {(plugin.capabilityGate?.blockedReasons.length ?? 0) > 0 && (
        <div className="mt-2 space-y-1">
          {plugin.capabilityGate?.blockedReasons.slice(0, 3).map((reason) => (
            <p key={reason} className="text-2xs text-[var(--error)]">{reason}</p>
          ))}
        </div>
      )}
    </div>
  );
}
