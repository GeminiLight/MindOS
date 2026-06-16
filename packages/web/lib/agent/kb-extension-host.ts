// Registers the web toolkit as the KB extension host (webpack module graph).
//
// The kb-extension.ts entry file is loaded by pi's jiti loader, which cannot
// resolve '@/' imports — so the entry reads the toolkit back from the
// process-global slot this registration fills. Must run before
// resourceLoader.reload(); getMindosWebPiRuntimePaths() calls it on every
// request (idempotent).

import { registerMindosKbExtensionHost } from '@geminilight/mindos/agent/tool/kb-extension';
import { getToolsForMindosAgentPolicy } from './tools';
import { logAgentOp } from './log';

export function registerWebKbExtensionHost(): void {
  registerMindosKbExtensionHost({
    getToolsForPolicy: getToolsForMindosAgentPolicy,
    logAgentOp,
  });
}
