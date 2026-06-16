'use client';

import {
  Download,
  ExternalLink,
  FolderOpen,
  ListChecks,
  Puzzle,
  RefreshCw,
  ShieldCheck,
} from 'lucide-react';
import type { ObsidianCommunityCatalogItem } from '@/lib/obsidian-compat/community-catalog';
import type { ObsidianCommunityUpdatePlan } from '@/lib/obsidian-compat/community-install';
import { compareCommunityVersions } from '@/lib/obsidian-compat/community-version';
import {
  communityPreflightClass,
  communityPreflightSupport,
  communityPreflightSupportClass,
  communityPreflightSurfaceClass,
  communityPreflightSurfaces,
  communityStatusClass,
  communityUpdateClass,
  type CommunityInstallState,
  type CommunityPreflightState,
  type CommunityUpdatePlanState,
  type CommunityUpdateState,
  type CommunityPreflightSurfacePrediction,
  type PluginsCopy,
} from './PluginsTabModel';

interface CommunityPluginRowProps {
  copy: PluginsCopy;
  plugin: ObsidianCommunityCatalogItem;
  index: number;
  preflight?: CommunityPreflightState;
  install?: CommunityInstallState;
  updatePlan?: CommunityUpdatePlanState;
  update?: CommunityUpdateState;
  onCheckPreflight: (plugin: ObsidianCommunityCatalogItem) => void | Promise<void>;
  onPreviewUpdatePlan: (plugin: ObsidianCommunityCatalogItem) => void | Promise<void>;
  onApplyUpdate: (
    plugin: ObsidianCommunityCatalogItem,
    plan: ObsidianCommunityUpdatePlan,
  ) => void | Promise<void>;
  onInstall: (plugin: ObsidianCommunityCatalogItem) => void | Promise<void>;
  onOpenHost: (pluginId: string) => void;
  onOpenImportPanel: () => void;
}

function CommunityPreflightSupportPreview({
  copy,
  result,
}: {
  copy: PluginsCopy;
  result: NonNullable<CommunityPreflightState['result']>;
}) {
  const support = communityPreflightSupport(result);
  const level = support.kind;
  const surfaces = communityPreflightSurfaces(result);

  return (
    <div className="mt-2 border-t border-current/15 pt-2">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-2xs font-medium uppercase opacity-80">
          {copy.communityPreflightRecommendationTitle}
        </span>
        <span className={`rounded border px-1.5 py-0.5 font-mono text-2xs ${communityPreflightSupportClass(level)}`}>
          {copy.communityPreflightRecommendation(level)}
        </span>
      </div>
      <p className="mt-1 text-2xs leading-relaxed opacity-90">
        {copy.communityPreflightRecommendationNote(level)}
      </p>
      <div className="mt-2 flex flex-wrap items-center gap-2">
        <span className="text-2xs font-medium uppercase opacity-80">
          {copy.communityPreflightSupportTitle}
        </span>
        <span className={`rounded border px-1.5 py-0.5 font-mono text-2xs ${communityPreflightSupportClass(level)}`}>
          {copy.communityPreflightSupportLevel(level)}
        </span>
      </div>
      <p className="mt-1 text-2xs leading-relaxed opacity-90">
        {copy.communityPreflightSupportNote(level)}
      </p>
      {support.reason && (
        <p className="mt-1 text-2xs leading-relaxed opacity-90">
          <span className="font-medium">{copy.communityPreflightSupportReasonLabel}</span>{' '}
          {support.reason}
        </p>
      )}
      {surfaces.length > 0 ? (
        <div className="mt-2 flex flex-wrap gap-1.5">
          {surfaces.map((surface) => (
            <CommunityPreflightSurfaceChip key={surface.id} copy={copy} surface={surface} />
          ))}
        </div>
      ) : (
        <p className="mt-2 text-2xs leading-relaxed opacity-75">
          {copy.communityPreflightSurfaceEmpty}
        </p>
      )}
      <p className="mt-2 text-2xs leading-relaxed opacity-75">
        {copy.communityPreflightInstallBoundary}
      </p>
    </div>
  );
}

