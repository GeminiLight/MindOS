import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  MINDOS_BRIDGE_REQUEST_TYPES,
  bridgeOpenUrlFromPayload,
  isAllowedMindosPageUrl,
  isMindosExtensionBridgeRequest,
  isMindosPageBridgeRequest,
} from '../packages/browser-extension/src/lib/bridge-protocol';

const root = resolve(__dirname, '..');

describe('browser extension MindOS bridge protocol', () => {
  it('keeps bridge permissions local and does not request cookie access', () => {
    const manifest = JSON.parse(readFileSync(resolve(root, 'packages/browser-extension/src/manifest.json'), 'utf-8'));

    expect(manifest.permissions).toContain('activeTab');
    expect(manifest.permissions).toContain('scripting');
    expect(manifest.permissions).not.toContain('cookies');
    expect(manifest.permissions).not.toContain('nativeMessaging');
    expect(manifest.content_scripts).toEqual([
      {
        matches: ['http://localhost/*', 'http://127.0.0.1/*', 'http://[::1]/*'],
        js: ['content/mindos-bridge.js'],
        run_at: 'document_start',
      },
    ]);
    expect(manifest.externally_connectable.matches).toEqual([
      'http://localhost/*',
      'http://127.0.0.1/*',
      'http://[::1]/*',
    ]);
  });

  it('accepts only the small browser bridge request surface', () => {
    expect(MINDOS_BRIDGE_REQUEST_TYPES).toEqual([
      'bridge.ping',
      'bridge.getStatus',
      'bridge.openUrlForUserCapture',
    ]);

    expect(isMindosPageBridgeRequest({
      source: 'mindos-web',
      target: 'mindos-browser-bridge',
      id: '1',
      type: 'bridge.getStatus',
    })).toBe(true);
    expect(isMindosPageBridgeRequest({
      source: 'mindos-web',
      target: 'mindos-browser-bridge',
      id: '1',
      type: 'bridge.readCookies',
    })).toBe(false);
    expect(isMindosExtensionBridgeRequest({
      source: 'mindos-content-bridge',
      id: '1',
      type: 'bridge.openUrlForUserCapture',
      payload: { url: 'https://chatgpt.com/share/abc' },
    })).toBe(true);
  });

  it('restricts bridge callers to local MindOS pages', () => {
    expect(isAllowedMindosPageUrl('http://localhost:4567/inbox')).toBe(true);
    expect(isAllowedMindosPageUrl('http://127.0.0.1:4567/inbox')).toBe(true);
    expect(isAllowedMindosPageUrl('http://[::1]:4567/inbox')).toBe(true);
    expect(isAllowedMindosPageUrl('https://chatgpt.com/share/abc')).toBe(false);
    expect(isAllowedMindosPageUrl('chrome-extension://abc/popup.html')).toBe(false);
  });

  it('opens only http and https URLs for user-driven capture', () => {
    expect(bridgeOpenUrlFromPayload({ url: 'https://chatgpt.com/share/abc' })).toBe('https://chatgpt.com/share/abc');
    expect(bridgeOpenUrlFromPayload({ url: 'http://www.xiaohongshu.com/explore/abc' })).toBe('http://www.xiaohongshu.com/explore/abc');
    expect(bridgeOpenUrlFromPayload({ url: 'file:///Users/me/private.md' })).toBeNull();
    expect(bridgeOpenUrlFromPayload({ url: 'javascript:alert(1)' })).toBeNull();
  });
});
