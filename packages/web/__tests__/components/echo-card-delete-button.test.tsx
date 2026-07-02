// @vitest-environment jsdom

import React from 'react';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { EchoCardDeleteButton } from '@/components/echo/EchoSemanticCard';

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

describe('EchoCardDeleteButton', () => {
  let host: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    host = document.createElement('div');
    document.body.appendChild(host);
    root = createRoot(host);
  });

  afterEach(() => {
    act(() => root.unmount());
    host.remove();
  });

  it('requires an explicit confirmation before deleting', async () => {
    const onDelete = vi.fn();

    await act(async () => {
      root.render(
        <EchoCardDeleteButton
          label="删除"
          confirmLabel="确认删除"
          cancelLabel="取消"
          onDelete={onDelete}
        />,
      );
    });

    const firstDelete = host.querySelector<HTMLButtonElement>('[data-testid="echo-card-delete-button"]');
    expect(firstDelete).not.toBeNull();

    await act(async () => {
      firstDelete?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });

    expect(onDelete).not.toHaveBeenCalled();
    expect(host.querySelector('[data-testid="echo-card-delete-confirmation"]')).not.toBeNull();
    expect(host.querySelector('[data-testid="echo-card-delete-confirm-button"]')?.textContent)
      .toContain('确认删除');
    expect(host.querySelector('[data-testid="echo-card-delete-cancel-button"]')?.textContent)
      .toContain('取消');

    const cancel = host.querySelector<HTMLButtonElement>('[data-testid="echo-card-delete-cancel-button"]');
    await act(async () => {
      cancel?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });

    expect(onDelete).not.toHaveBeenCalled();
    expect(host.querySelector('[data-testid="echo-card-delete-confirmation"]')).toBeNull();

    const secondDelete = host.querySelector<HTMLButtonElement>('[data-testid="echo-card-delete-button"]');
    await act(async () => {
      secondDelete?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });

    const confirm = host.querySelector<HTMLButtonElement>('[data-testid="echo-card-delete-confirm-button"]');
    await act(async () => {
      confirm?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });

    expect(onDelete).toHaveBeenCalledTimes(1);
  });
});
