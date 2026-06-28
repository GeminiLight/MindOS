import { describe, expect, it } from 'vitest';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { AcpRegistryEntry } from './types.js';
import {
  closeSession,
  createSessionFromEntry,
  getSessionSnapshot,
  promptStream,
  setConfigOption,
  setMode,
} from './session.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

function fakeAgentEntry(): AcpRegistryEntry {
  return {
    id: 'fake-acp-smoke',
    name: 'Fake ACP Smoke',
    description: 'Local fake ACP agent used for stdio admission tests',
    transport: 'binary',
    command: process.execPath,
    args: [path.join(__dirname, '__fixtures__', 'fake-acp-agent.mjs')],
  };
}

describe('ACP stdio smoke', () => {
  it('projects real ACP session controls, commands, tools, and permission events', async () => {
    const session = await createSessionFromEntry(fakeAgentEntry(), {
      cwd: process.cwd(),
      permissionMode: 'auto',
    });
    try {
      let snapshot = getSessionSnapshot(session.id);
      expect(snapshot).toMatchObject({
        agentId: 'fake-acp-smoke',
        controls: {
          model: {
            status: 'available',
            configId: 'model',
            currentValue: 'cheap',
            options: [
              { id: 'cheap', label: 'Cheap' },
              { id: 'smart', label: 'Smart' },
            ],
          },
          thoughtLevel: {
            status: 'available',
            configId: 'reasoning_effort',
            currentValue: 'low',
          },
          mode: {
            status: 'available',
            currentValue: 'default',
          },
        },
      });

      await setMode(session.id, 'code');
      await setConfigOption(session.id, 'model', 'smart');
      await setConfigOption(session.id, 'reasoning_effort', 'high');

      const updates: string[] = [];
      const response = await promptStream(session.id, 'hello fake acp', (update) => {
        updates.push(update.type);
      });

      expect(response.text).toContain('fake acp ok: code/smart/high');
      expect(updates).toEqual(expect.arrayContaining([
        'available_commands_update',
        'current_mode_update',
        'config_option_update',
        'tool_call',
        'permission_request',
        'permission_resolved',
        'tool_call_update',
        'agent_message_chunk',
        'session_info_update',
        'done',
      ]));

      snapshot = getSessionSnapshot(session.id);
      expect(snapshot?.controls.model.currentValue).toBe('smart');
      expect(snapshot?.controls.thoughtLevel.currentValue).toBe('high');
      expect(snapshot?.controls.mode.currentValue).toBe('code');
      expect(snapshot?.availableCommands.map((command) => command.name)).toEqual(['plan', 'inspect']);
      expect(snapshot?.toolSummary).toMatchObject({
        total: 1,
        completed: 1,
      });
      expect(snapshot?.permissionEvents).toHaveLength(1);
      expect(snapshot?.permissionEvents[0]).toMatchObject({
        status: 'resolved',
        toolCallId: 'fake-tool-1',
        toolName: 'Inspect workspace',
        selectedOptionId: 'allow',
        outcome: 'allow_once',
      });
      expect(snapshot?.pendingPermissions).toEqual([]);
      expect(snapshot?.sessionInfo?.title).toBe('Fake ACP Smoke Session');
    } finally {
      await closeSession(session.id);
    }
  });
});
