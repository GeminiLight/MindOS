import { existsSync } from 'fs';
import path from 'path';
import contractJson from '../runtime-health-contract.json';

export interface HealthContractEntry {
  path: string;
  type: 'file' | 'directory';
}

interface HealthFeature {
  description: string;
  required: boolean;
  files: HealthContractEntry[];
}

interface RuntimeHealthContract {
  version: number;
  features: Record<string, HealthFeature>;
  checks: {
    standaloneAppRequiredFeatures: string[];
    bundledRuntimeRequiredFiles: HealthContractEntry[];
    bundledRuntimeRequiredFeatures: string[];
    archiveRequiredFiles: HealthContractEntry[];
    archiveRequiredFeatures: string[];
    runtimeLayoutMcpAnyOf: string[][];
  };
}

const contract = contractJson as RuntimeHealthContract;

function getFeatureEntries(featureNames: string[]): HealthContractEntry[] {
  const seen = new Set<string>();
  const entries: HealthContractEntry[] = [];
  for (const featureName of featureNames) {
    const feature = contract.features[featureName];
    if (!feature) {
      throw new Error(`Unknown runtime health feature: ${featureName}`);
    }
    for (const entry of feature.files) {
      if (!seen.has(entry.path)) {
        seen.add(entry.path);
        entries.push(entry);
      }
    }
  }
  return entries;
}

const WEB_APP_PREFIX = 'packages/web/';

function stripWebAppPrefix(entry: HealthContractEntry): HealthContractEntry {
  if (!entry.path.startsWith(WEB_APP_PREFIX)) {
    throw new Error(`Runtime health path is not web-app-relative: ${entry.path}`);
  }
  return { ...entry, path: entry.path.slice(WEB_APP_PREFIX.length) };
}

export function getRuntimeHealthContract(): RuntimeHealthContract {
  return contract;
}

export function getStandaloneAppRequiredEntries(): HealthContractEntry[] {
  return getFeatureEntries(contract.checks.standaloneAppRequiredFeatures).map(stripWebAppPrefix);
}

export function getStandaloneAppRequiredFiles(): string[] {
  return getStandaloneAppRequiredEntries().map(entry => entry.path);
}

export function getBundledRuntimeRequiredEntries(): HealthContractEntry[] {
  return [
    ...contract.checks.bundledRuntimeRequiredFiles,
    ...getFeatureEntries(contract.checks.bundledRuntimeRequiredFeatures),
  ];
}

export function getBundledRuntimeRequiredFiles(): string[] {
  return getBundledRuntimeRequiredEntries().map(entry => entry.path);
}

export function getArchiveValidationEntries(): HealthContractEntry[] {
  return [
    ...contract.checks.archiveRequiredFiles,
    ...getFeatureEntries(contract.checks.archiveRequiredFeatures),
  ];
}

export function getArchiveValidationFiles(): string[] {
  return getArchiveValidationEntries().map(entry => entry.path);
}

export function hasRequiredStandaloneAppFiles(appDir: string): boolean {
  return getStandaloneAppRequiredEntries().every(entry => existsSync(path.join(appDir, entry.path)));
}

export function hasBundledRuntimeRequiredFiles(rootDir: string): boolean {
  return getBundledRuntimeRequiredEntries().every(entry => existsSync(path.join(rootDir, entry.path)));
}

export function isRuntimeLayoutMcpRunnable(rootDir: string): boolean {
  return contract.checks.runtimeLayoutMcpAnyOf.some(featureNames =>
    getFeatureEntries(featureNames).every(entry => existsSync(path.join(rootDir, entry.path)))
  );
}
