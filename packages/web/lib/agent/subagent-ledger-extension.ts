/**
 * MindOS subagent ledger extension — web host entry (Wave 4,
 * spec-agent-core-consolidation).
 *
 * The ledger wrapping, orchestration routing, and async-completion logic
 * live in the core package (@geminilight/mindos/agent/subagent-ledger-extension).
 * This file stays a real pi extension entry: the pi DefaultResourceLoader
 * imports it by file path (see mindos-pi-runtime-host.ts), so it must keep a
 * default export. It owns the one host-specific concern — loading the
 * upstream pi-subagents extension out of this web app's node_modules via
 * jiti (the upstream package ships TypeScript sources, not compiled JS).
 */
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import type { ExtensionAPI } from '@earendil-works/pi-coding-agent';
import { createJiti } from 'jiti/static';
import {
  createMindosSubagentLedgerExtension,
  type RegisterSubagentExtension,
} from '@geminilight/mindos/agent/subagent-ledger-extension';

export {
  finalizeSubagentAsyncRunFromEvent,
  wrapSubagentToolForLedger,
  type ToolWithRuntimeContext,
} from '@geminilight/mindos/agent/subagent-ledger-extension';

async function loadUpstreamSubagentExtension(): Promise<RegisterSubagentExtension> {
  const currentDir = path.dirname(fileURLToPath(import.meta.url));
  const webAppDir = path.resolve(currentDir, '..', '..');
  const upstreamPath = path.join(webAppDir, 'node_modules', 'pi-subagents', 'src', 'extension', 'index.ts');
  const upstreamRealPath = fs.realpathSync(upstreamPath);
  const jiti = createJiti(upstreamRealPath, {
    moduleCache: false,
    tryNative: false,
  });
  const register = await jiti.import(upstreamRealPath, { default: true });
  if (typeof register !== 'function') {
    throw new Error('pi-subagents did not export an extension factory.');
  }
  return register as RegisterSubagentExtension;
}

const extension = createMindosSubagentLedgerExtension({ loadUpstreamSubagentExtension });

export default function mindosSubagentLedgerExtension(pi: ExtensionAPI): Promise<void> {
  return extension(pi);
}
