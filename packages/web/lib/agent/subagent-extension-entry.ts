import path from 'node:path';

/**
 * Where to load the upstream pi-subagents extension from.
 *
 * 0.6x shipped TypeScript source only, so the path was hardcoded to
 * `src/extension/index.ts`. 0.87 ships a prebuilt bundle and names its entry in
 * the `pi.extensions` manifest field — the convention every Pi extension uses
 * (pi-mcp-adapter, pi-web-access and pi-schedule-prompt all declare it). Reading
 * it means a later layout change needs no code change here.
 */
const LEGACY_SOURCE_ENTRY = ['src', 'extension', 'index.ts'] as const;

type SubagentPackageManifest = {
  pi?: { extensions?: unknown };
};

function firstDeclaredEntry(extensions: unknown): string | undefined {
  const candidate = Array.isArray(extensions) ? extensions[0] : extensions;
  return typeof candidate === 'string' && candidate.trim() ? candidate.trim() : undefined;
}

export function resolveUpstreamSubagentEntry(
  packageDir: string,
  manifest: SubagentPackageManifest,
): string {
  const fallback = path.join(packageDir, ...LEGACY_SOURCE_ENTRY);
  const declared = firstDeclaredEntry(manifest.pi?.extensions);
  if (!declared) return fallback;

  // A manifest is package-controlled, not user input, but an entry that escapes
  // the package directory would load code from somewhere we never installed.
  const resolved = path.resolve(packageDir, declared);
  const within = path.relative(packageDir, resolved);
  if (!within || within.startsWith('..') || path.isAbsolute(within)) return fallback;
  return resolved;
}
