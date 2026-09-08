#!/usr/bin/env node
/**
 * Generate the Obsidian API surface snapshot from the official `obsidian.d.ts`.
 *
 * The snapshot is the source of truth for "what Obsidian declares"; the shim
 * (`createObsidianModule()`) and `AppShim` are compared against it at test time
 * and at plugin load time, so unimplemented APIs fail with a typed, ledgered
 * error instead of an opaque `undefined is not a constructor`.
 *
 * Usage:
 *   pnpm run obsidian:api-surface                  # fetch master and regenerate
 *   pnpm run obsidian:api-surface -- --ref 1.13.2  # pin a tag
 *   pnpm run obsidian:api-surface -- --input /tmp/obsidian.d.ts --api-version 1.13.2
 */

import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';
import {
  OBSIDIAN_API_SURFACE_SCHEMA_VERSION,
  type ObsidianApiSurface,
  type ObsidianApiSurfaceExport,
  type ObsidianApiSurfaceExportKind,
  type ObsidianApiSurfaceGlobalAugmentation,
  type ObsidianApiSurfaceMember,
  type ObsidianApiSurfaceMemberKind,
} from '@/lib/obsidian-compat/api-surface-types';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const webRoot = path.resolve(__dirname, '..');
const DEFAULT_OUT = path.join(webRoot, 'lib/obsidian-compat/generated/obsidian-api-surface.json');
const SOURCE_REPO = 'obsidianmd/obsidian-api';
const DEFAULT_TIMEOUT_MS = 20_000;

interface CliOptions {
  ref: string;
  input?: string;
  apiVersion?: string;
  out: string;
  timeoutMs: number;
}

function parseArgs(argv: string[]): CliOptions {
  const options: CliOptions = { ref: 'master', out: DEFAULT_OUT, timeoutMs: DEFAULT_TIMEOUT_MS };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    const value = () => {
      const next = argv[index + 1];
      if (!next || next.startsWith('--')) throw new Error(`Missing value for ${arg}`);
      index += 1;
      return next;
    };
    if (arg === '--') continue;
    if (arg === '--ref') options.ref = value();
    else if (arg === '--input') options.input = path.resolve(value());
    else if (arg === '--api-version') options.apiVersion = value();
    else if (arg === '--out') options.out = path.resolve(value());
    else if (arg === '--timeout-ms') options.timeoutMs = Number.parseInt(value(), 10);
    else if (arg === '--help' || arg === '-h') {
      console.log('Usage: generate-obsidian-api-surface [--ref <git-ref>] [--input <obsidian.d.ts>] [--api-version <x.y.z>] [--out <file>]');
      process.exit(0);
    } else throw new Error(`Unknown argument: ${arg}`);
  }
  if (!Number.isInteger(options.timeoutMs) || options.timeoutMs <= 0) throw new Error('--timeout-ms must be a positive integer');
  return options;
}

async function fetchText(url: string, timeoutMs: number): Promise<string> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, { signal: controller.signal });
    if (!response.ok) throw new Error(`HTTP ${response.status} while fetching ${url}`);
    return await response.text();
  } finally {
    clearTimeout(timer);
  }
}

async function resolveCommit(ref: string, timeoutMs: number): Promise<string | null> {
  if (/^[0-9a-f]{40}$/.test(ref)) return ref;
  try {
    const raw = await fetchText(`https://api.github.com/repos/${SOURCE_REPO}/commits/${encodeURIComponent(ref)}`, timeoutMs);
    const parsed = JSON.parse(raw) as { sha?: unknown };
    return typeof parsed.sha === 'string' && /^[0-9a-f]{40}$/.test(parsed.sha) ? parsed.sha : null;
  } catch {
    return null;
  }
}

function hasModifier(node: ts.Node, kind: ts.SyntaxKind): boolean {
  return ts.canHaveModifiers(node) && (ts.getModifiers(node) ?? []).some((modifier) => modifier.kind === kind);
}

function jsDocTag(node: ts.Node, tagName: string): { present: boolean; text?: string } {
  for (const tag of ts.getJSDocTags(node)) {
    if (tag.tagName.text !== tagName) continue;
    const text = ts.getTextOfJSDocComment(tag.comment)?.trim();
    return { present: true, ...(text ? { text } : {}) };
  }
  return { present: false };
}

function memberName(name: ts.PropertyName | undefined): string | null {
  if (!name) return null;
  if (ts.isIdentifier(name) || ts.isPrivateIdentifier(name)) return name.text;
  if (ts.isStringLiteral(name) || ts.isNumericLiteral(name)) return name.text;
  if (ts.isComputedPropertyName(name)) return name.expression.getText();
  return null;
}

function compareMembers(a: ObsidianApiSurfaceMember, b: ObsidianApiSurfaceMember): number {
  if (Boolean(a.static) !== Boolean(b.static)) return a.static ? 1 : -1;
  return a.name.localeCompare(b.name, 'en');
}

