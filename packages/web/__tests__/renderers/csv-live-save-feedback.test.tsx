// @vitest-environment jsdom
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CsvRenderer } from '@/components/renderers/csv/CsvRenderer';

describe('CSV renderer live save feedback', () => {
  let host: HTMLDivElement;
  let root: ReturnType<typeof createRoot>;

  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
    (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    host = document.createElement('div');
    document.body.appendChild(host);
    root = createRoot(host);
  });

  afterEach(() => {
    act(() => root.unmount());
    document.body.removeChild(host);
  });

  it('reports save failure and rolls the edited cell back', async () => {
    const saveAction = vi.fn().mockRejectedValue(new Error('disk is read-only'));

    await act(async () => {
      root.render(
        <CsvRenderer
          filePath="Research/products.csv"
          content={'name,status\nMindOS,Old'}
          extension="csv"
          saveAction={saveAction}
        />,
      );
    });

    const oldCell = [...host.querySelectorAll('td div')]
      .find(node => node.textContent === 'Old') as HTMLDivElement | undefined;
    expect(oldCell).toBeTruthy();

    await act(async () => {
      oldCell!.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });

    const input = host.querySelector('input') as HTMLInputElement | null;
    expect(input).not.toBeNull();

    await act(async () => {
      const valueSetter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
      valueSetter?.call(input!, 'New');
      input!.dispatchEvent(new Event('input', { bubbles: true }));
      input!.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(saveAction).toHaveBeenCalled();
    expect(host.textContent).toContain('Save failed');
    expect(host.textContent).toContain('Old');
    expect(host.textContent).not.toContain('New');
  });

  it('cycles table header sorting through ascending, descending, and cleared states', async () => {
    const saveAction = vi.fn().mockResolvedValue(undefined);

    await act(async () => {
      root.render(
        <CsvRenderer
          filePath="Research/scores.csv"
          content={'name,score\nBravo,20\nAlpha,10\nCharlie,30'}
          extension="csv"
          saveAction={saveAction}
        />,
      );
    });

    const rowNames = () => [...host.querySelectorAll('tbody tr')]
      .map(row => row.querySelector('td div')?.textContent?.trim())
      .filter(Boolean);

    expect(rowNames()).toEqual(['Bravo', 'Alpha', 'Charlie']);

    const scoreHeader = () => host.querySelector('th:nth-child(2)') as HTMLTableCellElement | null;
    const sortAscending = [...host.querySelectorAll('button')]
      .find(button => button.getAttribute('aria-label') === 'Sort by score ascending');
    expect(sortAscending).toBeTruthy();

    await act(async () => {
      sortAscending!.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });

    expect(scoreHeader()?.getAttribute('aria-sort')).toBe('ascending');
    expect(rowNames()).toEqual(['Alpha', 'Bravo', 'Charlie']);

    const sortDescending = [...host.querySelectorAll('button')]
      .find(button => button.getAttribute('aria-label') === 'Sort by score descending');
    expect(sortDescending).toBeTruthy();

    await act(async () => {
      sortDescending!.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });

    expect(scoreHeader()?.getAttribute('aria-sort')).toBe('descending');
    expect(rowNames()).toEqual(['Charlie', 'Bravo', 'Alpha']);

    const clearSorting = [...host.querySelectorAll('button')]
      .find(button => button.getAttribute('aria-label') === 'Clear sorting for score');
    expect(clearSorting).toBeTruthy();

    await act(async () => {
      clearSorting!.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });

    expect(scoreHeader()?.getAttribute('aria-sort')).toBe('none');
    expect(rowNames()).toEqual(['Bravo', 'Alpha', 'Charlie']);
    expect(saveAction).not.toHaveBeenCalled();
  });

  it('renders URL cells with a separate open link and edit action', async () => {
    const saveAction = vi.fn().mockResolvedValue(undefined);

    await act(async () => {
      root.render(
        <CsvRenderer
          filePath="Research/products.csv"
          content={'name,url,unsafe\nMindOS,https://mindos.you/docs?tab=csv,javascript:alert(1)'}
          extension="csv"
          saveAction={saveAction}
        />,
      );
    });

    const openLink = host.querySelector('a[aria-label="Open URL mindos.you/docs?tab=csv"]') as HTMLAnchorElement | null;
    expect(openLink).not.toBeNull();
    expect(openLink?.getAttribute('href')).toBe('https://mindos.you/docs?tab=csv');
    expect(openLink?.getAttribute('target')).toBe('_blank');
    expect(openLink?.getAttribute('rel')).toBe('noopener noreferrer');

    expect(host.querySelector('a[href^="javascript:"]')).toBeNull();
    expect(host.textContent).toContain('javascript:alert(1)');

    const editButton = host.querySelector('button[aria-label="Edit URL mindos.you/docs?tab=csv"]') as HTMLButtonElement | null;
    expect(editButton).not.toBeNull();

    await act(async () => {
      editButton!.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });

    const input = host.querySelector('input') as HTMLInputElement | null;
    expect(input).not.toBeNull();
    expect(input?.value).toBe('https://mindos.you/docs?tab=csv');

    await act(async () => {
      const valueSetter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
      valueSetter?.call(input!, 'https://mindos.you/docs/table');
      input!.dispatchEvent(new Event('input', { bubbles: true }));
      input!.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(saveAction).toHaveBeenCalledTimes(1);
    expect(saveAction.mock.calls[0]?.[0]).toContain('https://mindos.you/docs/table');
  });
});
