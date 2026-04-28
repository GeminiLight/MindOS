#!/usr/bin/env node
/**
 * One-shot migration helper:
 * Import legacy Agent-Diff.md ```agent-diff blocks into .mindos/change-log.json.
 *
 * Usage:
 *   node scripts/migrate-agent-diff.js --mind-root /abs/path/to/mindRoot
 */

import fs from 'fs';
import path from 'path';

const MAX_EVENTS = 500;
const MAX_TEXT_CHARS = 12_000;

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

function normalizeText(value) {
  if (typeof value !== 'string') return { value: undefined, truncated: false };
  if (value.length <= MAX_TEXT_CHARS) return { value, truncated: false };
  return { value: value.slice(0, MAX_TEXT_CHARS), truncated: true };
}

function nowIso() {
  return new Date().toISOString();
}

function validIso(ts) {
  if (typeof ts !== 'string') return nowIso();
  const ms = new Date(ts).getTime();
  return Number.isFinite(ms) ? new Date(ms).toISOString() : nowIso();
}

function parseLegacyBlocks(raw) {
  const blocks = [];
  const re = /```agent-diff\s*\n([\s\S]*?)```/g;
  let m;
  while ((m = re.exec(raw)) !== null) {
    try {
      blocks.push(JSON.parse(m[1].trim()));
    } catch {
      // Keep migration best-effort.
    }
  }
  return blocks;
}

function readJson(file, fallback) {
  try {
    if (!fs.existsSync(file)) return fallback;
    return JSON.parse(fs.readFileSync(file, 'utf-8'));
  } catch {
    return fallback;
  }
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

  const legacyFile = path.join(root, 'Agent-Diff.md');
  if (!fs.existsSync(legacyFile)) {
    console.log('No Agent-Diff.md found. Nothing to migrate.');
    return;
  }

  const logDir = path.join(root, '.mindos');
  const logFile = path.join(logDir, 'change-log.json');
  const state = readJson(logFile, {
    version: 1,
    lastSeenAt: null,
    events: [],
    legacy: { agentDiffImportedCount: 0, lastImportedAt: null },
  });

  const raw = fs.readFileSync(legacyFile, 'utf-8');
  const blocks = parseLegacyBlocks(raw);
  const importedCount = Number(state?.legacy?.agentDiffImportedCount || 0);
  if (blocks.length <= importedCount) {
    if (blocks.length > 0) {
      fs.rmSync(legacyFile, { force: true });
      console.log('Legacy Agent-Diff.md already migrated; removed legacy file.');
      return;
    }
    console.log('No new legacy blocks to import.');
    return;
  }

  const incoming = blocks.slice(importedCount);
  const imported = incoming.map((entry, idx) => {
    const before = normalizeText(entry?.before);
    const after = normalizeText(entry?.after);
    const tool = typeof entry?.tool === 'string' && entry.tool.trim() ? entry.tool.trim() : 'unknown-tool';
    const targetPath = typeof entry?.path === 'string' && entry.path.trim() ? entry.path : 'Agent-Diff.md';
    return {
      id: `legacy-script-${Date.now().toString(36)}-${idx.toString(36)}`,
      ts: validIso(entry?.ts),
      op: 'legacy_agent_diff_import',
      path: targetPath,
      source: 'agent',
      summary: `Imported legacy agent diff (${tool})`,
      before: before.value,
      after: after.value,
      truncated: before.truncated || after.truncated || undefined,
    };
  });

  const merged = [...(Array.isArray(state.events) ? state.events : []), ...imported].sort(
    (a, b) => new Date(b.ts).getTime() - new Date(a.ts).getTime(),
  ).slice(0, MAX_EVENTS);

  const next = {
    version: 1,
    lastSeenAt: typeof state.lastSeenAt === 'string' ? state.lastSeenAt : null,
    events: merged,
    legacy: {
      agentDiffImportedCount: blocks.length,
      lastImportedAt: nowIso(),
    },
  };

  fs.mkdirSync(logDir, { recursive: true });
  fs.writeFileSync(logFile, JSON.stringify(next, null, 2), 'utf-8');
  fs.rmSync(legacyFile, { force: true });
  console.log(`Imported ${imported.length} legacy block(s) into ${logFile}`);
  console.log('Removed legacy Agent-Diff.md');
}

main();
