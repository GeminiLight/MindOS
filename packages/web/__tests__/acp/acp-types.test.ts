import { describe, it, expect } from 'vitest';
import type {
  AcpStopReason,
  AcpAgentCapabilities,
  AcpMode,
  AcpConfigOption,
  AcpSessionUpdate,
  AcpUpdateType,
  AcpContentBlock,
  AcpToolCallFull,
  AcpPlan,
  AcpSessionInfo,
  AcpAuthMethod,
} from '@/lib/acp/types';

/* ── ContentBlock types ──────────────────────────────────────────────── */

describe('AcpContentBlock types', () => {
  it('text block is valid', () => {
    const block: AcpContentBlock = { type: 'text', text: 'Hello' };
    expect(block.type).toBe('text');
  });

  it('image block is valid', () => {
    const block: AcpContentBlock = { type: 'image', data: 'base64data', mimeType: 'image/png' };
    expect(block.type).toBe('image');
  });

  it('audio block is valid', () => {
    const block: AcpContentBlock = { type: 'audio', data: 'base64data', mimeType: 'audio/wav' };
    expect(block.type).toBe('audio');
  });

  it('resource_link block is valid', () => {
    const block: AcpContentBlock = { type: 'resource_link', uri: 'file:///foo', name: 'foo.ts' };
    expect(block.type).toBe('resource_link');
  });

  it('resource block is valid', () => {
    const block: AcpContentBlock = { type: 'resource', resource: { uri: 'file:///foo', text: 'content' } };
    expect(block.type).toBe('resource');
  });
});

/* ── StopReason ──────────────────────────────────────────────────────── */

describe('AcpStopReason', () => {
  it('all valid values are accepted', () => {
    const valid: AcpStopReason[] = ['end_turn', 'max_tokens', 'max_turn_requests', 'refusal', 'cancelled'];
    expect(valid).toHaveLength(5);
    for (const v of valid) {
      expect(typeof v).toBe('string');
    }
  });
});

/* ── UpdateType — full spec coverage ─────────────────────────────────── */

describe('AcpUpdateType', () => {
  it('has all spec-defined types', () => {
    const specTypes: AcpUpdateType[] = [
      'user_message_chunk',
      'agent_message_chunk',
      'agent_thought_chunk',
      'tool_call',
      'tool_call_update',
      'plan',
      'available_commands_update',
      'current_mode_update',
      'config_option_update',
      'session_info_update',
    ];
    expect(specTypes).toHaveLength(10);
  });

  it('has legacy compat types', () => {
    const legacyTypes: AcpUpdateType[] = ['text', 'tool_result', 'done', 'error'];
    expect(legacyTypes).toHaveLength(4);
  });
});

/* ── ToolCallFull ────────────────────────────────────────────────────── */

describe('AcpToolCallFull', () => {
  it('supports all status values', () => {
    const statuses: AcpToolCallFull['status'][] = ['pending', 'in_progress', 'completed', 'failed'];
    expect(statuses).toHaveLength(4);
  });

  it('supports all kind values', () => {
    const kinds: NonNullable<AcpToolCallFull['kind']>[] = [
      'read', 'edit', 'delete', 'move', 'search', 'execute', 'think', 'fetch', 'switch_mode', 'other',
    ];
    expect(kinds).toHaveLength(10);
  });
});

/* ── Plan ─────────────────────────────────────────────────────────────── */

describe('AcpPlan', () => {
  it('plan entry has required fields', () => {
    const plan: AcpPlan = {
      entries: [
        { content: 'Fix bug', status: 'in_progress', priority: 'high' },
        { content: 'Write tests', status: 'pending', priority: 'medium' },
        { content: 'Update docs', status: 'completed', priority: 'low' },
      ],
    };
    expect(plan.entries).toHaveLength(3);
    expect(plan.entries[0].status).toBe('in_progress');
    expect(plan.entries[2].priority).toBe('low');
  });
});

/* ── Mode & ConfigOption ─────────────────────────────────────────────── */

describe('AcpMode', () => {
  it('mode has required fields', () => {
    const mode: AcpMode = { id: 'code', name: 'Code', description: 'Write code' };
    expect(mode.id).toBe('code');
    expect(mode.name).toBe('Code');
  });
});

describe('AcpConfigOption', () => {
  it('config option has required fields', () => {
    const opt: AcpConfigOption = {
      type: 'select',
      configId: 'model',
      category: 'model',
      currentValue: 'claude-4',
      options: [
        { id: 'claude-4', label: 'Claude 4' },
        { id: 'gpt-5', label: 'GPT-5' },
      ],
    };
    expect(opt.options).toHaveLength(2);
  });
});

