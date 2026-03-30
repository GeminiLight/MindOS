import { describe, it, expect } from 'vitest';
import { buildAgentCard } from '../../lib/a2a/agent-card';

describe('buildAgentCard', () => {
  it('returns a valid agent card with required fields', () => {
    const card = buildAgentCard('http://localhost:3456');

    expect(card.name).toBe('MindOS');
    expect(card.description).toBeTruthy();
    expect(card.version).toBeTruthy();
    expect(card.provider.organization).toBe('MindOS');
    expect(card.provider.url).toBe('http://localhost:3456');
  });

  it('includes the A2A JSON-RPC endpoint', () => {
    const card = buildAgentCard('http://localhost:3456');

    expect(card.supportedInterfaces).toHaveLength(1);
    expect(card.supportedInterfaces[0]).toEqual({
      url: 'http://localhost:3456/api/a2a',
      protocolBinding: 'JSONRPC',
      protocolVersion: '1.0',
    });
  });

  it('declares streaming=false for Phase 1', () => {
    const card = buildAgentCard('http://localhost:3456');
    expect(card.capabilities.streaming).toBe(false);
    expect(card.capabilities.pushNotifications).toBe(false);
  });

  it('exposes knowledge base skills', () => {
    const card = buildAgentCard('https://my.mindos.io');
    expect(card.skills.length).toBeGreaterThanOrEqual(4);

    const ids = card.skills.map(s => s.id);
    expect(ids).toContain('kb-search');
    expect(ids).toContain('kb-read');
    expect(ids).toContain('kb-write');
    expect(ids).toContain('kb-list');
  });

  it('uses the provided baseUrl for interface URL', () => {
    const card = buildAgentCard('https://custom.host:8080');
    expect(card.supportedInterfaces[0].url).toBe('https://custom.host:8080/api/a2a');
    expect(card.provider.url).toBe('https://custom.host:8080');
  });

  it('declares bearer security scheme', () => {
    const card = buildAgentCard('http://localhost:3456');
    expect(card.securitySchemes?.bearer).toBeDefined();
    expect(card.securitySchemes?.bearer.httpAuthSecurityScheme?.scheme).toBe('Bearer');
  });

  it('sets text/plain as default input and output mode', () => {
    const card = buildAgentCard('http://localhost:3456');
    expect(card.defaultInputModes).toContain('text/plain');
    expect(card.defaultOutputModes).toContain('text/plain');
  });
});
