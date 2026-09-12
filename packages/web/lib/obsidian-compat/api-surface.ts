/**
 * Obsidian Plugin Compatibility - API surface
 *
 * Bridges the generated `obsidian.d.ts` snapshot with the hand-written shim.
 * Two jobs:
 *
 * 1. Diagnostics at plugin load time. `require('obsidian')` and `app` are wrapped
 *    so that touching an API Obsidian declares but MindOS has not implemented
 *    fails with a typed `CompatError` and a runtime capability ledger entry,
 *    instead of an opaque `undefined is not a constructor` deep inside plugin code.
 * 2. Coverage accounting at test / report time. `diffObsidianApiSurface()` lists
 *    which declared exports and methods the shim implements, which are missing,
 *    and which capability matrix rows are MindOS-specific rather than official.
 *
 * Nothing here changes what the shim can do; it only makes the boundary explicit.
 */

import surfaceJson from './generated/obsidian-api-surface.json';
import { CompatError, CompatErrorCodes } from './errors';
import {
  OBSIDIAN_API_SURFACE_VALUE_KINDS,
  type ObsidianApiSurface,
  type ObsidianApiSurfaceExport,
  type ObsidianApiSurfaceExportKind,
  type ObsidianApiSurfaceMember,
  type ObsidianApiSurfaceMemberKind,
  type ObsidianApiSurfaceSource,
} from './api-surface-types';

export type {
  ObsidianApiSurface,
  ObsidianApiSurfaceExport,
  ObsidianApiSurfaceExportKind,
  ObsidianApiSurfaceMember,
  ObsidianApiSurfaceMemberKind,
  ObsidianApiSurfaceSource,
} from './api-surface-types';

export type ObsidianApiSurfaceMissOwner = 'obsidian' | 'app';

export interface ObsidianApiSurfaceMiss {
  owner: ObsidianApiSurfaceMissOwner;
  /** `Canvas` for module exports, `app.plugins` for App members. */
  api: string;
  kind: ObsidianApiSurfaceExportKind | ObsidianApiSurfaceMemberKind | 'unknown';
  /** True when `obsidian.d.ts` declares this API; false for undocumented / internal access. */
  declared: boolean;
  since?: string;
  deprecated?: boolean;
}

export type ObsidianApiSurfaceMissListener = (miss: ObsidianApiSurfaceMiss) => void;

export interface ObsidianApiSurfaceMissingExport {
  name: string;
  kind: ObsidianApiSurfaceExportKind;
  since?: string;
  deprecated?: boolean;
}

export interface ObsidianApiSurfaceMemberDiff {
  owner: string;
  declared: number;
  implemented: string[];
  missing: string[];
}

export interface ObsidianApiSurfaceDiff {
  source: ObsidianApiSurfaceSource;
  exports: {
    declared: number;
    implemented: string[];
    missing: ObsidianApiSurfaceMissingExport[];
    shimOnly: string[];
  };
  members: ObsidianApiSurfaceMemberDiff[];
  matrix: {
    /** Capability matrix rows whose API name is not part of the official `obsidian.d.ts` surface. */
    undeclaredRows: string[];
  };
}

export interface DiffObsidianApiSurfaceInput {
  module: Record<string, unknown>;
  app?: object;
  matrixApis?: readonly string[];
  surface?: ObsidianApiSurface;
}

const surface = surfaceJson as ObsidianApiSurface;
let exportIndex: Map<string, ObsidianApiSurfaceExport> | null = null;

/**
 * Property names that bundler interop, promise resolution, serialization, and
 * test matchers probe on arbitrary objects. Reporting them as misses would be noise.
 */
const PROBE_KEYS = new Set<string>([
  '__esModule',
  'default',
  'then',
  'catch',
  'finally',
  'toJSON',
  'constructor',
  'prototype',
  'toString',
  'valueOf',
  'inspect',
  'nodeType',
  'asymmetricMatch',
  '$$typeof',
  '@@__IMMUTABLE_ITERABLE__@@',
  '@@__IMMUTABLE_RECORD__@@',
  'length',
]);