function collectMembers(members: ts.NodeArray<ts.ClassElement | ts.TypeElement>): ObsidianApiSurfaceMember[] {
  const byName = new Map<string, ObsidianApiSurfaceMember>();
  for (const member of members) {
    let kind: ObsidianApiSurfaceMemberKind;
    if (ts.isConstructorDeclaration(member) || ts.isConstructSignatureDeclaration(member)) kind = 'constructor';
    else if (ts.isMethodDeclaration(member) || ts.isMethodSignature(member)) kind = 'method';
    else if (ts.isPropertyDeclaration(member) || ts.isPropertySignature(member)) kind = 'property';
    else if (ts.isGetAccessorDeclaration(member) || ts.isSetAccessorDeclaration(member)) kind = 'accessor';
    else if (ts.isIndexSignatureDeclaration(member)) kind = 'index-signature';
    else if (ts.isCallSignatureDeclaration(member)) kind = 'call-signature';
    else continue;

    const name = kind === 'constructor'
      ? 'constructor'
      : kind === 'index-signature' || kind === 'call-signature'
        ? `[${kind}]`
        : memberName((member as ts.ClassElement | ts.TypeElement).name);
    if (!name) continue;
    if (hasModifier(member, ts.SyntaxKind.PrivateKeyword) || name.startsWith('#')) continue;

    const deprecated = jsDocTag(member, 'deprecated');
    const since = jsDocTag(member, 'since');
    const isStatic = hasModifier(member, ts.SyntaxKind.StaticKeyword);
    const key = `${isStatic ? 'static:' : ''}${name}`;
    const existing = byName.get(key);
    const entry: ObsidianApiSurfaceMember = {
      name,
      kind,
      ...(isStatic ? { static: true } : {}),
      ...((member as { questionToken?: ts.Node }).questionToken ? { optional: true } : {}),
      ...(hasModifier(member, ts.SyntaxKind.AbstractKeyword) ? { abstract: true } : {}),
      ...(deprecated.present ? { deprecated: true } : {}),
      ...(since.text ? { since: since.text } : {}),
    };
    // Overloads collapse into one entry; the first declaration wins for tags.
    byName.set(key, existing ? { ...entry, ...existing } : entry);
  }
  return [...byName.values()].sort(compareMembers);
}

function heritage(node: ts.ClassDeclaration | ts.InterfaceDeclaration): { extends?: string[]; implements?: string[] } {
  const result: { extends?: string[]; implements?: string[] } = {};
  for (const clause of node.heritageClauses ?? []) {
    const names = clause.types.map((type) => type.expression.getText());
    if (clause.token === ts.SyntaxKind.ExtendsKeyword) result.extends = names;
    if (clause.token === ts.SyntaxKind.ImplementsKeyword) result.implements = names;
  }
  return result;
}

