import {
  AlertTriangle,
  ExternalLink,
  FileText,
  ListChecks,
  Loader2,
  Play,
  Search,
  SlidersHorizontal,
} from 'lucide-react';
import type { ObsidianCapabilitySupport } from '@/lib/obsidian-compat/capability-matrix';
import { hasObsidianNativeQueryPreview } from '@/lib/obsidian-compat/native-query-preview';
import type { PluginEditorCommandContext } from '@/lib/plugins/client';
import {
  ObsidianCapabilityGatePanel,
} from './ObsidianCapabilityGatePanel';
import {
  compatibilityEvidenceStatusClass,
  compatibilityPostureStatusClass,
  type ObsidianCompatibilityPosture,
} from './ObsidianCompatibilityPostureModel';
import {
  capabilityLedgerHistorySummary,
  capabilityLedgerSummary,
  runtimeSummary,
  surfacePolicyAudit,
  workflowAuditStatusClass,
  workflowAuditStatusLabel,
  workflowAuditProbeSummary,
  type ObsidianNativeQueryPreviewResponse,
  type ObsidianPluginSettings,
  type ObsidianPluginStatus,
  type PluginLifecycleAction,
  type SettingAction,
  type SurfaceLedgerProjectionView,
  type SurfacePolicyAuditItem,
  type SurfaceRoute,
  type SurfaceRouteState,
  type SurfaceRouteTarget,
} from './ObsidianPluginHostModel';
import type { ObsidianDeclarativeSettingPreview } from './ObsidianPluginHostModel';
import {
  DeclarativeSettingsCatalog,
  SettingControl,
  hasInteractiveDeclarativeItems,
  type DeclarativeActionTarget,
  type DeclarativeListMutationTarget,
  type DeclarativePreviewTarget,
} from './ObsidianPluginHostSettingsControls';

const CAPABILITY_SUPPORT_ORDER: ObsidianCapabilitySupport[] = [
  'full',
  'limited',
  'snapshot-only',
  'catalog-only',
  'request-only',
  'unsupported',
];

const CAPABILITY_SUPPORT_LABEL: Record<ObsidianCapabilitySupport, string> = {
  full: 'full',
  limited: 'limited',
  'snapshot-only': 'snapshot',
  'catalog-only': 'catalog',
  'request-only': 'request',
  unsupported: 'unsupported',
};

interface ObsidianPluginHostDetailsProps {
  plugin: ObsidianPluginStatus;
  posture: ObsidianCompatibilityPosture;
  busyKey: string | null;
  settingsBusyKey: string | null;
  settingsErrors: Record<string, string>;
  settingsByPlugin: Record<string, ObsidianPluginSettings>;
  declarativePreviews: Record<string, ObsidianDeclarativeSettingPreview>;
  nativeQueryPreview?: ObsidianNativeQueryPreviewResponse;
  nativeQueryBusyKey: string | null;
  nativeQueryErrors: Record<string, string>;
  pluginEditorContext: PluginEditorCommandContext | null;
  surfaceRoutes: SurfaceRoute[];
  surfaceLedgerChecks: SurfaceLedgerProjectionView[];
  onOpenRoute: (target: SurfaceRouteTarget) => void;
  onRequestRevokeApproval: (plugin: ObsidianPluginStatus) => void;
  onRunAction: (
    action: PluginLifecycleAction,
    options?: {
      pluginId?: string;
      commandId?: string;
      probeId?: string;
      editorContext?: PluginEditorCommandContext;
      confirmCapabilityGate?: boolean;
    },
  ) => void;
  onLoadSettings: (pluginId: string) => void;
  onRunSettingAction: (
    pluginId: string,
    tabIndex: number,
    itemIndex: number,
    action: SettingAction,
    value?: unknown,
  ) => void;
  onRunDeclarativeSettingAction: (
    pluginId: string,
    tabIndex: number,
    path: number[],
    value: unknown,
  ) => void;
  onRunDeclarativeAction: (target: DeclarativeActionTarget) => void;
  onRunDeclarativeListMutation: (target: DeclarativeListMutationTarget) => void;
  onPreviewDeclarative: (target: DeclarativePreviewTarget) => void;
  onLoadNativeQueryPreview: (pluginId: string) => void;
}