/* ── SessionInfo (from list) ─────────────────────────────────────────── */

describe('AcpSessionInfo', () => {
  it('session info has required fields', () => {
    const info: AcpSessionInfo = {
      sessionId: 'ses-123',
      title: 'Debug session',
      cwd: '/home/user/project',
      updatedAt: '2025-01-01T00:00:00Z',
    };
    expect(info.sessionId).toBe('ses-123');
  });
});

/* ── AuthMethod ──────────────────────────────────────────────────────── */

describe('AcpAuthMethod', () => {
  it('auth method has required fields', () => {
    const auth: AcpAuthMethod = { id: 'agent', name: 'Agent Auth' };
    expect(auth.id).toBe('agent');
  });
});

/* ── AgentCapabilities ───────────────────────────────────────────────── */

describe('AcpAgentCapabilities', () => {
  it('supports all capability fields', () => {
    const caps: AcpAgentCapabilities = {
      loadSession: true,
      mcpCapabilities: { http: true, sse: false },
      promptCapabilities: { audio: false, embeddedContext: true, image: true },
      sessionCapabilities: { list: true },
    };
    expect(caps.loadSession).toBe(true);
    expect(caps.sessionCapabilities?.list).toBe(true);
  });
});

/* ── SessionUpdate — all 10 spec types ───────────────────────────────── */

describe('AcpSessionUpdate variants', () => {
  it('agent_message_chunk', () => {
    const update: AcpSessionUpdate = { sessionId: 'ses-1', type: 'agent_message_chunk', text: 'Hello' };
    expect(update.type).toBe('agent_message_chunk');
    expect(update.text).toBe('Hello');
  });

  it('agent_thought_chunk', () => {
    const update: AcpSessionUpdate = { sessionId: 'ses-1', type: 'agent_thought_chunk', text: 'Thinking...' };
    expect(update.type).toBe('agent_thought_chunk');
  });

  it('tool_call with full details', () => {
    const update: AcpSessionUpdate = {
      sessionId: 'ses-1',
      type: 'tool_call',
      toolCall: {
        toolCallId: 'tc-1',
        title: 'Read file',
        kind: 'read',
        status: 'in_progress',
        rawInput: '{"path": "/foo.ts"}',
      },
    };
    expect(update.toolCall?.kind).toBe('read');
    expect(update.toolCall?.status).toBe('in_progress');
  });

  it('tool_call_update', () => {
    const update: AcpSessionUpdate = {
      sessionId: 'ses-1',
      type: 'tool_call_update',
      toolCall: { toolCallId: 'tc-1', status: 'completed', rawOutput: 'file content' },
    };
    expect(update.toolCall?.status).toBe('completed');
  });

  it('plan', () => {
    const update: AcpSessionUpdate = {
      sessionId: 'ses-1',
      type: 'plan',
      plan: { entries: [{ content: 'Step 1', status: 'pending', priority: 'high' }] },
    };
    expect(update.plan?.entries).toHaveLength(1);
  });

  it('available_commands_update', () => {
    const update: AcpSessionUpdate = {
      sessionId: 'ses-1',
      type: 'available_commands_update',
      availableCommands: [{ id: 'cmd-1', label: 'Run tests' }],
    };
    expect(update.availableCommands).toHaveLength(1);
  });

  it('current_mode_update', () => {
    const update: AcpSessionUpdate = {
      sessionId: 'ses-1',
      type: 'current_mode_update',
      currentModeId: 'architect',
    };
    expect(update.currentModeId).toBe('architect');
  });

  it('config_option_update', () => {
    const update: AcpSessionUpdate = {
      sessionId: 'ses-1',
      type: 'config_option_update',
      configOptions: [{
        type: 'select',
        configId: 'model',
        category: 'model',
        currentValue: 'gpt-5',
        options: [{ id: 'gpt-5', label: 'GPT-5' }],
      }],
    };
    expect(update.configOptions?.[0].currentValue).toBe('gpt-5');
  });

  it('session_info_update', () => {
    const update: AcpSessionUpdate = {
      sessionId: 'ses-1',
      type: 'session_info_update',
      sessionInfo: { title: 'Debug session', updatedAt: '2025-01-01' },
    };
    expect(update.sessionInfo?.title).toBe('Debug session');
  });

  it('user_message_chunk', () => {
    const update: AcpSessionUpdate = { sessionId: 'ses-1', type: 'user_message_chunk', text: 'User input' };
    expect(update.type).toBe('user_message_chunk');
  });
});
