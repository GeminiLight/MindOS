// @vitest-environment jsdom
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ChannelConnectionBroker } from '@/components/agents/channel-detail/ChannelConnectionBroker';

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let host: HTMLDivElement;
let root: Root;

const copy = {
  existingConnectionTitle: 'Existing Feishu app found',
  existingConnectionHint: 'Reuse the verified local CLI profile. MindOS stores only a reference.',
  existingConnectionBotReady: 'Bot ready',
  existingConnectionUserOptional: 'User OAuth not connected — bot features still work.',
  existingConnectionUse: 'Use existing app',
  existingConnectionUsing: 'Using existing app',
  existingConnectionRefresh: 'Refresh',
  existingConnectionRemove: 'Stop using',
  existingConnectionWorking: 'Working…',
  existingConnectionFailed: 'Could not update the connection.',
};

describe('ChannelConnectionBroker', () => {
  beforeEach(() => {
    host = document.createElement('div');
    document.body.appendChild(host);
    root = createRoot(host);
  });
  afterEach(async () => {
    await act(async () => root.unmount());
    host.remove();
    vi.unstubAllGlobals();
  });

  it('offers the verified existing bot without requiring a new app or user OAuth', async () => {
    const onChanged = vi.fn();
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      if (!init?.method) return Response.json({
        schemaVersion: 1,
        bindings: [],
        candidates: [{
          id: 'lark-cli:existing-profile',
          provider: 'feishu',
          status: 'ready',
          application: { appId: 'cli_existing', appName: 'Existing Bot', brand: 'feishu' },
          identities: {
            bot: { status: 'ready', available: true, verified: true },
            user: { status: 'missing', available: false, verified: false },
          },
          issues: [],
        }],
      });
      expect(JSON.parse(String(init.body))).toEqual({
        action: 'bind',
        candidateId: 'lark-cli:existing-profile',
      });
      return Response.json({ ok: true, binding: { id: 'lark-cli:existing-profile' } }, { status: 201 });
    });
    vi.stubGlobal('fetch', fetchMock);

    await act(async () => root.render(<ChannelConnectionBroker im={copy} onChanged={onChanged} />));
    await act(async () => { await Promise.resolve(); await Promise.resolve(); });

    expect(fetchMock).toHaveBeenCalledWith('/api/connections?discover=true&provider=feishu', { cache: 'no-store' });
    expect(host.textContent).toContain('Existing Feishu app found');
    expect(host.textContent).toContain('Existing Bot');
    expect(host.textContent).toContain('Bot ready');
    expect(host.textContent).toContain('User OAuth not connected — bot features still work.');

    const button = [...host.querySelectorAll('button')].find((entry) => entry.textContent?.includes('Use existing app'));
    await act(async () => button?.click());
    await act(async () => { await Promise.resolve(); await Promise.resolve(); });
    expect(onChanged).toHaveBeenCalledOnce();
  });
});