export function ObsidianPluginHostDetails({
  plugin,
  posture,
  busyKey,
  settingsBusyKey,
  settingsErrors,
  settingsByPlugin,
  declarativePreviews,
  nativeQueryPreview,
  nativeQueryBusyKey,
  nativeQueryErrors,
  pluginEditorContext,
  surfaceRoutes,
  surfaceLedgerChecks,
  onOpenRoute,
  onRequestRevokeApproval,
  onRunAction,
  onLoadSettings,
  onRunSettingAction,
  onRunDeclarativeSettingAction,
  onRunDeclarativeAction,
  onRunDeclarativeListMutation,
  onPreviewDeclarative,
  onLoadNativeQueryPreview,
}: ObsidianPluginHostDetailsProps) {
  const settings = settingsByPlugin[plugin.id];
  const policyAudit = surfacePolicyAudit(plugin, { excludeSurfaces: ['core'] });
  const policyAuditItems = policyAudit.items;
  const nativeQueryAvailable = hasObsidianNativeQueryPreview(plugin);
  const nativeQueryBusy = nativeQueryBusyKey === `native-query:${plugin.id}`;
  const nativeQueryError = nativeQueryErrors[plugin.id];

  return (
    <div className="mt-3 ml-6 space-y-3 rounded-lg border border-border/60 bg-background/60 p-3">
      <div className="text-xs text-muted-foreground">{runtimeSummary(plugin)}</div>

      <div className="grid gap-2 sm:grid-cols-2">
        <div className="rounded-lg border border-border/50 bg-card/60 px-3 py-2.5">
          <p className="text-2xs font-medium uppercase tracking-wider text-muted-foreground">Package</p>
          <div className="mt-1 flex flex-wrap items-center gap-1.5">
            <span className={`rounded border px-1.5 py-0.5 font-mono text-2xs ${
              plugin.packageLocation?.legacy
                ? 'border-[var(--amber)]/25 bg-[var(--amber-subtle)] text-[var(--amber-text)]'
                : 'border-success/30 bg-[color-mix(in_srgb,var(--success)_12%,transparent)] text-success'
            }`}
            >
              {packageLocationLabel(plugin)}
            </span>
            {plugin.packageLocation?.migrationAvailable && (
              <span className="rounded border border-border bg-background px-1.5 py-0.5 font-mono text-2xs text-muted-foreground">
                migration available
              </span>
            )}
          </div>
          <p className="mt-1 truncate font-mono text-2xs text-muted-foreground">
            {plugin.packageLocation?.relativePath ?? '(unknown path)'}
          </p>
        </div>
        <div className="rounded-lg border border-border/50 bg-card/60 px-3 py-2.5">
          <p className="text-2xs font-medium uppercase tracking-wider text-muted-foreground">Compatibility coverage</p>
          <p className="mt-1 font-mono text-2xs text-muted-foreground">
            {compactCoverageSummary(plugin.coverageSummary)}
          </p>
          <p className="mt-1 text-2xs text-muted-foreground/70">
            {plugin.coverage?.length ?? 0} detected API surface{(plugin.coverage?.length ?? 0) === 1 ? '' : 's'}
          </p>
        </div>
        <div className="rounded-lg border border-border/50 bg-card/60 px-3 py-2.5">
          <p className="text-2xs font-medium uppercase tracking-wider text-muted-foreground">Capability ledger</p>
          <p className="mt-1 font-mono text-2xs text-muted-foreground">
            {capabilityLedgerSummary(plugin)}
          </p>
          <p className="mt-1 text-2xs text-muted-foreground/70">
            {plugin.runtime.capabilityLedger?.length ?? 0} actual runtime event{(plugin.runtime.capabilityLedger?.length ?? 0) === 1 ? '' : 's'}
          </p>
          <p className="mt-1 font-mono text-2xs text-muted-foreground/70">
            {capabilityLedgerHistorySummary(plugin)}
          </p>
        </div>
        <ObsidianCapabilityGatePanel
          plugin={plugin}
          busy={busyKey !== null}
          onRevokeApproval={() => onRequestRevokeApproval(plugin)}
        />
      </div>

      <div className="rounded-lg border border-border/50 bg-card/60 px-3 py-2.5">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="text-2xs font-medium uppercase tracking-wider text-muted-foreground">Compatibility posture</p>
          <span className={`rounded border px-1.5 py-0.5 font-mono text-2xs ${compatibilityPostureStatusClass(posture.status)}`}>
            {posture.label}
          </span>
        </div>
        <p className="mt-1 text-2xs text-muted-foreground">
          {posture.summary}
        </p>
        <div className="mt-2 grid gap-1.5 sm:grid-cols-3">
          {posture.evidence.map((step) => (
            <div key={step.layer} className="rounded-md border border-border bg-background px-2.5 py-2">
              <div className="flex items-center justify-between gap-2">
                <span className="text-2xs font-medium text-foreground">{step.label}</span>
                <span className={`rounded border px-1.5 py-0.5 font-mono text-2xs ${compatibilityEvidenceStatusClass(step.status)}`}>
                  {step.statusLabel}
                </span>
              </div>
              <p className="mt-1 line-clamp-2 text-2xs text-muted-foreground">
                {step.summary}
              </p>
            </div>
          ))}
        </div>
        <p className="mt-2 line-clamp-2 text-2xs text-muted-foreground/70">
          {posture.nextStep}
        </p>
      </div>

      {(plugin.workflowAudits?.length ?? 0) > 0 && (
        <div className="rounded-lg border border-border/50 bg-card/60 px-3 py-2.5">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="text-2xs font-medium uppercase tracking-wider text-muted-foreground">Workflow audit</p>
            <span className="font-mono text-2xs text-muted-foreground">
              {plugin.workflowAudits?.length ?? 0} workflow{(plugin.workflowAudits?.length ?? 0) === 1 ? '' : 's'}
            </span>
          </div>
          <div className="mt-2 grid gap-2">
            {(plugin.workflowAudits ?? []).map((audit) => (
              <div key={audit.id} className="rounded-md border border-border bg-background px-2.5 py-2">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="text-xs font-medium text-foreground">{audit.label}</span>
                  <div className="flex flex-wrap items-center gap-1.5">
                    <span className={`rounded border px-1.5 py-0.5 font-mono text-2xs ${workflowAuditStatusClass(audit.status)}`}>
                      {workflowAuditStatusLabel(audit.status)}
                    </span>
                    {audit.source === 'workflow-probe' && (
                      <span className="rounded border border-border/70 bg-muted/40 px-1.5 py-0.5 font-mono text-2xs text-muted-foreground">
                        probed
                      </span>
                    )}
                    <button
                      type="button"
                      onClick={() => onRunAction('run-workflow-probe', { pluginId: plugin.id, probeId: audit.id })}
                      disabled={!plugin.loaded || busyKey !== null}
                      className="inline-flex items-center gap-1 rounded border border-border bg-card px-1.5 py-0.5 text-2xs text-foreground transition-colors hover:bg-muted/60 disabled:cursor-not-allowed disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                      title={plugin.loaded ? `Run workflow probe: ${audit.label}` : 'Load the plugin before running workflow probes'}
                    >
                      {busyKey === `run-workflow-probe:${audit.id}` ? <Loader2 size={10} className="animate-spin" /> : <Play size={10} />}
                      Probe
                    </button>
                  </div>
                </div>
                {workflowAuditProbeSummary(audit) && (
                  <p className="mt-1 font-mono text-2xs text-muted-foreground/70">
                    {workflowAuditProbeSummary(audit)}
                  </p>
                )}
                {audit.evidence[0] && (
                  <p className="mt-1 line-clamp-2 text-2xs text-muted-foreground">
                    {audit.evidence[0]}
                  </p>
                )}
                {audit.probeFailureReason && (
                  <p className="mt-1 line-clamp-2 text-2xs text-error">
                    {audit.probeFailureReason}
                  </p>
                )}
                {audit.nextStep && (
                  <p className="mt-1 line-clamp-2 text-2xs text-muted-foreground/70">
                    {audit.nextStep}
                  </p>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {nativeQueryAvailable && (
        <div
          className="rounded-lg border border-border/50 bg-card/60 px-3 py-2.5"
          data-obsidian-native-query-preview={plugin.id}
        >
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-1.5">
                <p className="text-2xs font-medium uppercase tracking-wider text-muted-foreground">Native query preview</p>
                <span className="rounded border border-border bg-background px-1.5 py-0.5 font-mono text-2xs text-muted-foreground">
                  read-only
                </span>
              </div>
              <p className="mt-1 line-clamp-1 text-2xs text-muted-foreground/70">
                MindOS native index, not official plugin runtime.
              </p>
            </div>
            <button
              type="button"
              onClick={() => onLoadNativeQueryPreview(plugin.id)}
              disabled={nativeQueryBusyKey !== null}
              className="inline-flex items-center gap-1.5 rounded-lg border border-border bg-background px-2.5 py-1.5 text-xs text-foreground transition-colors hover:bg-muted/60 disabled:cursor-not-allowed disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              title="Preview MindOS native query index"
            >
              {nativeQueryBusy ? <Loader2 size={11} className="animate-spin" /> : <Search size={11} />}
              Preview
            </button>
          </div>

          {nativeQueryError && (
            <div className="mt-2 flex items-start gap-2 rounded-lg border border-error/30 bg-[color-mix(in_srgb,var(--error)_10%,transparent)] px-3 py-2 text-xs text-error">
              <AlertTriangle size={12} className="mt-0.5 shrink-0" />
              <span>{nativeQueryError}</span>
            </div>
          )}

          {nativeQueryPreview && (
            <div className="mt-2 space-y-2">
              <div className="grid gap-1.5 sm:grid-cols-4">
                <NativeQueryStat label="notes" value={nativeQueryPreview.stats.noteCount} />
                <NativeQueryStat label="tasks" value={nativeQueryPreview.stats.taskCount} />
                <NativeQueryStat label="open" value={nativeQueryPreview.stats.incompleteTaskCount} />
                <NativeQueryStat label="done" value={nativeQueryPreview.stats.completedTaskCount} />
              </div>

              <div className="grid gap-2 lg:grid-cols-2">
                <div className="min-w-0 rounded-md border border-border bg-background px-2.5 py-2">
                  <div className="flex items-center gap-1.5 text-2xs font-medium uppercase tracking-wider text-muted-foreground">
                    <FileText size={11} />
                    Notes
                  </div>
                  <div className="mt-1.5 space-y-1.5">
                    {nativeQueryPreview.notes.length > 0 ? nativeQueryPreview.notes.map((note) => (
                      <div key={note.path} className="min-w-0">
                        <p className="truncate font-mono text-2xs text-foreground">{note.path}</p>
                        <p className="mt-0.5 truncate text-2xs text-muted-foreground">
                          {nativeQueryNoteSummary(note)}
                        </p>
                      </div>
                    )) : (
                      <p className="text-2xs text-muted-foreground">No public Markdown notes indexed.</p>
                    )}
                  </div>
                </div>

                <div className="min-w-0 rounded-md border border-border bg-background px-2.5 py-2">
                  <div className="flex items-center gap-1.5 text-2xs font-medium uppercase tracking-wider text-muted-foreground">
                    <ListChecks size={11} />
                    Open tasks
                  </div>
                  <div className="mt-1.5 space-y-1.5">
                    {nativeQueryPreview.tasks.length > 0 ? nativeQueryPreview.tasks.map((task) => (
                      <div key={`${task.path}:${task.line}`} className="min-w-0">
                        <p className="line-clamp-1 text-2xs text-foreground">{task.text}</p>
                        <p className="mt-0.5 truncate font-mono text-2xs text-muted-foreground">
                          {task.path}:{task.line + 1}{task.effectiveTags.length > 0 ? ` · ${task.effectiveTags.join(' ')}` : ''}
                        </p>
                      </div>
                    )) : (
                      <p className="text-2xs text-muted-foreground">No open task sample.</p>
                    )}
                  </div>
                </div>
              </div>

              <p className="line-clamp-2 text-2xs text-muted-foreground/70">
                {nativeQueryPreview.proof.limitations[0]}
              </p>
            </div>
          )}
        </div>
      )}

      {policyAuditItems.length > 0 && (
        <div className="rounded-lg border border-border/50 bg-card/60 px-3 py-2.5">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="text-2xs font-medium uppercase tracking-wider text-muted-foreground">Surface policy audit</p>
            <span className="rounded border border-border bg-background px-1.5 py-0.5 font-mono text-2xs text-muted-foreground">
              {policyAudit.summary}
            </span>
          </div>
          <p className="mt-1 text-2xs text-muted-foreground">
            {policyAudit.boundary}
          </p>
          <div className="mt-2 grid gap-1.5 sm:grid-cols-2">
            {policyAuditItems.slice(0, 6).map((item) => (
              <SurfacePolicyAuditCard key={item.surface} item={item} />
            ))}
          </div>
          {policyAuditItems.length > 6 && (
            <p className="mt-1 text-2xs text-muted-foreground/70">
              {policyAuditItems.length - 6} more surface policy decision{policyAuditItems.length - 6 === 1 ? '' : 's'} hidden.
            </p>
          )}
        </div>
      )}

      {surfaceLedgerChecks.length > 0 && (
        <div className="rounded-lg border border-border/50 bg-card/60 px-3 py-2.5">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="text-2xs font-medium uppercase tracking-wider text-muted-foreground">Detected MindOS surfaces</p>
            <span className="font-mono text-2xs text-muted-foreground">
              {surfaceLedgerChecks.length} surface{surfaceLedgerChecks.length === 1 ? '' : 's'}
            </span>
          </div>
          <div className="mt-2 flex flex-wrap gap-1.5">
            {surfaceLedgerChecks.map((summary) => (
              <span
                key={summary.surface}
                className="inline-flex max-w-full items-center gap-1.5 rounded-md border border-border bg-background px-2 py-1 font-mono text-2xs text-muted-foreground"
                title={`${summary.apiPreview}${summary.routes.length ? ` | ${summary.routes.join(', ')}` : ''} | ${summary.projection.nextStep}`}
              >
                <span className="text-foreground">{summary.label}</span>
                <span>{summary.apiCount}</span>
                <span className="text-muted-foreground/70">{summary.support}</span>
                <span className={`rounded border px-1 py-0.5 ${surfaceLedgerProjectionStatusClass(summary.projection.status)}`}>
                  {surfaceLedgerProjectionStatusLabel(summary.projection.status)}
                </span>
                <span className="text-muted-foreground/70">{surfaceLedgerCountSummary(summary)}</span>
              </span>
            ))}
          </div>
        </div>
      )}

      {surfaceRoutes.length > 0 && (
        <div className="space-y-2">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="text-2xs font-medium uppercase tracking-wider text-muted-foreground">Where it appears</p>
            <p className="text-2xs text-muted-foreground/70">Manage here; use from the mounted host.</p>
          </div>
          <div className="grid gap-2 sm:grid-cols-2">
            {surfaceRoutes.map((route) => (
              <SurfaceRouteCard
                key={`${route.label}:${route.value}`}
                route={route}
                onOpenRoute={onOpenRoute}
              />
            ))}
          </div>
        </div>
      )}

      {plugin.runtime.warnings.length > 0 && (
        <div className="space-y-1">
          {plugin.runtime.warnings.map((warning) => (
            <div key={warning} className="flex items-start gap-2 text-xs text-[var(--amber-text)]">
              <AlertTriangle size={12} className="mt-0.5 shrink-0" />
              <span>{warning}</span>
            </div>
          ))}
        </div>
      )}

      {plugin.runtime.commandList.length > 0 && (
        <div className="space-y-1.5">
          <p className="text-2xs font-medium uppercase tracking-wider text-muted-foreground">Commands</p>
          <div className="flex flex-wrap gap-1.5">
            {plugin.runtime.commandList.map((command) => {
              const commandKey = `execute-command:${command.fullId}`;
              const hasEditorContext = Boolean(pluginEditorContext);
              const executable = command.executable !== false || (command.requiresEditor && hasEditorContext);
              const commandTitle = executable
                ? plugin.loaded ? command.requiresEditor && hasEditorContext ? `Run ${command.name} against the current Markdown file` : `Run ${command.name}` : 'Load the plugin before running commands'
                : command.availabilityReason ?? (command.requiresEditor ? 'Requires an active editor host' : 'Command is recorded but not currently executable');
              return (
                <button
                  key={command.fullId}
                  type="button"
                  onClick={() => {
                    if (executable) {
                      onRunAction('execute-command', {
                        commandId: command.fullId,
                        ...(pluginEditorContext ? { editorContext: pluginEditorContext } : {}),
                      });
                    }
                  }}
                  disabled={!executable || !plugin.loaded || busyKey !== null}
                  className="inline-flex items-center gap-1.5 rounded-lg border border-border bg-card px-2.5 py-1.5 text-xs text-foreground transition-colors hover:bg-muted/60 disabled:cursor-not-allowed disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  title={commandTitle}
                >
                  {busyKey === commandKey ? <Loader2 size={11} className="animate-spin" /> : <Play size={11} />}
                  {command.name}
                  {!executable && (
                    <span className="rounded border border-border/70 bg-muted/50 px-1 text-2xs text-muted-foreground">
                      {command.requiresEditor ? 'Editor' : 'Recorded'}
                    </span>
                  )}
                </button>
              );
            })}
          </div>
        </div>
      )}

      <div className="space-y-2 border-t border-border/50 pt-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="text-2xs font-medium uppercase tracking-wider text-muted-foreground">Settings</p>
          <button
            type="button"
            onClick={() => onLoadSettings(plugin.id)}
            disabled={!plugin.enabled || settingsBusyKey !== null}
            className="inline-flex items-center gap-1.5 rounded-lg border border-border bg-card px-2.5 py-1.5 text-xs text-foreground transition-colors hover:bg-muted/60 disabled:cursor-not-allowed disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            title={plugin.enabled ? 'Load plugin settings' : 'Enable the plugin before loading settings'}
          >
            {settingsBusyKey === `settings:${plugin.id}` ? <Loader2 size={11} className="animate-spin" /> : <SlidersHorizontal size={11} />}
            Load settings
          </button>
        </div>

        {settingsErrors[plugin.id] && (
          <div className="flex items-start gap-2 rounded-lg border border-[var(--error)]/30 bg-[var(--error)]/10 px-3 py-2 text-xs text-[var(--error)]">
            <AlertTriangle size={12} className="mt-0.5 shrink-0" />
            <span>{settingsErrors[plugin.id]}</span>
          </div>
        )}

        {settings?.settingTabs.map((tab, tabIndex) => (
          <div key={`${plugin.id}-tab-${tabIndex}`} className="space-y-2 rounded-lg border border-border/50 bg-card/50 p-2.5">
            {tab.error && (
              <div className="flex items-start gap-2 text-xs text-[var(--error)]">
                <AlertTriangle size={12} className="mt-0.5 shrink-0" />
                <span>{tab.error}</span>
              </div>
            )}
            {tab.items.length === 0 ? (
              <p className="text-xs text-muted-foreground">This tab did not expose configurable items.</p>
            ) : (
              tab.items.map((item, itemIndex) => {
                const itemBusy = settingsBusyKey === `settings:${plugin.id}:${tabIndex}:${itemIndex}`;
                return (
                  <div key={`${plugin.id}-setting-${tabIndex}-${itemIndex}`} className="flex flex-col gap-2 rounded-lg bg-background/60 px-3 py-2 sm:flex-row sm:items-center sm:justify-between">
                    <div className="min-w-0">
                      <p className="text-xs font-medium text-foreground">{item.name ?? item.kind ?? 'Setting'}</p>
                      {item.desc && <p className="mt-0.5 text-2xs text-muted-foreground">{item.desc}</p>}
                      {!item.canChange && !item.canClick && (
                        <p className="mt-1 text-2xs text-muted-foreground/70">Read-only in the limited runtime.</p>
                      )}
                    </div>
                    <SettingControl
                      item={item}
                      busy={itemBusy}
                      onAction={(settingAction, value) => onRunSettingAction(plugin.id, tabIndex, itemIndex, settingAction, value)}
                    />
                  </div>
                );
              })
            )}
          </div>
        ))}

        {(settings?.declarativeSettingTabs?.length ?? 0) > 0 && (
          <div className="space-y-2 rounded-lg border border-border/50 bg-card/50 p-2.5">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <p className="text-2xs font-medium uppercase tracking-wider text-muted-foreground">Declarative settings</p>
              <span className="rounded border border-border/70 bg-muted/50 px-1.5 py-0.5 text-2xs text-muted-foreground">
                {hasInteractiveDeclarativeItems(settings?.declarativeSettingTabs?.flatMap((tab) => tab.items) ?? [])
                  ? 'limited host'
                  : 'catalog-only'}
              </span>
            </div>
            {settings?.declarativeSettingTabs?.map((tab, tabIndex) => (
              <div key={`${plugin.id}-declarative-tab-${tabIndex}`} className="space-y-2">
                {tab.error && (
                  <div className="flex items-start gap-2 text-xs text-[var(--error)]">
                    <AlertTriangle size={12} className="mt-0.5 shrink-0" />
                    <span>{tab.error}</span>
                  </div>
                )}
                <DeclarativeSettingsCatalog
                  items={tab.items}
                  pluginId={plugin.id}
                  pluginName={plugin.name}
                  tabIndex={tabIndex}
                  settingsBusyKey={settingsBusyKey}
                  previews={declarativePreviews}
                  onChange={onRunDeclarativeSettingAction}
                  onRunAction={onRunDeclarativeAction}
                  onRunListMutation={onRunDeclarativeListMutation}
                  onPreview={onPreviewDeclarative}
                />
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function NativeQueryStat({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-md border border-border bg-background px-2.5 py-1.5">
      <p className="font-mono text-xs text-foreground">{value}</p>
      <p className="text-2xs text-muted-foreground">{label}</p>
    </div>
  );
}

function nativeQueryNoteSummary(note: ObsidianNativeQueryPreviewResponse['notes'][number]): string {
  const frontmatter = Object.entries(note.frontmatter)
    .map(([key, value]) => `${key}:${String(value)}`)
    .join(' ');
  const tags = note.tags.join(' ');
  const counts = `${note.taskCount} tasks · ${note.linkCount} links · ${note.headingCount} headings`;
  return [frontmatter, tags, counts].filter(Boolean).join(' · ');
}

function SurfacePolicyAuditCard({ item }: { item: SurfacePolicyAuditItem }) {
  return (
    <div
      className="min-w-0 rounded-md border border-border bg-background px-2.5 py-2"
      title={`${item.permissionBoundary} | ${item.nextStep}`}
    >
      <div className="flex min-w-0 flex-wrap items-center gap-1.5">
        <span className="text-2xs font-medium text-foreground">{item.label}</span>
        <span className={`rounded border px-1.5 py-0.5 font-mono text-2xs ${surfacePolicyActionClass(item.action)}`}>
          {item.actionLabel}
        </span>
        <span className="rounded border border-border/70 bg-muted/50 px-1.5 py-0.5 font-mono text-2xs text-muted-foreground">
          {item.risk}
        </span>
      </div>
      <p className="mt-1 line-clamp-1 font-mono text-2xs text-muted-foreground/70">
        {item.apiPreview || `${item.apiCount} API${item.apiCount === 1 ? '' : 's'}`} · {item.runtimeDefault}
      </p>
      {item.requiredEvidencePreview && (
        <p className="mt-1 line-clamp-2 text-2xs text-muted-foreground">
          Evidence: {item.requiredEvidencePreview}
        </p>
      )}
    </div>
  );
}

function compactCoverageSummary(summary: Partial<Record<ObsidianCapabilitySupport, number>> | undefined): string {
  const parts = CAPABILITY_SUPPORT_ORDER
    .map((support) => {
      const count = summary?.[support] ?? 0;
      return count > 0 ? `${count} ${CAPABILITY_SUPPORT_LABEL[support]}` : '';
    })
    .filter(Boolean);
  return parts.length > 0 ? parts.join(' / ') : 'No Obsidian API usage detected';
}

function packageLocationLabel(plugin: ObsidianPluginStatus): string {
  if (!plugin.packageLocation) return 'Package path unavailable';
  return plugin.packageLocation.legacy ? 'Legacy package' : 'Canonical package';
}

function surfaceRouteStateLabel(state: SurfaceRouteState): string {
  if (state === 'mounted') return 'Mounted';
  if (state === 'catalog') return 'Catalog';
  return 'Recorded';
}

function surfaceRouteStateClass(state: SurfaceRouteState): string {
  if (state === 'mounted') {
    return 'border-success/30 bg-[color-mix(in_srgb,var(--success)_12%,transparent)] text-success';
  }
  if (state === 'catalog') {
    return 'border-[var(--amber)]/25 bg-[var(--amber-subtle)] text-[var(--amber-text)]';
  }
  return 'border-border bg-muted/60 text-muted-foreground';
}

function surfaceLedgerProjectionStatusLabel(status: SurfaceLedgerProjectionView['projection']['status']): string {
  return {
    'static-only': 'Static',
    registered: 'Registered',
    called: 'Called',
    denied: 'Denied',
    'native-gated': 'Native',
    blocked: 'Blocked',
  }[status];
}

function surfaceLedgerProjectionStatusClass(status: SurfaceLedgerProjectionView['projection']['status']): string {
  if (status === 'called' || status === 'registered') {
    return 'border-success/30 bg-[color-mix(in_srgb,var(--success)_12%,transparent)] text-success';
  }
  if (status === 'blocked' || status === 'denied') return 'border-error/30 bg-[color-mix(in_srgb,var(--error)_12%,transparent)] text-error';
  if (status === 'native-gated') return 'border-[var(--amber)]/25 bg-[var(--amber-subtle)] text-[var(--amber-text)]';
  return 'border-border bg-muted/60 text-muted-foreground';
}

function surfacePolicyActionClass(action: SurfacePolicyAuditItem['action']): string {
  if (action === 'allow-after-load') return 'border-success/30 bg-[color-mix(in_srgb,var(--success)_12%,transparent)] text-success';
  if (action === 'blocked') return 'border-error/30 bg-[color-mix(in_srgb,var(--error)_12%,transparent)] text-error';
  if (action === 'review-before-enable' || action === 'native-adapter') {
    return 'border-[var(--amber)]/25 bg-[var(--amber-subtle)] text-[var(--amber-text)]';
  }
  return 'border-border bg-muted/60 text-muted-foreground';
}

function surfaceLedgerCountSummary(item: SurfaceLedgerProjectionView): string {
  const projection = item.projection;
  return [
    projection.predicted ? `${projection.predicted} predicted` : '',
    projection.registered ? `${projection.registered} registered` : '',
    projection.called ? `${projection.called} called` : '',
    projection.denied ? `${projection.denied} denied` : '',
    projection.blocked ? `${projection.blocked} blocked` : '',
  ].filter(Boolean).join(' / ') || 'no ledger evidence';
}

function SurfaceRouteCard({
  route,
  onOpenRoute,
}: {
  route: SurfaceRoute;
  onOpenRoute: (target: SurfaceRouteTarget) => void;
}) {
  const Icon = route.icon;

  return (
    <div className="flex min-w-0 flex-col gap-2 rounded-lg border border-border/50 bg-card/60 px-3 py-2.5">
      <div className="flex min-w-0 items-start gap-2">
        <span className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-md border border-border/60 bg-background text-muted-foreground">
          <Icon size={12} />
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex min-w-0 items-center gap-2">
            <span className="truncate text-xs font-medium text-foreground">{route.label}</span>
            <span className={`shrink-0 rounded border px-1.5 py-0.5 text-2xs ${surfaceRouteStateClass(route.state)}`}>
              {surfaceRouteStateLabel(route.state)}
            </span>
          </div>
          <p className="mt-0.5 line-clamp-2 text-2xs text-muted-foreground">{route.value}</p>
        </div>
      </div>
      {route.target && (
        <button
          type="button"
          onClick={() => onOpenRoute(route.target!)}
          className="ml-8 inline-flex h-7 w-fit items-center gap-1.5 rounded-md border border-border bg-background px-2.5 text-2xs font-medium text-foreground transition-colors hover:bg-muted/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <ExternalLink size={11} />
          {route.actionLabel ?? 'Open'}
        </button>
      )}
    </div>
  );
}
