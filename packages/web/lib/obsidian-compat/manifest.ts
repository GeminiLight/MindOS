/**
 * Obsidian Plugin Compatibility - Manifest Validation
 */

import { PluginManifest } from './types';

export class ManifestError extends Error {
  constructor(message: string, public field?: string) {
    super(message);
    this.name = 'ManifestError';
  }
}

/**
 * Validates a plugin manifest against required and optional fields.
 * @throws ManifestError if validation fails
 */
export function validateManifest(manifest: unknown): PluginManifest {
  if (!manifest || typeof manifest !== 'object') {
    throw new ManifestError('Manifest must be an object');
  }

  const m = manifest as Record<string, unknown>;

  // Required fields
  if (!m.id || typeof m.id !== 'string') {
    throw new ManifestError('Missing or invalid "id" field', 'id');
  }
  if (!isValidId(m.id)) {
    throw new ManifestError(`Invalid plugin id: "${m.id}". Must be alphanumeric with hyphens/underscores.`, 'id');
  }

  if (!m.name || typeof m.name !== 'string') {
    throw new ManifestError('Missing or invalid "name" field', 'name');
  }

  if (!m.version || typeof m.version !== 'string') {
    throw new ManifestError('Missing or invalid "version" field', 'version');
  }
  if (!isValidSemver(m.version)) {
    throw new ManifestError(`Invalid semver: "${m.version}"`, 'version');
  }

  // Optional fields
  const result: PluginManifest = {
    id: m.id,
    name: m.name,
    version: m.version,
  };

  if (m.minMindOsVersion && typeof m.minMindOsVersion === 'string') {
    result.minMindOsVersion = m.minMindOsVersion;
  }

  if (m.description && typeof m.description === 'string') {
    result.description = m.description;
  }

  if (m.author && typeof m.author === 'string') {
    result.author = m.author;
  }

  if (m.authorUrl && typeof m.authorUrl === 'string') {
    result.authorUrl = m.authorUrl;
  }

  if (m.fundingUrl && typeof m.fundingUrl === 'string') {
    result.fundingUrl = m.fundingUrl;
  }

  if (m.isDesktopOnly === true) {
    result.isDesktopOnly = true;
  }

  return result;
}

/**
 * Checks if plugin ID is valid (alphanumeric, hyphens, underscores).
 */
function isValidId(id: string): boolean {
  return /^[a-zA-Z0-9_-]+$/.test(id) && id.length > 0 && id.length <= 64;
}

/**
 * Checks if version string is valid semver (major.minor.patch).
 */
function isValidSemver(version: string): boolean {
  return /^\d+\.\d+\.\d+$/.test(version);
}
