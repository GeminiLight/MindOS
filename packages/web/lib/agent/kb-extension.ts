// ─── Knowledge Base Extension (web entry) ────────────────────────────────────
// Sunk into the core package (Wave 3, spec-agent-core-consolidation): policy
// scoping, write-protection, and audit wrapping live in
// packages/mindos/src/agent/tool/kb-extension.ts.
//
// This file must stay a REAL extension entry (default export factory): the pi
// DefaultResourceLoader loads it by file path (mindos-pi-runtime-host.ts) in
// its own jiti module graph, which resolves NO '@/' path aliases. Every import
// here must stay on core-dist subpaths or dependency packages — a webpack-land
// import anywhere in this file's graph makes the entry fail to load and
// silently drops every KB tool (the session runs with noTools: 'builtin').
// The web toolkit arrives through registerWebKbExtensionHost()
// (kb-extension-host.ts), called from getMindosWebPiRuntimePaths() before
// reload(); shared policy state lives behind Symbol.for keys in the core
// package, so route-side setKbMode()/runWithKbPermissionPolicy() and the
// loader-side reload() observe the same policy.

import type { ExtensionAPI } from '@earendil-works/pi-coding-agent';
import { createMindosKbExtensionFromRegisteredHost } from '@geminilight/mindos/agent/tool/kb-extension';

export {
  getEffectiveKbPermissionPolicy,
  runWithKbPermissionPolicy,
  setKbMode,
  setKbPermissionPolicy,
  type KbMode,
} from '@geminilight/mindos/agent/tool/kb-extension';

const kbExtension = createMindosKbExtensionFromRegisteredHost();

export default function (pi: ExtensionAPI) {
  return kbExtension(pi);
}
