import { describe, expect, it } from 'vitest';
import {
  createMindosAgentPermissionPolicy,
  createMindosAgentPermissionPolicyFromContext,
  createMindosKnowledgeWritePermissionPolicy,
  hasMindosExtensionScope,
} from './index.js';

describe('MindOS Pi permission policy', () => {
  it('maps read permission to a read-only tool scope', () => {
    const policy = createMindosAgentPermissionPolicy('read');

    expect(policy).toMatchObject({
      mode: 'read',
      permissionMode: 'read',
      runtimePermissionMode: 'readonly',
      acpPermissionMode: 'readonly',
      toolScope: {
        kbRead: true,
        kbWrite: 'none',
        web: true,
        askUserQuestion: true,
        terminal: false,
        mcp: false,
        subagents: true,
        acpDelegation: false,
        a2aDelegation: false,
        im: false,
        schedule: false,
        userExtensions: false,
      },
    });
    expect(policy.kbToolNames).toEqual([
      'list_files',
      'read_file',
      'read_file_chunk',
      'search',
      'load_skill',
      'get_recent',
      'get_backlinks',
    ]);
    expect(hasMindosExtensionScope(policy, 'subagents')).toBe(true);
  });

  it('maps ask permission to bounded KB writes with safe delegation extension scopes', () => {
    const policy = createMindosAgentPermissionPolicy('ask');

    expect(policy).toMatchObject({
      mode: 'ask',
      permissionMode: 'ask',
      runtimePermissionMode: 'agent',
      acpPermissionMode: 'ask',
      toolScope: {
        kbRead: true,
        kbWrite: 'bounded',
        web: true,
        askUserQuestion: true,
        terminal: false,
        mcp: false,
        subagents: true,
        acpDelegation: false,
        a2aDelegation: false,
        im: false,
        schedule: false,
        userExtensions: false,
      },
    });
    expect(policy.kbToolNames).toContain('write_file');
    expect(policy.kbToolNames).toContain('dreaming');
    expect(policy.kbToolNames).not.toContain('delete_file');
    expect(policy.kbToolNames).not.toContain('rename_file');
    expect(policy.kbToolNames).not.toContain('move_file');
    expect(policy.kbToolNames).not.toContain('edit_lines');
    expect(hasMindosExtensionScope(policy, 'pi-web-access')).toBe(true);
    expect(hasMindosExtensionScope(policy, 'subagents')).toBe(true);
    expect(hasMindosExtensionScope(policy, 'pi-mcp-adapter')).toBe(false);
    expect(hasMindosExtensionScope(policy, 'user-extensions')).toBe(false);
  });

  it('maps auto permission to product automation without terminal, MCP, or user extensions', () => {
    const policy = createMindosAgentPermissionPolicy('auto');

    expect(policy).toMatchObject({
      mode: 'auto',
      permissionMode: 'auto',
      runtimePermissionMode: 'agent',
      acpPermissionMode: 'auto',
      toolScope: {
        kbRead: true,
        kbWrite: 'all',
        web: true,
        askUserQuestion: true,
        terminal: false,
        mcp: false,
        subagents: true,
        acpDelegation: true,
        a2aDelegation: true,
        im: true,
        schedule: true,
        userExtensions: false,
      },
    });
    expect(policy.kbToolNames).toEqual([]);
    expect(hasMindosExtensionScope(policy, 'subagents')).toBe(true);
    expect(hasMindosExtensionScope(policy, 'schedule-prompt')).toBe(true);
    expect(hasMindosExtensionScope(policy, 'im')).toBe(true);
    expect(hasMindosExtensionScope(policy, 'pi-mcp-adapter')).toBe(false);
    expect(hasMindosExtensionScope(policy, 'user-extensions')).toBe(false);
  });

  it('maps full permission to the complete local agent scope', () => {
    const policy = createMindosAgentPermissionPolicy('full');

    expect(policy).toMatchObject({
      mode: 'full',
      permissionMode: 'full',
      runtimePermissionMode: 'agent',
      acpPermissionMode: 'full',
      toolScope: {
        kbRead: true,
        kbWrite: 'all',
        web: true,
        askUserQuestion: true,
        terminal: true,
        mcp: true,
        subagents: true,
        acpDelegation: true,
        a2aDelegation: true,
        im: true,
        schedule: true,
        userExtensions: true,
      },
    });
    expect(policy.kbToolNames).toEqual([]);
    expect(hasMindosExtensionScope(policy, 'pi-mcp-adapter')).toBe(true);
    expect(hasMindosExtensionScope(policy, 'subagents')).toBe(true);
    expect(hasMindosExtensionScope(policy, 'schedule-prompt')).toBe(true);
    expect(hasMindosExtensionScope(policy, 'user-extensions')).toBe(true);
  });

  it('keeps bounded knowledge-write as a helper policy, not a product mode', () => {
    const policy = createMindosKnowledgeWritePermissionPolicy('ask');

    expect(policy).toMatchObject({
      mode: 'ask',
      permissionMode: 'ask',
      runtimePermissionMode: 'readonly',
      acpPermissionMode: 'readonly',
      toolScope: {
        kbRead: true,
        kbWrite: 'bounded',
        web: true,
        askUserQuestion: true,
        terminal: false,
        mcp: false,
        subagents: false,
        acpDelegation: false,
        a2aDelegation: false,
        im: false,
        schedule: false,
        userExtensions: false,
      },
    });
    expect(policy.kbToolNames).toEqual([
      'list_files',
      'read_file',
      'search',
      'load_skill',
      'create_file',
      'batch_create_files',
      'write_file',
      'append_to_file',
      'insert_after_heading',
      'update_section',
    ]);
    expect(policy.kbToolNames).not.toContain('delete_file');
    expect(policy.kbToolNames).not.toContain('rename_file');
    expect(policy.kbToolNames).not.toContain('move_file');
  });

  it('derives external harness permission from the product permission mode', () => {
    expect(createMindosAgentPermissionPolicy('read').runtimePermissionMode).toBe('readonly');
    expect(createMindosAgentPermissionPolicy('ask').runtimePermissionMode).toBe('agent');
    expect(createMindosAgentPermissionPolicy('auto').runtimePermissionMode).toBe('agent');
    expect(createMindosAgentPermissionPolicy('full').runtimePermissionMode).toBe('agent');

    expect(createMindosAgentPermissionPolicy('read').acpPermissionMode).toBe('readonly');
    expect(createMindosAgentPermissionPolicy('ask').acpPermissionMode).toBe('ask');
    expect(createMindosAgentPermissionPolicy('auto').acpPermissionMode).toBe('auto');
    expect(createMindosAgentPermissionPolicy('full').acpPermissionMode).toBe('full');
  });

  it('maps runtime contexts into the same product-mode policy contract', () => {
    expect(createMindosAgentPermissionPolicyFromContext({ permissionMode: 'read' }).mode).toBe('read');
    expect(createMindosAgentPermissionPolicyFromContext({ permissionMode: 'auto' }).mode).toBe('auto');
    expect(createMindosAgentPermissionPolicyFromContext({ permissionMode: 'invalid' }).mode).toBe('ask');
    expect(createMindosAgentPermissionPolicyFromContext({ permissionMode: 'invalid' }, 'read').mode).toBe('read');
    expect(createMindosAgentPermissionPolicyFromContext(undefined).mode).toBe('ask');
  });
});