export function getObsidianApiSurface(): ObsidianApiSurface {
  return surface;
}

export function getObsidianApiSurfaceExport(name: string, source: ObsidianApiSurface = surface): ObsidianApiSurfaceExport | undefined {
  if (source === surface) {
    if (!exportIndex) exportIndex = new Map(surface.exports.map((entry) => [entry.name, entry]));
    return exportIndex.get(name);
  }
  return source.exports.find((entry) => entry.name === name);
}

export function isObsidianApiSurfaceValueKind(kind: ObsidianApiSurfaceExportKind): boolean {
  return OBSIDIAN_API_SURFACE_VALUE_KINDS.has(kind);
}

function describeMiss(miss: ObsidianApiSurfaceMiss, tier: 'server' | 'browser'): string {
  const where = miss.owner === 'obsidian' ? `require('obsidian').${miss.api}` : miss.api;
  if (!miss.declared) {
    return `${where} is not part of the public Obsidian API (obsidian.d.ts) and is not provided by the MindOS runtime.`;
  }
  const since = miss.since ? ` (since Obsidian ${miss.since})` : '';
  const deprecated = miss.deprecated ? ' It is deprecated upstream.' : '';
  return `${where} is declared by obsidian.d.ts${since} but is not implemented by the MindOS ${tier} runtime tier.${deprecated}`;
}

export function createObsidianApiNotImplementedError(miss: ObsidianApiSurfaceMiss, tier: 'server' | 'browser' = 'server'): CompatError {
  return new CompatError(describeMiss(miss, tier), CompatErrorCodes.API_NOT_IMPLEMENTED, {
    owner: miss.owner,
    api: miss.api,
    kind: miss.kind,
    declared: miss.declared,
    tier,
  });
}

function missFor(owner: ObsidianApiSurfaceMissOwner, api: string, declaration: { kind: ObsidianApiSurfaceExportKind | ObsidianApiSurfaceMemberKind; since?: string; deprecated?: true } | undefined): ObsidianApiSurfaceMiss {
  return {
    owner,
    api,
    kind: declaration?.kind ?? 'unknown',
    declared: Boolean(declaration),
    ...(declaration?.since ? { since: declaration.since } : {}),
    ...(declaration?.deprecated ? { deprecated: true } : {}),
  };
}

function createStubClass(miss: ObsidianApiSurfaceMiss, tier: 'server' | 'browser'): unknown {
  // `class X extends Stub {}` must succeed at declaration time so the plugin module
  // evaluates; instantiation is where the typed error surfaces.
  const Stub = class ObsidianApiNotImplemented {
    constructor() {
      throw createObsidianApiNotImplementedError(miss, tier);
    }
  };
  Object.defineProperty(Stub, 'name', { value: miss.api });
  return Stub;
}

function createStubFunction(miss: ObsidianApiSurfaceMiss, tier: 'server' | 'browser'): unknown {
  const stub = function obsidianApiNotImplemented(): never {
    throw createObsidianApiNotImplementedError(miss, tier);
  };
  Object.defineProperty(stub, 'name', { value: miss.api });
  return stub;
}

/**
 * Wrap the module returned by `require('obsidian')`.
 *
 * - Implemented exports pass through untouched.
 * - Declared-but-missing classes and functions become stubs that throw a typed
 *   `CompatError` when constructed / called, so `class X extends obsidian.Canvas`
 *   still evaluates and the failure names the API.
 * - Everything else stays `undefined`; `'X' in module` keeps reporting the truth
 *   so feature detection is not fooled.
 * - Each distinct miss is reported once.
 */
