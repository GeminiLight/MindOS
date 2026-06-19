import type { CodexThreadManagerServices } from '@geminilight/mindos/server';
import { readSettings } from '@/lib/settings';
import { resolveCommandPath, resolveCommandPathCandidates } from '@/lib/acp/detect-local';

export const codexThreadServices: CodexThreadManagerServices = {
  readSettings: readSettings as CodexThreadManagerServices['readSettings'],
  resolveRuntimeCommand: resolveCommandPath,
  resolveRuntimeCommandCandidates: resolveCommandPathCandidates,
};
