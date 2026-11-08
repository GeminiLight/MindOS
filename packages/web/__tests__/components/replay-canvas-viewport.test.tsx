// @vitest-environment jsdom
import React, { act, useEffect, useRef } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createReplayState } from '@geminilight/mindos/knowledge/branch-replay';
import { ReplayCanvas } from '@/components/echo/replay/ReplayCanvas';
import { requestRaceExample } from '@/components/echo/replay/replay-example';
import { replayCopy } from '@/components/echo/replay/replay-copy';

const camera = vi.hoisted(() => ({ width: 1070, height: 420, fitView: vi.fn() }));
const flow = {
  fitView: camera.fitView,
  getViewport: () => ({ x: 0, y: 0, zoom: 1 }),
  getNode: (id: string) => ({ id, position: { x: 330, y: 200 }, measured: { width: 310, height: 210 } }),
};
vi.mock('@xyflow/react', () => ({
  ReactFlowProvider: ({ children }: { children: React.ReactNode }) => children,
  ReactFlow: ({ onInit }: { onInit: () => void }) => {
    const initialize = useRef(onInit);
    useEffect(() => { initialize.current(); }, []); // Match the one-time canvas initialization.
    return null;
  },
  Background: () => null, MiniMap: () => null, Handle: () => null,
  BackgroundVariant: { Dots: 'dots' }, Position: { Left: 'left', Right: 'right' },
  useNodesInitialized: () => true,
  useReactFlow: () => flow,
  useStore: (select: (size: typeof camera) => unknown) => select(camera),
}));

globalThis.IS_REACT_ACT_ENVIRONMENT = true;
const host = document.createElement('div'); document.body.append(host);
let root = createRoot(host);
const story = requestRaceExample('en');
const copy = replayCopy('en');
const mount = () => act(async () => root.render(<ReplayCanvas story={story} state={createReplayState(story)} copy={copy}
  compare={false} onChoose={() => {}} onResume={() => {}} onRevisit={() => {}}>Playback controls</ReplayCanvas>));
beforeEach(() => {
  camera.width = 1070; camera.height = 420; camera.fitView.mockReset();
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => { callback(0); return 1; });
  vi.stubGlobal('cancelAnimationFrame', () => {});
  vi.stubGlobal('ResizeObserver', class { observe() {} disconnect() {} });
});
afterEach(async () => { await act(async () => root.unmount()); root = createRoot(host); vi.unstubAllGlobals(); });

describe('replay camera keeps choices reachable in short windows', () => {
  it('frames a complete first option and exposes every alternate when two lanes would be clipped', async () => {
    await mount();
    expect(camera.fitView.mock.lastCall?.[0].nodes).toEqual([{ id: `${story.scenes[0].id}:choice:${story.scenes[0].choices[0].id}` }]);
    const buttons = host.querySelectorAll('.replay-route-jump button');
    expect(buttons).toHaveLength(story.scenes[0].choices.length);
    await act(async () => (buttons[1] as HTMLButtonElement).click());
    expect(camera.fitView.mock.lastCall?.[0].nodes).toEqual([{ id: `${story.scenes[0].id}:choice:${story.scenes[0].choices[1].id}` }]);
  });

  it('retains the context and two-route view when enough vertical space is available', async () => {
    camera.height = 800;
    await mount();
    expect(camera.fitView.mock.lastCall?.[0].nodes).toEqual([
      { id: `${story.scenes[0].id}:context` },
      ...story.scenes[0].choices.slice(0, 2).map(choice => ({ id: `${story.scenes[0].id}:choice:${choice.id}` })),
    ]);
  });

  it('waits for a measured viewport before moving the camera', async () => {
    camera.width = 0; camera.height = 0;
    await mount();
    expect(camera.fitView).not.toHaveBeenCalled();
  });
});
