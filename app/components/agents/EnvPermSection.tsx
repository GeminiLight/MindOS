'use client';

import { Key, Shield, ShieldCheck } from 'lucide-react';
import { useLocale } from '@/lib/stores/locale-store';
import type { AgentInfo } from '../settings/types';
import { DetailLine } from './agent-detail-primitives';

export default function EnvPermSection({
  agent,
  isMindOS,
}: {
  agent: AgentInfo;
  isMindOS: boolean;
}) {
  const { t } = useLocale();
  const d = t.agentsContent.detail;

  const scope = agent.scope ?? (agent.hasProjectScope ? 'project' : agent.hasGlobalScope ? 'global' : '—');
  const hasHiddenRoot = agent.hiddenRootPresent ?? false;

  const permissions = [
    { label: d.envFileAccess, allowed: true },
    { label: d.envNetworkAccess, allowed: agent.transport === 'http' || isMindOS },
    { label: d.envWriteAccess, allowed: true },
    { label: d.envReadOnly, allowed: false },
  ];

  return (
    <section className="rounded-xl border border-border bg-card p-4 space-y-3">
      <h2 className="text-xs font-semibold text-foreground flex items-center gap-2 shrink-0">
        <div className="w-6 h-6 rounded-md bg-[var(--amber-subtle)] flex items-center justify-center"><Key size={13} className="text-[var(--amber)]" /></div>
        {d.envPermTitle}
      </h2>

      <div className="flex flex-wrap gap-x-6 gap-y-1 py-2 border-y border-border/30">
        <DetailLine label={d.envScope} value={scope} />
        <DetailLine label={d.format} value={agent.format} />
        {agent.hiddenRootPath && (
          <DetailLine label={d.hiddenRoot} value={agent.hiddenRootPath} />
        )}
        <DetailLine label={d.skillMode} value={agent.skillMode ?? '—'} />
      </div>

      <div className="space-y-1">
        <p className="text-2xs font-medium text-muted-foreground/60 uppercase tracking-wider mb-1.5">
          {d.envVars}
        </p>
        {agent.configuredMcpServers && agent.configuredMcpServers.length > 0 ? (
          <p className="text-2xs text-muted-foreground">{d.envVarsCount(agent.configuredMcpServers.length)}</p>
        ) : (
          <p className="text-2xs text-muted-foreground/50">{d.envVarsEmpty}</p>
        )}
      </div>

      <div className="space-y-1.5">
        <p className="text-2xs font-medium text-muted-foreground/60 uppercase tracking-wider">
          Permissions
        </p>
        <div className="flex flex-wrap gap-2">
          {permissions.map((perm) => (
            <div
              key={perm.label}
              className={`inline-flex items-center gap-1 px-2 py-0.5 text-2xs rounded-md border ${perm.allowed
                ? 'text-[var(--success)] bg-[var(--success)]/5 border-[var(--success)]/20'
                : 'text-muted-foreground/40 bg-muted/5 border-border/30 line-through'
                }`}
            >
              {perm.allowed ? <ShieldCheck size={10} /> : <Shield size={10} />}
              {perm.label}
            </div>
          ))}
        </div>
      </div>

      {hasHiddenRoot && (
        <p className="text-2xs text-muted-foreground/50 border-t border-border/20 pt-2">
          Hidden root directory is active for this agent.
        </p>
      )}
    </section>
  );
}
