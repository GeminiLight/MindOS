import { describe, expect, it } from 'vitest';
import {
  ACP_SESSION_LAYER_SUPPORT,
  acpCapabilities,
  acpCapabilitiesFromHandshake,
  acpHarnessCapabilities,
  declaredAcpCapabilitiesFromHandshake,
  declaredAcpCapabilitiesFromMetadata,
  mergeAcpDeclaredCapabilities,
} from './capabilities.js';

describe('acpCapabilitiesFromHandshake', () => {
  it('stays pessimistic for an agent that declares nothing', () => {
    const { capabilities, harnessCapabilities } = acpCapabilitiesFromHandshake(undefined);
    expect(capabilities).toMatchObject({
      supportsResume: false,
      supportsAttachExisting: false,
      supportsListSessions: false,
      supportsFork: false,
      supportsArchive: false,
      supportsMcpConfig: false,
      supportsUserInput: false,
      supportsModelList: false,
      supportsRuntimeStatus: false,
    });
    expect(harnessCapabilities.session).toBe('none');
    expect(harnessCapabilities.tools).toEqual(['shell', 'file']);
    // The undeclared result is also what the legacy constants describe.
    expect(acpCapabilities).toEqual(capabilities);
    expect(acpHarnessCapabilities).toEqual(harnessCapabilities);
  });

  it('turns on what the MindOS session layer itself implements for every ACP agent', () => {
    const { capabilities, harnessCapabilities } = acpCapabilitiesFromHandshake(undefined);
    expect(capabilities).toMatchObject({
      supportsFreshSession: true,
      supportsInterrupt: true,
      supportsApprovals: true,
      supportsToolEvents: true,
    });
    expect(harnessCapabilities.permissions).toBe('runtime-bridged');
    expect(harnessCapabilities.eventStream).toEqual(['text', 'tool-events', 'permissions']);
  });

  it('shows supportsResume for an agent that declares loadSession and promptCapabilities', () => {
    const { capabilities, harnessCapabilities } = acpCapabilitiesFromHandshake({
      loadSession: true,
      promptCapabilities: { image: true, embeddedContext: true },
    });
    expect(capabilities.supportsResume).toBe(true);
    expect(capabilities.supportsAttachExisting).toBe(false);
    expect(capabilities.supportsListSessions).toBe(false);
    expect(harnessCapabilities.session).toBe('local-id');
  });

  it('keeps supportsResume false for an agent without loadSession even when it declares other capabilities', () => {
    const { capabilities, harnessCapabilities } = acpCapabilitiesFromHandshake({
      promptCapabilities: { image: true },
      sessionCapabilities: { close: true },
    });
    expect(capabilities.supportsResume).toBe(false);
    expect(harnessCapabilities.session).toBe('none');
  });

  it('promotes to native-thread when load and list are both declared', () => {
    const { capabilities, harnessCapabilities } = acpCapabilitiesFromHandshake({
      loadSession: true,
      sessionCapabilities: { list: {}, fork: true, delete: true },
    });
    expect(capabilities).toMatchObject({
      supportsResume: true,
      supportsListSessions: true,
      supportsAttachExisting: true,
      // Declared, but the session layer does not implement fork / delete yet.
      supportsFork: false,
      supportsArchive: false,
    });
    expect(harnessCapabilities.session).toBe('native-thread');
  });

  it('derives MCP support from declared transports plus session inheritance', () => {
    const declared = acpCapabilitiesFromHandshake({ mcpCapabilities: { http: true } });
    expect(declared.capabilities.supportsMcpConfig).toBe(true);
    expect(declared.harnessCapabilities.tools).toEqual(['shell', 'file', 'mcp']);
    const allFalse = acpCapabilitiesFromHandshake({ mcpCapabilities: { stdio: false, sse: false } });
    expect(allFalse.capabilities.supportsMcpConfig).toBe(false);
    const acpTransport = acpCapabilitiesFromHandshake({ mcpCapabilities: { acp: true } });
    expect(acpTransport.capabilities.supportsMcpConfig).toBe(true);
  });

  it('never claims more than the session layer implements', () => {
    const observed = { ...ACP_SESSION_LAYER_SUPPORT, loadSession: false, listSessions: false, requestPermission: false, mcpInheritance: false };
    const { capabilities, harnessCapabilities } = acpCapabilitiesFromHandshake({
      loadSession: true,
      sessionCapabilities: { list: true },
      mcpCapabilities: { stdio: true },
    }, observed);
    expect(capabilities).toMatchObject({
      supportsResume: false,
      supportsListSessions: false,
      supportsApprovals: false,
      supportsMcpConfig: false,
    });
    expect(harnessCapabilities.session).toBe('none');
    expect(harnessCapabilities.permissions).toBe('none');
    expect(harnessCapabilities.eventStream).toEqual(['text', 'tool-events']);
  });

  it('reads declared capabilities from adapter metadata', () => {
    expect(declaredAcpCapabilitiesFromMetadata(undefined)).toBeUndefined();
    expect(declaredAcpCapabilitiesFromMetadata({ connectionType: 'stdio' })).toBeUndefined();
    expect(declaredAcpCapabilitiesFromMetadata({
      sessionCapabilities: { loadSession: true, list: true },
      mcpCapabilities: { sse: true },
      promptCapabilities: { audio: true },
    })).toEqual({
      loadSession: true,
      sessionCapabilities: { loadSession: true, list: true },
      mcpCapabilities: { sse: true },
      promptCapabilities: { audio: true },
    });
  });

  it('reads declared capabilities from a cached handshake and lets the handshake win over static metadata', () => {
    expect(declaredAcpCapabilitiesFromHandshake(undefined)).toBeUndefined();
    expect(declaredAcpCapabilitiesFromHandshake({ status: 'failed', stage: 'initialize' })).toBeUndefined();
    const fromHandshake = declaredAcpCapabilitiesFromHandshake({
      status: 'ready',
      stage: 'session-new',
      capabilities: { loadSession: false, sessionCapabilities: { list: true } },
      session: { supportsLoadSession: false, supportsListSessions: true, authMethodCount: 1 },
    });
    expect(fromHandshake).toEqual({
      loadSession: false,
      sessionCapabilities: { list: true },
      authMethodCount: 1,
    });
    const merged = mergeAcpDeclaredCapabilities(
      { loadSession: true, mcpCapabilities: { stdio: true } },
      fromHandshake,
    );
    expect(merged).toEqual({
      loadSession: false,
      sessionCapabilities: { list: true },
      mcpCapabilities: { stdio: true },
      authMethodCount: 1,
    });
    expect(mergeAcpDeclaredCapabilities(undefined, undefined)).toBeUndefined();
    expect(mergeAcpDeclaredCapabilities({ loadSession: true }, undefined)).toEqual({ loadSession: true });
  });
});
