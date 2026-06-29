// @vitest-environment jsdom
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import CustomSelect from '@/components/CustomSelect';

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

describe('CustomSelect', () => {
  let host: HTMLDivElement;
  let root: Root | null;

  beforeEach(() => {
    root = null;
    host = document.createElement('div');
    document.body.appendChild(host);
  });

  afterEach(async () => {
    await act(async () => {
      root?.unmount();
    });
    host.remove();
  });

  it('keeps compact select chevrons positioned against the trigger', async () => {
    root = createRoot(host);
    await act(async () => {
      root!.render(
        <div style={{ width: 500 }}>
          <CustomSelect
            value="all"
            onChange={vi.fn()}
            size="sm"
            options={[
              { value: 'all', label: 'All operations' },
              { value: 'agent', label: 'Agent' },
            ]}
          />
        </div>,
      );
    });

    const trigger = host.querySelector<HTMLButtonElement>('button[aria-haspopup="listbox"]');
    const chevron = trigger?.querySelector('svg');

    expect(trigger).not.toBeNull();
    expect(trigger?.className).toContain('relative');
    expect(trigger?.className).toContain('inline-flex');
    expect(chevron?.className.baseVal).toContain('absolute right-1');
  });
});
