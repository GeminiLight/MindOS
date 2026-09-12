// @vitest-environment jsdom
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, expect, it } from 'vitest';
import { setMessages, removeSession, resetAgentRunStoreForTests, useSessionMessages, useRunSummary } from '@/lib/agent-run-store';
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
afterEach(() => resetAgentRunStoreForTests());
it('updates only the selected session during streaming and clears it on removal', async () => {
  const renders = { first: 0, second: 0, summary: 0 };
  function Messages({ id }: { id: 'first' | 'second' }) { renders[id]++; return <div>{useSessionMessages(id).map(message => message.content).join('')}</div>; }
  function Summary() { renders.summary++; useRunSummary(); return null; }
  const container = document.createElement('div'); const root = createRoot(container);
  try {
    await act(async () => { root.render(<><Messages id="first" /><Messages id="second" /><Summary /></>); });
    const before = { ...renders };
    await act(async () => { setMessages('first', [{ role: 'assistant', content: 'streamed', timestamp: 1 }], { skipPersist: true }); });
    expect(container.textContent).toBe('streamed');
    expect(renders.first).toBe(before.first + 1); expect(renders.second).toBe(before.second); expect(renders.summary).toBe(before.summary);
    await act(async () => { removeSession('first'); }); expect(container.textContent).toBe('');
  } finally { await act(async () => root.unmount()); }
});
