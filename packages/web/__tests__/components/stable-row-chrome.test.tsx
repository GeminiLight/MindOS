// @vitest-environment jsdom
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { StableRowActionButton, StableRowTrailingSlot } from '@/components/shared/StableRowChrome';

describe('StableRowChrome', () => {
  let host: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    (globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;
    host = document.createElement('div');
    document.body.appendChild(host);
    root = createRoot(host);
  });

  afterEach(async () => {
    await act(async () => { root.unmount(); });
    host.remove();
  });

  it('keeps status and actions mounted inside a fixed trailing slot', async () => {
    await act(async () => {
      root.render(
        <div className="group">
          <StableRowTrailingSlot
            reserveClassName="w-16"
            status={<span data-testid="status">idle</span>}
            actions={(
              <StableRowActionButton title="Archive">
                <span data-testid="action">archive</span>
              </StableRowActionButton>
            )}
          />
        </div>,
      );
    });

    const slot = host.querySelector('[data-stable-row-trailing]') as HTMLElement | null;
    const status = host.querySelector('[data-stable-row-status]') as HTMLElement | null;
    const actions = host.querySelector('[data-stable-row-actions]') as HTMLElement | null;

    expect(slot?.className).toContain('w-16');
    expect(slot?.className).toContain('shrink-0');
    expect(status?.textContent).toBe('idle');
    expect(status?.className).toContain('opacity-100');
    expect(status?.className).toContain('group-hover:opacity-0');
    expect(actions?.textContent).toBe('archive');
    expect(actions?.className).toContain('opacity-0');
    expect(actions?.className).toContain('group-hover:opacity-100');
    expect(actions?.className).not.toContain('hidden');
  });

  it('forces actions visible without changing the reserved slot', async () => {
    await act(async () => {
      root.render(
        <StableRowTrailingSlot
          reserveClassName="w-[5.75rem]"
          forceActionsVisible
          status={<span>pinned</span>}
          actions={<StableRowActionButton title="Pin">pin</StableRowActionButton>}
        />,
      );
    });

    const slot = host.querySelector('[data-stable-row-trailing]') as HTMLElement | null;
    const status = host.querySelector('[data-stable-row-status]') as HTMLElement | null;
    const actions = host.querySelector('[data-stable-row-actions]') as HTMLElement | null;

    expect(slot?.className).toContain('w-[5.75rem]');
    expect(status?.className).toContain('opacity-0');
    expect(actions?.className).toContain('pointer-events-auto');
    expect(actions?.className).toContain('opacity-100');
  });
});
