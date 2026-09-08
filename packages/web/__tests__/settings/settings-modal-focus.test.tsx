// @vitest-environment jsdom
import React, { act, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { expect, it, vi } from 'vitest';
import SettingsModal from '@/components/SettingsModal';

vi.mock('@/lib/stores/locale-store', () => ({ useLocale: () => ({ t: { settings: { title: '设置' } } }) }));
// The content form is separate; exercise the real modal's focus lifecycle.
vi.mock('@/components/settings/SettingsContent', () => ({ default: ({ onClose }: { onClose: () => void }) => {
  const [text, setText] = useState('');
  return <><input aria-label="Setting value" value={text} onChange={event => setText(event.target.value)} /><button onClick={onClose}>Close settings</button></>;
} }));
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

it('opens a named modal with focus inside and restores the trigger after Escape', async () => {
  const host = document.createElement('div');
  document.body.appendChild(host);
  const root = createRoot(host);
  function Harness() {
    const [open, setOpen] = useState(false);
    return <><button onClick={() => setOpen(true)}>Open settings</button><SettingsModal open={open} onClose={() => setOpen(false)} /></>;
  }
  try {
    await act(async () => root.render(<Harness />));
    const trigger = host.querySelector('button')!;
    trigger.focus();
    await act(async () => { trigger.click(); });
    const dialog = document.querySelector('[role="dialog"]')!;
    expect(dialog.getAttribute('aria-label')).toBe('设置');
    expect(dialog.contains(document.activeElement)).toBe(true);
    await act(async () => document.activeElement!.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })));
    await act(async () => { await new Promise(resolve => setTimeout(resolve, 30)); });
    expect(document.activeElement).toBe(trigger);
  } finally {
    await act(async () => root.unmount());
    host.remove();
  }
});