export function createDiagnosticObsidianModule<T extends Record<string, unknown>>(
  module: T,
  onMiss: ObsidianApiSurfaceMissListener,
  source: ObsidianApiSurface = surface,
  tier: 'server' | 'browser' = 'server',
): T {
  const reported = new Set<string>();
  const stubs = new Map<string, unknown>();

  const report = (miss: ObsidianApiSurfaceMiss) => {
    if (reported.has(miss.api)) return;
    reported.add(miss.api);
    try {
      onMiss(miss);
    } catch {
      // Diagnostics must never break plugin evaluation.
    }
  };

  return new Proxy(module, {
    get(target, prop, receiver) {
      if (typeof prop === 'symbol' || prop in target || PROBE_KEYS.has(prop)) {
        return Reflect.get(target, prop, receiver);
      }
      const declaration = getObsidianApiSurfaceExport(prop, source);
      const miss = missFor('obsidian', prop, declaration && isObsidianApiSurfaceValueKind(declaration.kind) ? declaration : undefined);
      report(miss);
      if (!declaration || !isObsidianApiSurfaceValueKind(declaration.kind)) return undefined;
      let stub = stubs.get(prop);
      if (!stub) {
        stub = declaration.kind === 'function' ? createStubFunction(miss, tier) : declaration.kind === 'class' || declaration.kind === 'abstract-class' ? createStubClass(miss, tier) : undefined;
        if (stub) stubs.set(prop, stub);
      }
      return stub;
    },
    has(target, prop) {
      return Reflect.has(target, prop);
    },
  });
}

/**
 * Wrap the `app` object handed to plugins so unknown member access is recorded.
 * Known members (including prototype methods and getters) pass through with the
 * real object as receiver, so internal `this` semantics are unchanged.
 */
export function createDiagnosticAppProxy<T extends object>(
  app: T,
  onMiss: ObsidianApiSurfaceMissListener,
  source: ObsidianApiSurface = surface,
): T {
  const reported = new Set<string>();
  const appDeclaration = getObsidianApiSurfaceExport('App', source);
  const declaredMembers = new Map((appDeclaration?.members ?? []).map((member) => [member.name, member]));

  return new Proxy(app, {
    get(target, prop) {
      if (typeof prop === 'symbol' || prop in target || PROBE_KEYS.has(prop)) {
        return Reflect.get(target, prop);
      }
      if (!reported.has(prop)) {
        reported.add(prop);
        try {
          onMiss(missFor('app', `app.${prop}`, declaredMembers.get(prop)));
        } catch {
          // Diagnostics must never break plugin execution.
        }
      }
      return undefined;
    },
    set(target, prop, value) {
      return Reflect.set(target, prop, value);
    },
  });
}

function memberNames(entry: ObsidianApiSurfaceExport | undefined, filter: (member: ObsidianApiSurfaceMember) => boolean): string[] {
  return (entry?.members ?? []).filter(filter).map((member) => member.name);
}

function ownerImplementsMember(owner: unknown, member: ObsidianApiSurfaceMember): boolean {
  if (typeof owner !== 'function') return false;
  if (member.static) return member.name in owner;
  const prototype = (owner as { prototype?: object }).prototype;
  return Boolean(prototype) && member.name in (prototype as object);
}

function matrixRowIsDeclared(api: string, source: ObsidianApiSurface, memberIndex: Set<string>): boolean {
  if (api.startsWith('module:')) return true;
  if (api.includes('.')) {
    const [owner, ...rest] = api.split('.');
    const member = rest.join('.');
    const entry = owner ? getObsidianApiSurfaceExport(owner, source) : undefined;
    if (!entry) return false;
    return (entry.members ?? []).some((item) => item.name === member);
  }
  return Boolean(getObsidianApiSurfaceExport(api, source)) || memberIndex.has(api);
}

/**
 * Compare the shim against the declared surface.
 *
 * Member comparison is limited to methods (and static methods) because instance
 * properties are assigned in constructors and cannot be observed on prototypes.
 * `App` is compared against a live instance when one is supplied.
 */
