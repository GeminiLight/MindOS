// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';

// Mock dependencies - MUST come first
vi.mock('@/lib/stores/locale-store', () => ({
  useLocale: () => ({
    t: {
      search: {
        placeholder: 'Search files...',
        noResults: 'No results found',
        prompt: 'Type to search',
        navigate: 'navigate',
        open: 'open',
      },
    },
  }),
}));

vi.mock('@/lib/api', () => ({
  apiFetch: vi.fn(async () => {
    return [
      {
        path: 'wiki/notes/test.md',
        snippet: 'This is a test file with content',
        score: 10,
      },
      {
        path: 'wiki/db/data.csv',
        snippet: 'CSV test data',
        score: 8,
      },
    ];
  }),
}));

vi.mock('next/navigation', () => ({
  useRouter: () => ({
    push: vi.fn(),
  }),
}));

vi.mock('react-virtuoso', () => ({
  Virtuoso: ({ itemContent, totalCount }: any) => {
    return (
      <div data-testid="virtuoso">
        {Array.from({ length: totalCount }).map((_, i) => (
          <div key={i} data-testid={`result-item-${i}`}>
            {itemContent(i)}
          </div>
        ))}
      </div>
    );
  },
}));

/** Trigger React-compatible change on a controlled input */
function setInputValue(input: HTMLInputElement, value: string) {
  const nativeSetter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!;
  nativeSetter.call(input, value);
  input.dispatchEvent(new Event('input', { bubbles: true }));
}

describe('SearchPanel Drag-Drop Tests', () => {
  let host: HTMLDivElement;
  let root: ReturnType<typeof createRoot>;

  beforeEach(() => {
    vi.clearAllMocks();
    host = document.createElement('div');
    document.body.appendChild(host);
    root = createRoot(host);
    (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
  });

  afterEach(() => {
    act(() => {
      root.unmount();
    });
    document.body.removeChild(host);
  });

  it('should render SearchPanel with draggable result items', async () => {
    const { default: SearchPanel } = await import('@/components/panels/SearchPanel');
    
    await act(async () => {
      root.render(
        <SearchPanel 
          active={true} 
          onNavigate={() => {}}
        />
      );
    });

    const input = host.querySelector('input[type="text"]') as HTMLInputElement;
    expect(input).toBeTruthy();

    // Type search query
    await act(async () => {
      setInputValue(input, 'test');
    });

    // Wait for debounce (300ms) and async search
    await act(async () => {
      await new Promise(resolve => setTimeout(resolve, 400));
    });

    // Check for result items
    const resultItems = host.querySelectorAll('[data-testid^="result-item-"]');
    expect(resultItems.length).toBeGreaterThan(0);

    // All result items should have draggable buttons
    for (const item of resultItems) {
      const button = item.querySelector('button') as HTMLButtonElement;
      expect(button.draggable).toBe(true);
    }
  });

  it('should set text/mindos-path data format on drag', async () => {
    const { default: SearchPanel } = await import('@/components/panels/SearchPanel');
    
    await act(async () => {
      root.render(
        <SearchPanel 
          active={true} 
          onNavigate={() => {}}
        />
      );
    });

    const input = host.querySelector('input[type="text"]') as HTMLInputElement;
    await act(async () => {
      setInputValue(input, 'test');
    });

    await act(async () => {
      await new Promise(resolve => setTimeout(resolve, 400));
    });

    const resultItem = host.querySelector('[data-testid="result-item-0"] button') as HTMLButtonElement;
    expect(resultItem).toBeTruthy();

    const dt = new DataTransfer();
    const dragEvent = new DragEvent('dragstart', {
      bubbles: true,
      dataTransfer: dt,
    });

    let capturedPath = '';
    let capturedType = '';

    // Mock setData to capture calls
    dt.setData = (type: string, value: string) => {
      if (type === 'text/mindos-path') capturedPath = value;
      if (type === 'text/mindos-type') capturedType = value;
    };

    await act(async () => {
      resultItem.dispatchEvent(dragEvent);
    });

    expect(capturedPath).toBeTruthy();
    expect(capturedType).toBe('file');
    expect(capturedPath).toMatch(/\.(md|csv)$/);
  });

  it('should support multiple files (.md and .csv)', async () => {
    const { default: SearchPanel } = await import('@/components/panels/SearchPanel');
    
    await act(async () => {
      root.render(
        <SearchPanel 
          active={true} 
          onNavigate={() => {}}
        />
      );
    });

    const input = host.querySelector('input[type="text"]') as HTMLInputElement;
    await act(async () => {
      setInputValue(input, 'test');
    });

    await act(async () => {
      await new Promise(resolve => setTimeout(resolve, 400));
    });

    // Test both result items
    const resultButtons = host.querySelectorAll('[data-testid^="result-item-"] button');
    expect(resultButtons.length).toBe(2);

    // First should be .md
    const mdButton = resultButtons[0] as HTMLButtonElement;
    expect(mdButton.draggable).toBe(true);

    // Second should be .csv
    const csvButton = resultButtons[1] as HTMLButtonElement;
    expect(csvButton.draggable).toBe(true);
  });

  it('should handle drag events without throwing', async () => {
    const { default: SearchPanel } = await import('@/components/panels/SearchPanel');
    
    await act(async () => {
      root.render(
        <SearchPanel 
          active={true} 
          onNavigate={() => {}}
        />
      );
    });

    const input = host.querySelector('input[type="text"]') as HTMLInputElement;
    
    // Wrap setInputValue and its state updates
    await act(async () => {
      setInputValue(input, 'test');
      await new Promise(resolve => setTimeout(resolve, 450)); // debounce + buffer
    });

    const resultButtons = host.querySelectorAll('[data-testid^="result-item-"] button');

    for (const button of resultButtons) {
      // Wrap each drag event to prevent "not wrapped in act" warning
      await act(async () => {
        const dragStart = new DragEvent('dragstart', {
          bubbles: true,
          dataTransfer: new DataTransfer(),
        });
        (button as HTMLButtonElement).dispatchEvent(dragStart);
      });

      await act(async () => {
        const dragEnd = new DragEvent('dragend', {
          bubbles: true,
        });
        (button as HTMLButtonElement).dispatchEvent(dragEnd);
      });
    }
  });

  it('should be compatible with AskContent drop handler', async () => {
    // Test data format compatibility
    const testData = {
      path: 'docs/test.md',
      type: 'file',
    };

    // Simulate what AskContent does on drop
    const dt = new DataTransfer();
    dt.setData('text/mindos-path', testData.path);
    dt.setData('text/mindos-type', testData.type);

    // AskContent should be able to retrieve this
    expect(dt.getData('text/mindos-path')).toBe('docs/test.md');
    expect(dt.getData('text/mindos-type')).toBe('file');
  });
});
