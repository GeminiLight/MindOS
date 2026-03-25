#!/usr/bin/env node
/**
 * One-shot migration helper:
 * Import legacy Agent-Audit.md and .agent-log.json into .mindos/agent-audit-log.json.
 *
 * Usage:
 *   node scripts/migrate-agent-audit-log.js --mind-root /abs/path/to/mindRoot
 */

import fs from 'fs';
import path from 'path';

const MAX_EVENTS = 1000;

function parseArgs(argv) {
  let mindRoot = '';
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--mind-root') {
      mindRoot = argv[i + 1] || '';
      i += 1;
    }
  }
  return { mindRoot };
}

function nowIso() {
  return new Date().toISOString();
}

function validIso(ts) {
  if (typeof ts !== 'string') return nowIso();
  const ms = new Date(ts).getTime();
  return Number.isFinite(ms) ? new Date(ms).toISOString() : nowIso();
}

function normalizeMessage(message) {
  if (typeof message !== 'string') return undefined;
  return message.slice(0, 2000);
}

function readJson(file, fallback) {
  try {
    if (!fs.existsSync(file)) return fallback;
    return JSON.parse(fs.readFileSync(file, 'utf-8'));
  } catch {
    return fallback;
  }
}

function parseMdBlocks(raw) {
  const blocks = [];
  const re = /```agent-op\s*\n([\s\S]*?)```/g;
  let match;
  while ((match = re.exec(raw)) !== null) {
    try {
      blocks.push(JSON.parse(match[1].trim()));
    } catch {
      // Keep migration best-effort.
    }
  }
  return blocks;
}

function parseJsonLines(raw) {
  const lines = [];
  for (const line of raw.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#') || trimmed.startsWith('//')) continue;
    try {
      lines.push(JSON.parse(trimmed));
    } catch {
      // Ignore malformed line.
    }
  }
  return lines;
}

function toEvent(entry, op, idx) {
  const tool = typeof entry?.tool === 'string' && entry.tool.trim() ? entry.tool.trim() : 'unknown-tool';
  return {
    id: `legacy-script-${Date.now().toString(36)}-${idx.toString(36)}`,
    ts: validIso(entry?.ts),
    tool,
    params: entry?.params && typeof entry.params === 'object' ? entry.params : {},
    result: entry?.result === 'error' ? 'error' : 'ok',
    message: normalizeMessage(entry?.message),
    durationMs: typeof entry?.durationMs === 'number' ? entry.durationMs : undefined,
    op,
  };
}

function main() {
  const { mindRoot } = parseArgs(process.argv.slice(2));
  if (!mindRoot) {
    console.error('Missing --mind-root');
    process.exit(1);
  }
  const root = path.resolve(mindRoot);
  if (!fs.existsSync(root) || !fs.statSync(root).isDirectory()) {
    console.error('Invalid mind root:', root);
    process.exit(1);
  }

  const legacyMd = path.join(root, 'Agent-Audit.md');
  const legacyJsonl = path.join(root, '.agent-log.json');
  if (!fs.existsSync(legacyMd) && !fs.existsSync(legacyJsonl)) {
    console.log('No legacy Agent-Audit.md or .agent-log.json found. Nothing to migrate.');
    return;
  }

  const logDir = path.join(root, '.mindos');
  const logFile = path.join(logDir, 'agent-audit-log.json');
  const state = readJson(logFile, {
    version: 1,
    events: [],
    legacy: { mdImportedCount: 0, jsonlImportedCount: 0, lastImportedAt: null },
  });
  const baseEvents = Array.isArray(state.events) ? state.events : [];
  const legacy = {
    mdImportedCount: Number(state?.legacy?.mdImportedCount || 0),
    jsonlImportedCount: Number(state?.legacy?.jsonlImportedCount || 0),
    lastImportedAt: typeof state?.legacy?.lastImportedAt === 'string' ? state.legacy.lastImportedAt : null,
  };

  const imported = [];

  if (fs.existsSync(legacyMd)) {
    const blocks = parseMdBlocks(fs.readFileSync(legacyMd, 'utf-8'));
    if (blocks.length > legacy.mdImportedCount) {
      const incoming = blocks.slice(legacy.mdImportedCount);
      imported.push(...incoming.map((entry, idx) => toEvent(entry, 'legacy_agent_audit_md_import', idx)));
      legacy.mdImportedCount = blocks.length;
      legacy.lastImportedAt = nowIso();
    }
    if (blocks.length > 0) fs.rmSync(legacyMd, { force: true });
  }

  if (fs.existsSync(legacyJsonl)) {
    const lines = parseJsonLines(fs.readFileSync(legacyJsonl, 'utf-8'));
    if (lines.length > legacy.jsonlImportedCount) {
      const incoming = lines.slice(legacy.jsonlImportedCount);
      imported.push(...incoming.map((entry, idx) => toEvent(entry, 'legacy_agent_log_jsonl_import', idx)));
      legacy.jsonlImportedCount = lines.length;
      legacy.lastImportedAt = nowIso();
    }
    if (lines.length > 0) fs.rmSync(legacyJsonl, { force: true });
  }

  if (imported.length === 0) {
    console.log('No new legacy entries to import.');
    return;
  }

  const merged = [...baseEvents, ...imported]
    .sort((a, b) => new Date(b.ts).getTime() - new Date(a.ts).getTime())
    .slice(0, MAX_EVENTS);

  const next = {
    version: 1,
    events: merged,
    legacy,
  };

  fs.mkdirSync(logDir, { recursive: true });
  fs.writeFileSync(logFile, JSON.stringify(next, null, 2), 'utf-8');
  console.log(`Imported ${imported.length} legacy entry(s) into ${logFile}`);
}

main();