export function diffObsidianApiSurface(input: DiffObsidianApiSurfaceInput): ObsidianApiSurfaceDiff {
  const source = input.surface ?? surface;
  const valueExports = source.exports.filter((entry) => isObsidianApiSurfaceValueKind(entry.kind));
  const implemented: string[] = [];
  const missing: ObsidianApiSurfaceMissingExport[] = [];
  const members: ObsidianApiSurfaceMemberDiff[] = [];

  for (const entry of valueExports) {
    const value = input.module[entry.name];
    if (value === undefined) {
      missing.push({
        name: entry.name,
        kind: entry.kind,
        ...(entry.since ? { since: entry.since } : {}),
        ...(entry.deprecated ? { deprecated: true } : {}),
      });
      continue;
    }
    implemented.push(entry.name);

    if (entry.kind !== 'class' && entry.kind !== 'abstract-class') continue;
    const declaredMethods = (entry.members ?? []).filter((member) => member.kind === 'method');
    if (declaredMethods.length === 0) continue;
    const implementedMethods = declaredMethods.filter((member) => ownerImplementsMember(value, member)).map((member) => member.name);
    const missingMethods = declaredMethods.filter((member) => !ownerImplementsMember(value, member)).map((member) => member.name);
    members.push({ owner: entry.name, declared: declaredMethods.length, implemented: implementedMethods, missing: missingMethods });
  }

  if (input.app) {
    const appEntry = getObsidianApiSurfaceExport('App', source);
    const declared = (appEntry?.members ?? []).filter((member) => member.kind === 'method' || member.kind === 'property');
    const present = declared.filter((member) => member.name in input.app!).map((member) => member.name);
    members.unshift({
      owner: 'App',
      declared: declared.length,
      implemented: present,
      missing: declared.filter((member) => !present.includes(member.name)).map((member) => member.name),
    });
  }

  const declaredNames = new Set(source.exports.map((entry) => entry.name));
  const shimOnly = Object.keys(input.module).filter((name) => !declaredNames.has(name)).sort((a, b) => a.localeCompare(b, 'en'));

  const memberIndex = new Set<string>();
  for (const entry of source.exports) {
    for (const name of memberNames(entry, () => true)) memberIndex.add(name);
  }
  const undeclaredRows = Array.from(new Set(input.matrixApis ?? []))
    .filter((api) => !matrixRowIsDeclared(api, source, memberIndex))
    .sort((a, b) => a.localeCompare(b, 'en'));

  return {
    source: source.source,
    exports: {
      declared: valueExports.length,
      implemented,
      missing,
      shimOnly,
    },
    members,
    matrix: { undeclaredRows },
  };
}

export function renderObsidianApiSurfaceDiffMarkdown(diff: ObsidianApiSurfaceDiff): string {
  const lines: string[] = [
    '# Obsidian API Surface Coverage',
    '',
    `> Source: ${diff.source.repo}@${diff.source.commit ?? diff.source.ref} (obsidian.d.ts ${diff.source.apiVersion ?? 'unknown version'})`,
    '',
    '## Exports',
    '',
    '| Metric | Count |',
    '|---|---:|',
    `| Declared runtime exports | ${diff.exports.declared} |`,
    `| Implemented by shim | ${diff.exports.implemented.length} |`,
    `| Missing from shim | ${diff.exports.missing.length} |`,
    `| Shim-only exports | ${diff.exports.shimOnly.length} |`,
    '',
    '### Missing exports',
    '',
  ];
  if (diff.exports.missing.length === 0) lines.push('- none');
  for (const item of diff.exports.missing) {
    lines.push(`- \`${item.name}\` (${item.kind}${item.since ? `, since ${item.since}` : ''}${item.deprecated ? ', deprecated' : ''})`);
  }
  lines.push('', '## Methods by class', '', '| Class | Declared | Implemented | Missing |', '|---|---:|---:|---|');
  for (const item of diff.members) {
    lines.push(`| ${item.owner} | ${item.declared} | ${item.implemented.length} | ${item.missing.slice(0, 12).join(', ')}${item.missing.length > 12 ? ', …' : ''} |`);
  }
  lines.push('', '## Capability matrix rows outside obsidian.d.ts', '');
  if (diff.matrix.undeclaredRows.length === 0) lines.push('- none');
  for (const api of diff.matrix.undeclaredRows) lines.push(`- \`${api}\``);
  return `${lines.join('\n').trimEnd()}\n`;
}
