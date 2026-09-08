/**
 * Obsidian Plugin Compatibility - API surface snapshot types
 *
 * The snapshot is generated from the official `obsidian.d.ts` by
 * `scripts/generate-obsidian-api-surface.ts`. Keep this module free of runtime
 * imports so both the generator and the runtime can share it.
 */

export const OBSIDIAN_API_SURFACE_SCHEMA_VERSION = 1;

export type ObsidianApiSurfaceExportKind =
  | 'class'
  | 'abstract-class'
  | 'function'
  | 'const'
  | 'let'
  | 'enum'
  | 'interface'
  | 'type';

export type ObsidianApiSurfaceMemberKind =
  | 'constructor'
  | 'method'
  | 'property'
  | 'accessor'
  | 'index-signature'
  | 'call-signature';

export interface ObsidianApiSurfaceMember {
  name: string;
  kind: ObsidianApiSurfaceMemberKind;
  static?: true;
  optional?: true;
  abstract?: true;
  deprecated?: true;
  since?: string;
}

export interface ObsidianApiSurfaceExport {
  name: string;
  kind: ObsidianApiSurfaceExportKind;
  extends?: string[];
  implements?: string[];
  members?: ObsidianApiSurfaceMember[];
  deprecated?: true;
  since?: string;
}

export interface ObsidianApiSurfaceGlobalAugmentation {
  target: string;
  members: ObsidianApiSurfaceMember[];
}

export interface ObsidianApiSurfaceSource {
  repo: string;
  ref: string;
  commit: string | null;
  apiVersion: string | null;
  file: string;
  sha256: string;
}

export interface ObsidianApiSurface {
  schemaVersion: typeof OBSIDIAN_API_SURFACE_SCHEMA_VERSION;
  source: ObsidianApiSurfaceSource;
  exports: ObsidianApiSurfaceExport[];
  globals: ObsidianApiSurfaceGlobalAugmentation[];
}

/** Export kinds that must exist as runtime values on `require('obsidian')`. */
export const OBSIDIAN_API_SURFACE_VALUE_KINDS: ReadonlySet<ObsidianApiSurfaceExportKind> = new Set([
  'class',
  'abstract-class',
  'function',
  'const',
  'let',
  'enum',
]);
