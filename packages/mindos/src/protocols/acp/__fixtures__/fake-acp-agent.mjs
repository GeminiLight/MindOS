#!/usr/bin/env node

import * as acp from '@agentclientprotocol/sdk';
import { Readable, Writable } from 'node:stream';
import crypto from 'node:crypto';

// Test knobs: FAKE_ACP_HANG lists RPC methods that must never answer
// (initialize, authenticate, session/new, session/prompt, session/close);
// FAKE_ACP_AUTH_REQUIRED=1 makes session/new fail with -32000 until the
// client has called authenticate; FAKE_ACP_LOAD_SESSION=1 declares
// `loadSession: true` and implements `session/load` so a pooled session can be
// resumed (used to prove "one spawn across two turns" over real stdio).
const HANG = new Set(
  (process.env.FAKE_ACP_HANG ?? '').split(',').map((entry) => entry.trim()).filter(Boolean),
);
const AUTH_REQUIRED = process.env.FAKE_ACP_AUTH_REQUIRED === '1';
const LOAD_SESSION = process.env.FAKE_ACP_LOAD_SESSION === '1';
const hangForever = () => new Promise(() => {});

class FakeAcpAgent {
  constructor(connection) {
    this.connection = connection;
    this.sessions = new Map();
    this.authenticated = false;
  }

  async initialize() {
    if (HANG.has('initialize')) return hangForever();
    return {
      protocolVersion: acp.PROTOCOL_VERSION,
      agentCapabilities: {
        loadSession: LOAD_SESSION,
        sessionCapabilities: {
          close: {},
        },
      },
      ...(AUTH_REQUIRED ? { authMethods: [{ id: 'fake-login', name: 'Fake login' }] } : {}),
    };
  }

  async newSession(params) {
    if (HANG.has('session/new')) return hangForever();
    if (AUTH_REQUIRED && !this.authenticated) throw acp.RequestError.authRequired();
    const sessionId = `fake-${crypto.randomBytes(8).toString('hex')}`;
    const state = {
      cwd: params.cwd,
      mode: 'default',
      model: 'cheap',
      thought: 'low',
      pendingPrompt: null,
    };
    this.sessions.set(sessionId, state);
    return {
      sessionId,
      modes: {
        availableModes: [
          { id: 'default', name: 'Default' },
          { id: 'code', name: 'Code' },
        ],
        currentModeId: state.mode,
      },
      configOptions: this.configOptions(state),
    };
  }

  async authenticate() {
    if (HANG.has('authenticate')) return hangForever();
    this.authenticated = true;
    return {};
  }

  async loadSession(params) {
    if (HANG.has('session/load')) return hangForever();
    const sessionId = params.sessionId;
    // Re-establish a session created earlier on this same (pooled) process; if
    // the process respawned, recreate minimal state so the resume succeeds.
    if (!this.sessions.has(sessionId)) {
      this.sessions.set(sessionId, {
        cwd: params.cwd,
        mode: 'default',
        model: 'cheap',
        thought: 'low',
        pendingPrompt: null,
      });
    }
    const state = this.sessions.get(sessionId);
    return {
      modes: {
        availableModes: [
          { id: 'default', name: 'Default' },
          { id: 'code', name: 'Code' },
        ],
        currentModeId: state.mode,
      },
      configOptions: this.configOptions(state),
    };
  }

  async setSessionMode(params) {
    const state = this.requireSession(params.sessionId);
    state.mode = params.modeId;
    return {};
  }

  async setSessionConfigOption(params) {
    const state = this.requireSession(params.sessionId);
    if (params.configId === 'model') state.model = params.value;
    if (params.configId === 'reasoning_effort') state.thought = params.value;
    if (params.configId === 'mode') state.mode = params.value;
    return { configOptions: this.configOptions(state) };
  }

  async prompt(params) {
    if (HANG.has('session/prompt')) return hangForever();
    const state = this.requireSession(params.sessionId);
    state.pendingPrompt?.abort();
    state.pendingPrompt = new AbortController();
    await this.connection.sessionUpdate({
      sessionId: params.sessionId,
      update: {
        sessionUpdate: 'available_commands_update',
        availableCommands: [
          { name: 'plan', description: 'Create a short implementation plan' },
          { name: 'inspect', description: 'Inspect the current project state' },
        ],
      },
    });
    await this.connection.sessionUpdate({
      sessionId: params.sessionId,
      update: {
        sessionUpdate: 'current_mode_update',
        currentModeId: state.mode,
      },
    });
    await this.connection.sessionUpdate({
      sessionId: params.sessionId,
      update: {
        sessionUpdate: 'config_option_update',
        configOptions: this.configOptions(state),
      },
    });
    await this.connection.sessionUpdate({
      sessionId: params.sessionId,
      update: {
        sessionUpdate: 'tool_call',
        toolCallId: 'fake-tool-1',
        title: 'Inspect workspace',
        kind: 'read',
        status: 'pending',
      },
    });
    await this.connection.requestPermission({
      sessionId: params.sessionId,
      toolCall: {
        toolCallId: 'fake-tool-1',
        title: 'Inspect workspace',
        kind: 'read',
        status: 'pending',
      },
      options: [
        { optionId: 'allow', kind: 'allow_once', name: 'Allow once' },
        { optionId: 'reject', kind: 'reject_once', name: 'Reject once' },
      ],
    });
    await this.connection.sessionUpdate({
      sessionId: params.sessionId,
      update: {
        sessionUpdate: 'tool_call_update',
        toolCallId: 'fake-tool-1',
        status: 'completed',
        rawOutput: { ok: true },
      },
    });
    await this.connection.sessionUpdate({
      sessionId: params.sessionId,
      update: {
        sessionUpdate: 'agent_message_chunk',
        content: {
          type: 'text',
          text: `fake acp ok: ${state.mode}/${state.model}/${state.thought}`,
        },
      },
    });
    await this.connection.sessionUpdate({
      sessionId: params.sessionId,
      update: {
        sessionUpdate: 'session_info_update',
        title: 'Fake ACP Smoke Session',
        updatedAt: new Date().toISOString(),
      },
    });
    state.pendingPrompt = null;
    return { stopReason: 'end_turn' };
  }

  async cancel(params) {
    this.sessions.get(params.sessionId)?.pendingPrompt?.abort();
  }

  async closeSession(params) {
    if (HANG.has('session/close')) return hangForever();
    this.sessions.delete(params.sessionId);
    return {};
  }

  configOptions(state) {
    return [
      {
        type: 'select',
        id: 'model',
        name: 'Model',
        category: 'model',
        currentValue: state.model,
        options: [
          { value: 'cheap', name: 'Cheap' },
          { value: 'smart', name: 'Smart' },
        ],
      },
      {
        type: 'select',
        id: 'reasoning_effort',
        name: 'Thought',
        category: 'thought_level',
        currentValue: state.thought,
        options: [
          { value: 'low', name: 'Low' },
          { value: 'high', name: 'High' },
        ],
      },
      {
        type: 'select',
        id: 'mode',
        name: 'Mode',
        category: 'mode',
        currentValue: state.mode,
        options: [
          { value: 'default', name: 'Default' },
          { value: 'code', name: 'Code' },
        ],
      },
    ];
  }

  requireSession(sessionId) {
    const state = this.sessions.get(sessionId);
    if (!state) throw new Error(`Unknown session: ${sessionId}`);
    return state;
  }
}

const input = Writable.toWeb(process.stdout);
const output = Readable.toWeb(process.stdin);
const stream = acp.ndJsonStream(input, output);
new acp.AgentSideConnection((connection) => new FakeAcpAgent(connection), stream);
