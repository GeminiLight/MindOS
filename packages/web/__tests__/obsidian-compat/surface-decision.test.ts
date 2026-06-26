import { describe, expect, it } from 'vitest';
import {
  buildObsidianSurfacePolicyDecision,
} from '@/lib/obsidian-compat/surface-decision';

describe('Obsidian surface policy decisions', () => {
  it('allows ready command surfaces only after runtime registration is verified', () => {
    expect(buildObsidianSurfacePolicyDecision({
      surface: 'commands',
      label: 'Commands',
      status: 'ready',
    })).toMatchObject({
      action: 'allow-after-load',
      risk: 'medium',
      runtimeDefault: 'mounted',
      permissionBoundary: 'Commands may register in MindOS Command Center, but execution still inherits downstream surface gates.',
      requiredEvidence: [
        'Runtime registered evidence for command ids.',
        'Called ledger evidence or workflow probe before claiming user-visible workflow success.',
      ],
    });
  });

  it('requires review for restricted network and vault surfaces', () => {
    expect(buildObsidianSurfacePolicyDecision({
      surface: 'network',
      label: 'Network',
      status: 'limited',
    })).toMatchObject({
      action: 'review-before-enable',
      risk: 'high',
      runtimeDefault: 'restricted',
      permissionBoundary: 'Outbound requests stay behind protocol, host, timeout, response-size, and credentials policy.',
      requiredEvidence: expect.arrayContaining([
        'Capability gate confirmation for the current fingerprint.',
        'Runtime denied/called ledger review for this surface.',
      ]),
    });

    expect(buildObsidianSurfacePolicyDecision({
      surface: 'vault',
      label: 'Vault',
      status: 'limited',
    })).toMatchObject({
      action: 'review-before-enable',
      risk: 'high',
      runtimeDefault: 'restricted',
      permissionBoundary: 'Vault access is scoped to public MindOS content; private plugin/system directories stay hidden.',
    });
  });

  it('keeps editor and blocked surfaces out of the generic runtime path', () => {
    expect(buildObsidianSurfacePolicyDecision({
      surface: 'editor',
      label: 'Editor',
      status: 'native-gated',
    })).toMatchObject({
      action: 'native-adapter',
      risk: 'high',
      runtimeDefault: 'native-gated',
      permissionBoundary: 'Raw editor and CodeMirror behavior is not mounted directly; use MindOS-owned adapter contracts.',
    });

    expect(buildObsidianSurfacePolicyDecision({
      surface: 'unsupported',
      label: 'Blocked capability',
      status: 'blocked',
    })).toMatchObject({
      action: 'blocked',
      risk: 'critical',
      runtimeDefault: 'blocked',
      permissionBoundary: 'Unsupported Obsidian APIs or Node/Electron modules are not exposed by the generic runtime.',
    });
  });
});