export function extractObsidianApiSurface(text: string): Pick<ObsidianApiSurface, 'exports' | 'globals'> {
  const sourceFile = ts.createSourceFile('obsidian.d.ts', text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  const exportsByName = new Map<string, ObsidianApiSurfaceExport>();
  const globals: ObsidianApiSurfaceGlobalAugmentation[] = [];
  const valueKinds: ObsidianApiSurfaceExportKind[] = ['class', 'abstract-class', 'function', 'const', 'let', 'enum'];

  const record = (entry: ObsidianApiSurfaceExport) => {
    const existing = exportsByName.get(entry.name);
    if (!existing) {
      exportsByName.set(entry.name, entry);
      return;
    }
    // Declaration merging (interface + class with the same name): keep the value kind and union members.
    const primary = valueKinds.includes(existing.kind) ? existing : entry;
    const secondary = primary === existing ? entry : existing;
    const merged = new Map<string, ObsidianApiSurfaceMember>();
    for (const member of [...(primary.members ?? []), ...(secondary.members ?? [])]) {
      const key = `${member.static ? 'static:' : ''}${member.name}`;
      if (!merged.has(key)) merged.set(key, member);
    }
    exportsByName.set(entry.name, {
      ...secondary,
      ...primary,
      ...(merged.size > 0 ? { members: [...merged.values()].sort(compareMembers) } : {}),
    });
  };

  for (const statement of sourceFile.statements) {
    if (ts.isModuleDeclaration(statement) && statement.name.getText() === 'global' && statement.body && ts.isModuleBlock(statement.body)) {
      for (const inner of statement.body.statements) {
        if (ts.isInterfaceDeclaration(inner)) {
          globals.push({ target: inner.name.text, members: collectMembers(inner.members) });
        }
      }
      continue;
    }
    if (!hasModifier(statement, ts.SyntaxKind.ExportKeyword)) continue;

    const deprecated = jsDocTag(statement, 'deprecated');
    const since = jsDocTag(statement, 'since');
    const tags = {
      ...(deprecated.present ? { deprecated: true as const } : {}),
      ...(since.text ? { since: since.text } : {}),
    };

    if (ts.isClassDeclaration(statement) && statement.name) {
      record({
        name: statement.name.text,
        kind: hasModifier(statement, ts.SyntaxKind.AbstractKeyword) ? 'abstract-class' : 'class',
        ...heritage(statement),
        members: collectMembers(statement.members),
        ...tags,
      });
    } else if (ts.isInterfaceDeclaration(statement)) {
      record({ name: statement.name.text, kind: 'interface', ...heritage(statement), members: collectMembers(statement.members), ...tags });
    } else if (ts.isFunctionDeclaration(statement) && statement.name) {
      record({ name: statement.name.text, kind: 'function', ...tags });
    } else if (ts.isTypeAliasDeclaration(statement)) {
      record({ name: statement.name.text, kind: 'type', ...tags });
    } else if (ts.isEnumDeclaration(statement)) {
      record({
        name: statement.name.text,
        kind: 'enum',
        members: statement.members
          .map((member) => memberName(member.name))
          .filter((name): name is string => Boolean(name))
          .sort((a, b) => a.localeCompare(b, 'en'))
          .map((name) => ({ name, kind: 'property' as const, static: true as const })),
        ...tags,
      });
    } else if (ts.isVariableStatement(statement)) {
      const isConst = (statement.declarationList.flags & ts.NodeFlags.Const) !== 0;
      for (const declaration of statement.declarationList.declarations) {
        if (!ts.isIdentifier(declaration.name)) continue;
        const typeLiteral = declaration.type && ts.isTypeLiteralNode(declaration.type) ? declaration.type : null;
        record({
          name: declaration.name.text,
          kind: isConst ? 'const' : 'let',
          ...(typeLiteral ? { members: collectMembers(typeLiteral.members) } : {}),
          ...tags,
        });
      }
    }
  }

  return {
    exports: [...exportsByName.values()].sort((a, b) => a.name.localeCompare(b.name, 'en')),
    globals: globals.sort((a, b) => a.target.localeCompare(b.target, 'en')),
  };
}

async function main(): Promise<void> {
  const options = parseArgs(process.argv.slice(2));
  let text: string;
  let commit: string | null = null;
  let apiVersion = options.apiVersion ?? null;

  if (options.input) {
    console.log(`[obsidian-api-surface] Reading ${options.input}`);
    text = fs.readFileSync(options.input, 'utf-8');
    commit = await resolveCommit(options.ref, options.timeoutMs);
  } else {
    commit = await resolveCommit(options.ref, options.timeoutMs);
    const pin = commit ?? options.ref;
    const base = `https://raw.githubusercontent.com/${SOURCE_REPO}/${pin}`;
    console.log(`[obsidian-api-surface] Fetching ${base}/obsidian.d.ts`);
    text = await fetchText(`${base}/obsidian.d.ts`, options.timeoutMs);
    if (!apiVersion) {
      try {
        const pkg = JSON.parse(await fetchText(`${base}/package.json`, options.timeoutMs)) as { version?: unknown };
        apiVersion = typeof pkg.version === 'string' ? pkg.version : null;
      } catch {
        apiVersion = null;
      }
    }
  }

  const { exports, globals } = extractObsidianApiSurface(text);
  const surface: ObsidianApiSurface = {
    schemaVersion: OBSIDIAN_API_SURFACE_SCHEMA_VERSION,
    source: {
      repo: SOURCE_REPO,
      ref: options.ref,
      commit,
      apiVersion,
      file: 'obsidian.d.ts',
      sha256: createHash('sha256').update(text).digest('hex'),
    },
    exports,
    globals,
  };

  fs.mkdirSync(path.dirname(options.out), { recursive: true });
  fs.writeFileSync(options.out, `${JSON.stringify(surface, null, 2)}\n`, 'utf-8');
  const valueExports = exports.filter((entry) => entry.kind !== 'interface' && entry.kind !== 'type');
  console.log(`[obsidian-api-surface] ${exports.length} exports (${valueExports.length} runtime values), ${globals.length} global augmentations`);
  console.log(`[obsidian-api-surface] apiVersion=${apiVersion ?? 'unknown'} commit=${commit ?? 'unresolved'} sha256=${surface.source.sha256.slice(0, 12)}`);
  console.log(`[obsidian-api-surface] Wrote ${path.relative(process.cwd(), options.out)}`);
}

const isDirectRun = process.argv[1] ? path.resolve(process.argv[1]) === fileURLToPath(import.meta.url) : false;
if (isDirectRun) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.stack ?? error.message : error);
    process.exit(1);
  });
}