function CommunityPreflightSurfaceChip({
  copy,
  surface,
}: {
  copy: PluginsCopy;
  surface: CommunityPreflightSurfacePrediction;
}) {
  return (
    <span className={`inline-flex items-center gap-1 rounded border px-1.5 py-0.5 text-2xs ${communityPreflightSurfaceClass(surface.state)}`}>
      <span className="font-medium">{copy.communityPreflightSurfaceLabel(surface.id)}</span>
      <span className="font-mono opacity-75">{copy.communityPreflightSurfaceState(surface.state)}</span>
      <span className="font-mono opacity-60">{copy.communityPreflightSurfaceDetail(surface.id, surface.count)}</span>
    </span>
  );
}

export function CommunityPluginRow({
  copy,
  plugin,
  index,
  preflight,
  install,
  updatePlan,
  update,
  onCheckPreflight,
  onPreviewUpdatePlan,
  onApplyUpdate,
  onInstall,
  onOpenHost,
  onOpenImportPanel,
}: CommunityPluginRowProps) {
  const preflightBlocker = preflight?.result?.installBlockedReasons?.[0];
  const support = preflight?.result ? communityPreflightSupport(preflight.result) : null;
  const supportLevel = support?.kind ?? null;
  const updatePlanResult = updatePlan?.result;
  const canInstall = !plugin.installed && preflight?.result?.installable === true;
  const remoteVersion = preflight?.result?.package.manifest.version;
  const versionState = plugin.installed && preflight?.result
    ? compareCommunityVersions(plugin.installedVersion, remoteVersion)
    : null;

  return (
    <div
      className={`flex flex-col gap-3 px-4 py-3 ${
        index === 0 ? '' : 'border-t border-border/70'
      }`}
    >
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="flex min-w-0 items-start gap-3">
          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-border bg-background font-mono text-xs font-semibold text-[var(--amber-text)]">
            Ob
          </span>
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-sm font-medium text-foreground">{plugin.name}</span>
              <span className={`rounded border px-1.5 py-0.5 font-mono text-2xs ${communityStatusClass(plugin.installStatus)}`}>
                {copy.communityInstallStatus(plugin.installStatus)}
              </span>
            </div>
            <p className="mt-1 text-2xs text-muted-foreground">
              {plugin.author} · {plugin.repo}
            </p>
            {plugin.description && (
              <p className="mt-1 max-w-2xl text-xs leading-relaxed text-muted-foreground">{plugin.description}</p>
            )}
            {!plugin.installed && (
              <p className="mt-2 text-2xs text-muted-foreground/80">{copy.communityImportHint}</p>
            )}
            {plugin.installedLastError && (
              <p className="mt-2 text-2xs text-error">{plugin.installedLastError}</p>
            )}
          </div>
        </div>

        <div className="flex w-fit shrink-0 flex-wrap items-center gap-2 sm:justify-end">
          <button
            type="button"
            data-obsidian-community-preflight={plugin.id}
            onClick={() => void onCheckPreflight(plugin)}
            disabled={preflight?.loading}
            className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-border bg-background px-2.5 text-2xs font-medium text-foreground transition-colors hover:bg-muted/60 disabled:cursor-not-allowed disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            {preflight?.loading ? (
              <RefreshCw size={11} className="animate-spin" />
            ) : (
              <ShieldCheck size={11} />
            )}
            {preflight?.loading
              ? copy.communityPreflightChecking
              : plugin.installed
                ? copy.communityUpdateCheckAction
                : copy.communityPreflightAction}
          </button>
          {plugin.githubUrl && (
            <a
              href={plugin.githubUrl}
              target="_blank"
              rel="noreferrer"
              className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-border bg-background px-2.5 text-2xs font-medium text-foreground transition-colors hover:bg-muted/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              <ExternalLink size={11} />
              {copy.communityGithubAction}
            </a>
          )}
          {plugin.installed ? (
            <button
              type="button"
              data-obsidian-community-manage={plugin.id}
              onClick={() => onOpenHost(plugin.id)}
              className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-border bg-background px-2.5 text-2xs font-medium text-foreground transition-colors hover:bg-muted/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              <Puzzle size={11} />
              {copy.communityManageAction}
            </button>
          ) : (
            <>
              {canInstall && (
                <button
                  type="button"
                  data-obsidian-community-install={plugin.id}
                  onClick={() => void onInstall(plugin)}
                  disabled={install?.loading}
                  className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-[var(--amber)] bg-[var(--amber)] px-2.5 text-2xs font-medium text-[var(--amber-foreground)] transition-colors hover:bg-[var(--amber)]/90 disabled:cursor-not-allowed disabled:opacity-60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                >
                  {install?.loading ? (
                    <RefreshCw size={11} className="animate-spin" />
                  ) : (
                    <Download size={11} />
                  )}
                  {install?.loading ? copy.communityInstallInstalling : copy.communityInstallAction}
                </button>
              )}
              <button
                type="button"
                onClick={onOpenImportPanel}
                className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-border bg-background px-2.5 text-2xs font-medium text-foreground transition-colors hover:bg-muted/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                <FolderOpen size={11} />
                {copy.communityImportAction}
              </button>
            </>
          )}
        </div>
      </div>

      {install?.installedVersion && (
        <div className="rounded-lg border border-success/25 bg-success/10 px-3 py-2 text-2xs leading-relaxed text-success">
          {copy.communityInstallSucceeded(install.installedVersion)}
        </div>
      )}

      {install?.error && (
        <div className="rounded-lg border border-error/25 bg-error/10 px-3 py-2 text-2xs text-error">
          {copy.communityInstallFailed}: {install.error}
        </div>
      )}

      {preflight?.result && plugin.installed && versionState && (
        <div className={`rounded-lg border px-3 py-2 ${communityUpdateClass(preflight.result, versionState)}`}>
          <div className="flex flex-wrap items-center gap-2">
            <span className="inline-flex items-center gap-1.5 text-xs font-medium">
              <ShieldCheck size={12} />
              {copy.communityUpdateStatus(versionState)}
            </span>
            <span className="font-mono text-2xs opacity-80">
              {copy.communityUpdateVersions(plugin.installedVersion, preflight.result.package.manifest.version)}
            </span>
          </div>
          <p className="mt-1 text-2xs leading-relaxed opacity-90">
            {preflightBlocker ?? copy.communityUpdateNote(versionState)}
          </p>
          <CommunityPreflightSupportPreview copy={copy} result={preflight.result} />
          {versionState === 'update-available' && (
            <button
              type="button"
              data-obsidian-community-update-plan={plugin.id}
              onClick={() => void onPreviewUpdatePlan(plugin)}
              disabled={updatePlan?.loading}
              className="mt-2 inline-flex h-7 items-center gap-1.5 rounded-md border border-current/20 bg-background/50 px-2 text-2xs font-medium transition-colors hover:bg-background disabled:cursor-not-allowed disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              {updatePlan?.loading ? (
                <RefreshCw size={11} className="animate-spin" />
              ) : (
                <ListChecks size={11} />
              )}
              {updatePlan?.loading ? copy.communityUpdatePreviewLoading : copy.communityUpdatePreviewAction}
            </button>
          )}
        </div>
      )}

      {updatePlanResult && (
        <div className="rounded-lg border border-border bg-background px-3 py-2 text-2xs text-foreground">
          <div className="flex flex-wrap items-center gap-2">
            <span className="inline-flex items-center gap-1.5 text-xs font-medium">
              <ListChecks size={12} />
              {copy.communityUpdatePreviewTitle}
            </span>
            <span className="rounded border border-border bg-muted px-1.5 py-0.5 font-mono text-2xs text-muted-foreground">
              {updatePlanResult.writePolicy}
            </span>
          </div>
          <p className="mt-1 text-2xs leading-relaxed text-muted-foreground">
            {updatePlanResult.updatable
              ? copy.communityUpdatePreviewPolicy
              : copy.communityUpdatePreviewBlocked(updatePlanResult.blockedReasons[0])}
          </p>
          <div className="mt-2 grid gap-1.5 sm:grid-cols-2">
            {updatePlanResult.files.map((file) => (
              <div
                key={file.path}
                className="flex items-center justify-between gap-3 rounded-md border border-border/70 bg-muted/30 px-2 py-1.5"
              >
                <span className="min-w-0 truncate font-mono">{file.path}</span>
                <span className="shrink-0 text-muted-foreground">
                  {copy.communityUpdatePreviewFile(file.action, file.localBytes, file.remoteBytes)}
                </span>
              </div>
            ))}
          </div>
          {updatePlanResult.updatable && (
            <button
              type="button"
              data-obsidian-community-update-apply={plugin.id}
              onClick={() => void onApplyUpdate(plugin, updatePlanResult)}
              disabled={update?.loading}
              className="mt-2 inline-flex h-7 items-center gap-1.5 rounded-md border border-[var(--amber)] bg-[var(--amber)] px-2 text-2xs font-medium text-[var(--amber-foreground)] transition-colors hover:bg-[var(--amber)]/90 disabled:cursor-not-allowed disabled:opacity-60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              {update?.loading ? (
                <RefreshCw size={11} className="animate-spin" />
              ) : (
                <Download size={11} />
              )}
              {update?.loading ? copy.communityUpdateApplyLoading : copy.communityUpdateApplyAction}
            </button>
          )}
        </div>
      )}

      {update?.version && (
        <div className="rounded-lg border border-success/25 bg-success/10 px-3 py-2 text-2xs leading-relaxed text-success">
          {copy.communityUpdateApplySucceeded(update.version)}
        </div>
      )}

      {update?.error && (
        <div className="rounded-lg border border-error/25 bg-error/10 px-3 py-2 text-2xs text-error">
          {copy.communityUpdateApplyFailed}: {update.error}
        </div>
      )}

      {updatePlan?.error && (
        <div className="rounded-lg border border-error/25 bg-error/10 px-3 py-2 text-2xs text-error">
          {copy.communityUpdatePreviewFailed}: {updatePlan.error}
        </div>
      )}

      {preflight?.result && !plugin.installed && (
        <div className={`rounded-lg border px-3 py-2 ${communityPreflightClass(preflight.result)}`}>
          <div className="flex flex-wrap items-center gap-2">
            <span className="inline-flex items-center gap-1.5 text-xs font-medium">
              <ShieldCheck size={12} />
              {copy.communityPreflightStatus(supportLevel === 'native' ? 'native' : preflight.result.compatibility.level, preflight.result.installable)}
            </span>
            <span className="font-mono text-2xs opacity-80">
              {copy.communityPreflightAssets(preflight.result.package.manifest.version, preflight.result.package.assets.stylesCss)}
            </span>
          </div>
          <p className="mt-1 text-2xs leading-relaxed opacity-90">
            {support?.kind === 'native' ? support.reason : preflightBlocker ?? copy.communityPreflightNoBlockers}
          </p>
          <CommunityPreflightSupportPreview copy={copy} result={preflight.result} />
        </div>
      )}

      {preflight?.error && (
        <div className="rounded-lg border border-error/25 bg-error/10 px-3 py-2 text-2xs text-error">
          {copy.communityPreflightFailed}: {preflight.error}
        </div>
      )}
    </div>
  );
}
