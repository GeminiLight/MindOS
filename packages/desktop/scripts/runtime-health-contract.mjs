import { existsSync, readFileSync } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CONTRACT_PATH = path.join(__dirname, '..', 'runtime-health-contract.json');
const contract = JSON.parse(readFileSync(CONTRACT_PATH, 'utf-8'));

function getFeatureEntries(featureNames) {
  const seen = new Set();
  const entries = [];
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

function stripWebAppPrefix(entry) {
  if (!entry.path.startsWith(WEB_APP_PREFIX)) {
    throw new Error(`Runtime health path is not web-app-relative: ${entry.path}`);
  }
  return { ...entry, path: entry.path.slice(WEB_APP_PREFIX.length) };
}

export function getStandaloneAppRequiredEntries() {
  return getFeatureEntries(contract.checks.standaloneAppRequiredFeatures).map(stripWebAppPrefix);
}

export function getArchiveValidationEntries() {
  return [
    ...contract.checks.archiveRequiredFiles,
    ...getFeatureEntries(contract.checks.archiveRequiredFeatures),
  ];
}

export function getArchiveValidationFiles() {
  return getArchiveValidationEntries().map(entry => entry.path);
}

export function assertStandaloneAppFiles(appDir, label = 'runtime') {
  const missing = getStandaloneAppRequiredEntries().filter(entry => !existsSync(path.join(appDir, entry.path)));
  if (missing.length > 0) {
    throw new Error(`[${label}] Incomplete standalone runtime, missing: ${missing.map(entry => entry.path).join(', ')}`);
  }
}
