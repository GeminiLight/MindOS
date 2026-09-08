// @vitest-environment jsdom
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { beforeEach, afterEach, expect, it, vi } from 'vitest';
import ContextStatusButton from '@/components/ask/ContextStatusButton';
import type { ContextUsageMetadata } from '@/lib/agent/stream-consumer';

vi.mock('@/lib/stores/locale-store', () => ({ useLocale: () => ({ locale: 'en' }) }));
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
let root: Root;
let host: HTMLDivElement;
const usage: ContextUsageMetadata = { phase: 'preflight', action: 'none', percent: 42, usedTokens: 42_000, contextWindow: 100_000, budgetTokens: 84_000, reserveTokens: 16_000, systemPromptTokens: 10_000, turnPromptTokens: 12_000, historyTokens: 20_000 };
beforeEach(async () => {
  host = document.createElement('div'); document.body.appendChild(host); root = createRoot(host);
  await act(async () => root.render(<ContextStatusButton usage={usage} />));
});
afterEach(async () => { await act(async () => root.unmount()); host.remove(); });
const trigger = () => host.querySelector('button')!;
const popup = () => document.querySelector<HTMLElement>('[role="dialog"]');
async function open() { trigger().focus(); await act(async () => trigger().click()); await act(async () => { await new Promise(resolve => setTimeout(resolve, 30)); }); }

it('opens a named readable detail popup on click without requiring hover', async () => {
  expect(popup()).toBeNull();
  await open();
  expect(trigger().getAttribute('aria-expanded')).toBe('true');
  expect(popup()).not.toBeNull();
  expect(popup()?.textContent).toContain('Context used 42%');
  expect(popup()?.getAttribute('aria-labelledby')).toBeTruthy();
  expect(popup()?.contains(document.activeElement)).toBe(true);
});

it('closes with Escape and restores focus to the usage button', async () => {
  await open();
  await act(async () => document.activeElement!.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })));
  await act(async () => { await new Promise(resolve => setTimeout(resolve, 30)); });
  expect(trigger().getAttribute('aria-expanded')).toBe('false');
  expect(document.activeElement).toBe(trigger());
});

it('offers an explicit close action and returns focus without losing the trigger', async () => {
  await open();
  const close = document.querySelector<HTMLButtonElement>('button[aria-label="Close context usage"]');
  expect(close).not.toBeNull();
  await act(async () => close!.click());
  await act(async () => { await new Promise(resolve => setTimeout(resolve, 30)); });
  expect(trigger().getAttribute('aria-expanded')).toBe('false');
  expect(document.activeElement).toBe(trigger());
});

it('updates open details from the current session metadata without stale capacity', async () => {
  await open();
  await act(async () => root.render(<ContextStatusButton usage={{ ...usage, usedTokens: 126_000 }} />));
  expect(popup()?.textContent).toContain('Context used 126%');
  expect(popup()?.textContent).toContain('Available: 0');
  expect(popup()?.textContent).not.toContain('Context used 42%');
});

it('keeps unavailable metadata explicit inside the open details', async () => {
  await act(async () => root.render(<ContextStatusButton usage={{ ...usage, contextWindow: 0 }} />));
  await open();
  expect(popup()?.textContent).toContain('Context usage unavailable');
  expect(popup()?.textContent).not.toMatch(/NaN|Infinity|Context used 0%/);
});

it('removes open details when a session no longer has usage metadata', async () => {
  await open();
  await act(async () => root.render(<ContextStatusButton usage={null} />));
  expect(popup()).toBeNull();
  expect(host.querySelector('button')).toBeNull();
});
