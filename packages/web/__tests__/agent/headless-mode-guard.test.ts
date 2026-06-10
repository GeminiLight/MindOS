import { describe, expect, it } from 'vitest';
import { resolveHeadlessAgentMode } from '@/lib/agent/headless-mode-guard';

describe('headless agent mode guard', () => {
  it('downgrades default headless agent mode to readonly chat scope', () => {
    expect(resolveHeadlessAgentMode({ requestedMode: 'agent' })).toMatchObject({
      requestedMode: 'agent',
      effectiveMode: 'chat',
      downgraded: true,
      reason: 'headless_agent_mode_requires_explicit_opt_in',
    });
  });

  it('keeps IM inbound conversations readonly unless explicitly opted in', () => {
    expect(resolveHeadlessAgentMode({ requestedMode: 'agent', entrypoint: 'im' })).toMatchObject({
      entrypoint: 'im',
      effectiveMode: 'chat',
      downgraded: true,
    });
  });

  it('preserves bounded non-agent modes', () => {
    expect(resolveHeadlessAgentMode({ requestedMode: 'chat', entrypoint: 'im' })).toMatchObject({
      effectiveMode: 'chat',
      downgraded: false,
    });
    expect(resolveHeadlessAgentMode({ requestedMode: 'organize', entrypoint: 'schedule' })).toMatchObject({
      effectiveMode: 'organize',
      downgraded: false,
    });
  });

  it('allows full agent mode only with explicit opt-in', () => {
    expect(resolveHeadlessAgentMode({ requestedMode: 'agent', allowAgentMode: true })).toMatchObject({
      effectiveMode: 'agent',
      downgraded: false,
    });
    expect(resolveHeadlessAgentMode({
      requestedMode: 'agent',
      entrypoint: 'im',
      env: { MINDOS_IM_ALLOW_AGENT_MODE: '1' },
    })).toMatchObject({
      effectiveMode: 'agent',
      downgraded: false,
    });
  });
});
