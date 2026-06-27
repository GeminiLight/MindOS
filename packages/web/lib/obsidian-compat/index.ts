/**
 * Obsidian Plugin Compatibility - Public API
 * Main entry point for using the compat layer
 */

export { Plugin } from './shims/plugin';
export { Vault } from './shims/vault';
export { Notice, Modal } from './shims/ui';
export { PluginSettingTab, Setting } from './shims/settings';
export { AppShim } from './shims/app';
export { PluginLoader } from './loader';
export { PluginManager } from './plugin-manager';
export { scanObsidianVaultPlugins, importObsidianPlugin } from './obsidian-import';
export { analyzePluginCompatibility, getCompatibilityLevel } from './compatibility-report';
export { CommandRegistry } from './command-registry';
export { Component } from './component';
export { Events } from './events';
export { ObsidianRuntimeHost } from './runtime';
export {
  ObsidianRuntimeCapabilityLedgerStore,
  redactRuntimeCapabilityEvidence,
} from './runtime-capability-ledger-store';
export {
  buildObsidianWorkflowAudits,
} from './workflow-audit';
export {
  buildObsidianImportDecision,
  buildObsidianSurfaceLedgerProjection,
} from './surface-decision';
export {
  ObsidianWorkflowProbeStore,
  buildObsidianWorkflowProbeAudits,
  isObsidianWorkflowProbeId,
  runObsidianWorkflowProbe,
  runObsidianWorkflowProbes,
  workflowAuditFromProbeResult,
} from './workflow-probes';
export {
  applyObsidianLinterFixes,
  buildObsidianLinterSandboxContributions,
  getObsidianLinterRuleMetadata,
  normalizeObsidianLinterRuleProfile,
  OBSIDIAN_LINTER_RULE_METADATA,
  previewObsidianLinterFixes,
} from './linter-adapter';
export {
  buildObsidianNativeQueryIndex,
  OBSIDIAN_NATIVE_QUERY_INDEX_PROOF_SUMMARY,
  queryObsidianNativeNotes,
  queryObsidianNativeTasks,
} from './native-query-index';
export {
  buildImportedObsidianLinterProfile,
  OBSIDIAN_LINTER_DATA_JSON_RULE_MAPPINGS,
  OBSIDIAN_LINTER_PLUGIN_ID,
  parseImportedObsidianLinterProfileJson,
} from './linter-settings-profile';
export {
  createDefaultObsidianSecretStorageBackend,
  DesktopSafeStorageBrokerBackend,
  getDesktopSecretStorageBrokerConfigFromEnv,
  LocalAesGcmSecretStorageBackend,
  ObsidianSecretStorage,
  removeObsidianPluginSecrets,
} from './secret-storage';
export { validateManifest, ManifestError } from './manifest';
export {
  OBSIDIAN_COMMUNITY_PLUGINS_URL,
  buildObsidianCommunityPluginReleaseUrls,
  buildObsidianCommunityCatalog,
  fetchObsidianCommunityPluginPackage,
  githubUrlForRepo,
  parseObsidianCommunityCatalog,
  preflightObsidianCommunityPluginPackage,
} from './community-catalog';
export {
  installObsidianCommunityPlugin,
  planObsidianCommunityPluginUpdate,
  updateObsidianCommunityPlugin,
} from './community-install';
export { compareCommunityVersions } from './community-version';
export {
  buildObsidianCommunityPreflightSupport,
  buildObsidianCommunitySurfacePreview,
} from './community-support';
export { CompatError, CompatErrorCodes } from './errors';
export type { DataAdapter, IFileManager, ListedFiles, PluginManifest, SecretStorage, Stat, TFile, TFolder, TAbstractFile, Command } from './types';
export type { DesktopSecretStorageBrokerConfig, ObsidianSecretStorageBackend, ObsidianSecretStorageSummary } from './secret-storage';
export type {
  BuildObsidianCommunityCatalogOptions,
  FetchedObsidianCommunityPluginPackage,
  FetchObsidianCommunityPluginPackageOptions,
  InstalledObsidianPluginState,
  ObsidianCommunityCatalog,
  ObsidianCommunityCatalogEntry,
  ObsidianCommunityCatalogItem,
  ObsidianCommunityPluginPackageDigest,
  ObsidianCommunityPluginPreflight,
  ObsidianCommunityPluginReleaseUrls,
  ParseObsidianCommunityCatalogResult,
  PreflightObsidianCommunityPluginPackageOptions,
} from './community-catalog';
export type {
  InstalledObsidianCommunityPlugin,
  InstallObsidianCommunityPluginOptions,
  InstallObsidianCommunityPluginResult,
  ObsidianCommunityInstallMetadata,
  ObsidianCommunityUpdateFileAction,
  ObsidianCommunityUpdatePlan,
  ObsidianCommunityUpdatePlanFile,
  PlanObsidianCommunityPluginUpdateOptions,
  UpdateObsidianCommunityPluginOptions,
  UpdateObsidianCommunityPluginResult,
  UpdatedObsidianCommunityPlugin,
} from './community-install';
export type { CommunityVersionState } from './community-version';
export type {
  ObsidianCommunityPreflightSupport,
  ObsidianCommunityPreflightSupportLevel,
  ObsidianCommunitySurfacePreview,
  ObsidianCommunitySurfacePreviewId,
  ObsidianCommunitySurfacePreviewState,
} from './community-support';
export type {
  ObsidianLinterAdapterIssue,
  ObsidianLinterAdapterOptions,
  ObsidianLinterAdapterResult,
  ObsidianLinterAdapterRuleId,
  ObsidianLinterAdapterSeverity,
  ObsidianLinterAdapterSkippedIssueSummary,
  ObsidianLinterAppliedFixSummary,
  ObsidianLinterApplyFixResult,
  ObsidianLinterFixPreviewResult,
  ObsidianLinterRuleMetadata,
  ObsidianLinterRuleProfile,
  ObsidianLinterRuleProfileInput,
} from './linter-adapter';
export type {
  ImportedObsidianLinterProfile,
  ObsidianLinterDataJsonRuleMapping,
} from './linter-settings-profile';
export type {
  BuildObsidianNativeQueryIndexInput,
  ObsidianNativeQueryHeadingRecord,
  ObsidianNativeQueryIndex,
  ObsidianNativeQueryLinkRecord,
  ObsidianNativeQueryNoteFilter,
  ObsidianNativeQueryNoteRecord,
  ObsidianNativeQueryTaskFilter,
  ObsidianNativeQueryTaskRecord,
} from './native-query-index';
export type {
  ObsidianRuntimeCapabilityLedgerHistory,
  ObsidianRuntimeCapabilityLedgerStoreOptions,
  PersistentObsidianRuntimeCapabilityLedgerEntry,
} from './runtime-capability-ledger-store';
export type {
  ObsidianImportDecision,
  ObsidianImportDecisionAction,
  ObsidianImportDecisionConfidence,
  ObsidianImportDecisionSeverity,
  ObsidianSurfaceLedgerProjection,
  ObsidianSurfaceLedgerProjectionStatus,
} from './surface-decision';
export type {
  BuildObsidianWorkflowAuditsInput,
  ObsidianWorkflowAudit,
  ObsidianWorkflowAuditSource,
  ObsidianWorkflowAuditStatus,
} from './workflow-audit';
export type {
  ObsidianWorkflowProbeAssertion,
  ObsidianWorkflowProbeHistory,
  ObsidianWorkflowProbeId,
  ObsidianWorkflowProbeResult,
  ObsidianWorkflowProbeSource,
  ObsidianWorkflowProbeStatus,
} from './workflow-probes';
