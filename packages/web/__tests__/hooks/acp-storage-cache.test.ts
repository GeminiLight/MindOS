/**
 * @vitest-environment jsdom
 */

import { beforeEach, describe, expect, it } from 'vitest';
import { readAcpDetectionCacheFromStorage } from '@/hooks/useAcpDetection';
import { readAcpRegistryCacheFromStorage } from '@/hooks/useAcpRegistry';

describe('ACP hook storage caches', () => {
  beforeEach(() => {
    sessionStorage.clear();
  });

  it('ignores malformed ACP detection cache shapes', () => {
    sessionStorage.setItem('mindos:acp-detection', JSON.stringify({
      installed: { id: 'not-an-array' },
      notInstalled: [],
      ts: Date.now(),
    }));

    expect(readAcpDetectionCacheFromStorage()).toBeNull();
  });

  it('reads valid ACP detection cache shapes', () => {
    const cache = {
      installed: [{ id: 'codex', name: 'Codex', binaryPath: '/usr/bin/codex' }],
      notInstalled: [{ id: 'claude', name: 'Claude', installCmd: 'npm i -g claude' }],
      ts: Date.now(),
    };
    sessionStorage.setItem('mindos:acp-detection', JSON.stringify(cache));

    expect(readAcpDetectionCacheFromStorage()).toEqual(cache);
  });

  it('ignores malformed ACP registry cache shapes', () => {
    sessionStorage.setItem('mindos:acp-registry', JSON.stringify({
      agents: { codex: true },
      ts: Date.now(),
    }));

    expect(readAcpRegistryCacheFromStorage()).toBeNull();
  });

  it('ignores corrupted JSON caches', () => {
    sessionStorage.setItem('mindos:acp-detection', '{bad json');
    sessionStorage.setItem('mindos:acp-registry', '{bad json');

    expect(readAcpDetectionCacheFromStorage()).toBeNull();
    expect(readAcpRegistryCacheFromStorage()).toBeNull();
  });
});
