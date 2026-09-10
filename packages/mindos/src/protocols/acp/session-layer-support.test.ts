import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import * as acp from './index.js';
import { ACP_SESSION_LAYER_SUPPORT } from '../../agent/runtime/capabilities.js';

/**
 * `ACP_SESSION_LAYER_SUPPORT` is the runtime layer's statement of what this
 * protocol host implements. It must not promise more than the exported
 * session API actually provides, otherwise derived capabilities lie.
 */

const acpDir = dirname(fileURLToPath(import.meta.url));

const SUPPORT_EVIDENCE: Record<keyof typeof ACP_SESSION_LAYER_SUPPORT, string | null> = {
  newSession: 'createSession',
  loadSession: 'loadSession',
  listSessions: 'listSessionsForAgent',
  closeSession: 'closeSession',
  cancelPrompt: 'cancelPrompt',
  mcpInheritance: 'buildAcpSessionMcpInheritancePlan',
  configOptions: 'setConfigOption',
  // Bridged inside subprocess.ts rather than exported as a function.
  requestPermission: null,
  // Not implemented by the session layer today.
  userInput: null,
  fork: null,
  deleteSession: null,
};

describe('ACP session layer support table', () => {
  it('backs every supported entry with an exported session function or a bridge implementation', () => {
    const subprocess = readFileSync(resolve(acpDir, 'subprocess.ts'), 'utf-8');
    for (const [key, supported] of Object.entries(ACP_SESSION_LAYER_SUPPORT) as Array<[keyof typeof ACP_SESSION_LAYER_SUPPORT, boolean]>) {
      const evidence = SUPPORT_EVIDENCE[key];
      if (!supported) {
        expect(evidence, `${key} is marked unsupported but has an export listed as evidence`).toBeNull();
        continue;
      }
      if (evidence) {
        expect(typeof (acp as Record<string, unknown>)[evidence], `${key} claims ${evidence}()`).toBe('function');
        continue;
      }
      expect(key).toBe('requestPermission');
      expect(subprocess).toMatch(/async requestPermission\(/);
    }
  });

  it('does not export session functions for capabilities the table marks unsupported', () => {
    for (const name of ['forkSession', 'deleteSession', 'askUserQuestion']) {
      expect((acp as Record<string, unknown>)[name], `${name} exists; update ACP_SESSION_LAYER_SUPPORT`).toBeUndefined();
    }
  });
});
