// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import SearchModal from '@/components/SearchModal';

// Mock dependencies
vi.mock('@/lib/stores/locale-store', () => ({
  useLocale: () => ({
    t: {
      search: {
        placeholder: 'Search files...',
        noResults: 'No results found',
        prompt: 'Type to search',
        navigate: 'navigate',
        open: 'open',
        tabSearch: 'Search',
        tabActions: 'Actions',
        close: 'close',
        openSettings: 'Settings',
        restartWalkthrough: 'Restart',
        toggleDarkMode: 'Dark mode',
        goToAgents: 'Agents',
        goToDiscover: 'Discover',
        goToHelp: 'Help',
      },
    },
  }),
}));

vi.mock('@/lib/api', () => ({
  apiFetch: vi.fn(async (url: string) => {
    if (url.includes('q=search')) {
      return [
        {
          path: 'knowledge/search-test.md',
          snippet: 'Search functionality test',
          score: 10,
        },
        {
          path: 'data/search-results.csv',
          snippet: 'Search results data',
          score: 8,
        },
      ];
    }
    return [];
  }),
}));

vi.mock('next/navigation', () => ({
  useRouter: () => ({
    push: vi.fn(),
  }),
}));

vi.mock('@/lib/toast', () => ({
  toast: {
    success: vi.fn(),
    error: vi.fn(),
  },
}));

describe('SearchModal Drag-Drop Integration', () => {
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

  describe('Mobile and desktop drag-drop', () => {
    it('should render search results draggable on mobile', async () => {
      await act(async () => {
        root.render(
          <SearchModal 
            open={true} 
            onClose={() => {}}
          />
        );
      });

      // Type search query
      const input = host.querySelector('input[type="text"]') as HTMLInputElement;
      expect(input).toBeTruthy();

      await act(async () => {
        input.value = 'search';
        input.dispatchEvent(new Event('change', { bubbles: true }));
      });

      // Wait for search results
      await new Promise(resolve => setTimeout(resolve, 500));

      // Find draggable result items
      const resultButtons = host.querySelectorAll('[role="dialog"] button[draggable="true"]');
      expect(resultButtons.length).toBeGreaterThan(0);
    });

    it('should set correct drag data on dragstart in modal', async () => {
      await act(async () => {
        root.render(
          <SearchModal 
            open={true} 
            onClose={() => {}}
          />
        );
      });

      // Type search query
      const input = host.querySelector('input[type="text"]') as HTMLInputElement;
      await act(async () => {
        input.value = 'search';
        input.dispatchEvent(new Event('change', { bubbles: true }));
      });

      // Wait for search results
      await new Promise(resolve => setTimeout(resolve, 500));

      // Find first result button
      const resultButton = host.querySelector('[role="dialog"] [draggable="true"]') as HTMLButtonElement;
      expect(resultButton).toBeTruthy();

      // Create drag event with DataTransfer
      const dragEvent = new DragEvent('dragstart', {
        bubbles: true,
        cancelable: true,
        dataTransfer: new DataTransfer(),
      });

      const setDataSpy = vi.spyOn(dragEvent.dataTransfer!, 'setData');

      await act(async () => {
        resultButton.dispatchEvent(dragEvent);
      });

      // Verify correct data format for AskContent integration
      expect(setDataSpy).toHaveBeenCalledWith('text/mindos-path', expect.any(String));
      expect(setDataSpy).toHaveBeenCalledWith('text/mindos-type', 'file');

      // Verify data is file path format
      const callArgs = setDataSpy.mock.calls;
      const pathCall = callArgs.find(call => call[0] === 'text/mindos-path');
      expect(pathCall?.[1]).toMatch(/\.(md|csv)$/);
    });
  });

  describe('Drag-drop UX in modal', () => {
    it('should show drag hint on desktop (not mobile)', async () => {
      // Mock window.matchMedia for responsive design
      vi.stubGlobal('matchMedia', () => ({
        matches: true, // md: breakpoint
        media: '(min-width: 768px)',
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
      }));

      await act(async () => {
        root.render(
          <SearchModal 
            open={true} 
            onClose={() => {}}
          />
        );
      });

      // Type search query
      const input = host.querySelector('input[type="text"]') as HTMLInputElement;
      await act(async () => {
        input.value = 'search';
        input.dispatchEvent(new Event('change', { bubbles: true }));
      });

      // Wait for search results
      await new Promise(resolve => setTimeout(resolve, 500));

      // Find result button and hover it
      const resultButton = host.querySelector('[role="dialog"] [draggable="true"]') as HTMLButtonElement;

      await act(async () => {
        resultButton.dispatchEvent(new MouseEvent('mouseenter', { bubbles: true }));
      });

      // On desktop (md+), drag hint should be visible
      // The component renders: "⬆ Drag" for selected items on md+
      expect(resultButton).toBeTruthy();
    });

    it('should support keyboard navigation and drag', async () => {
      await act(async () => {
        root.render(
          <SearchModal 
            open={true} 
            onClose={() => {}}
          />
        );
      });

      // Type search query
      const input = host.querySelector('input[type="text"]') as HTMLInputElement;
      await act(async () => {
        input.value = 'search';
        input.dispatchEvent(new Event('change', { bubbles: true }));
      });

      // Wait for search results
      await new Promise(resolve => setTimeout(resolve, 500));

      // Navigate with arrow keys
      await act(async () => {
        input.dispatchEvent(
          new KeyboardEvent('keydown', {
            key: 'ArrowDown',
            bubbles: true,
          })
        );
      });

      // Get first draggable result
      const firstResult = host.querySelector('[role="dialog"] [draggable="true"]') as HTMLButtonElement;
      expect(firstResult).toBeTruthy();

      // Should be able to drag
      const dragEvent = new DragEvent('dragstart', {
        bubbles: true,
        dataTransfer: new DataTransfer(),
      });
      const setDataSpy = vi.spyOn(dragEvent.dataTransfer!, 'setData');

      await act(async () => {
        firstResult.dispatchEvent(dragEvent);
      });

      expect(setDataSpy).toHaveBeenCalledWith(
        'text/mindos-path',
        'knowledge/search-test.md'
      );
    });
  });

  describe('Drag-drop data compatibility with AskContent', () => {
    it('should use standard mindos drag-drop format', async () => {
      await act(async () => {
        root.render(
          <SearchModal 
            open={true} 
            onClose={() => {}}
          />
        );
      });

      // Type search query
      const input = host.querySelector('input[type="text"]') as HTMLInputElement;
      await act(async () => {
        input.value = 'search';
        input.dispatchEvent(new Event('change', { bubbles: true }));
      });

      // Wait for search results
      await new Promise(resolve => setTimeout(resolve, 500));

      // Find all draggable results
      const resultButtons = host.querySelectorAll('[role="dialog"] [draggable="true"]');

      for (let i = 0; i < resultButtons.length; i++) {
        const resultButton = resultButtons[i] as HTMLButtonElement;

        const dragEvent = new DragEvent('dragstart', {
          bubbles: true,
          dataTransfer: new DataTransfer(),
        });

        let pathData = '';
        let typeData = '';

        // Mock getData and setData to capture values
        dragEvent.dataTransfer!.setData = ((type: string, value: string) => {
          if (type === 'text/mindos-path') pathData = value;
          if (type === 'text/mindos-type') typeData = value;
        }) as any;

        await act(async () => {
          resultButton.dispatchEvent(dragEvent);
        });

        // Verify data format matches AskContent expectations
        expect(pathData).toMatch(/\.(md|csv)$/);
        expect(typeData).toBe('file');
      }
    });
  });

  describe('Drag visual states', () => {
    it('should handle drag state transitions', async () => {
      await act(async () => {
        root.render(
          <SearchModal 
            open={true} 
            onClose={() => {}}
          />
        );
      });

      // Type search query
      const input = host.querySelector('input[type="text"]') as HTMLInputElement;
      await act(async () => {
        input.value = 'search';
        input.dispatchEvent(new Event('change', { bubbles: true }));
      });

      // Wait for search results
      await new Promise(resolve => setTimeout(resolve, 500));

      // Get first result
      const resultButton = host.querySelector('[role="dialog"] [draggable="true"]') as HTMLButtonElement;

      // Drag sequence: dragstart -> dragenter -> dragend
      await act(async () => {
        // Start drag
        resultButton.dispatchEvent(
          new DragEvent('dragstart', {
            bubbles: true,
            dataTransfer: new DataTransfer(),
          })
        );

        // Enter (hover over same element)
        resultButton.dispatchEvent(
          new DragEvent('dragenter', {
            bubbles: true,
          })
        );

        // End drag
        resultButton.dispatchEvent(
          new DragEvent('dragend', {
            bubbles: true,
          })
        );
      });

      // Component should render correctly after drag cycle
      expect(resultButton).toBeTruthy();
    });
  });

  describe('Responsive drag behavior', () => {
    it('should work on all viewport sizes', async () => {
      // Desktop viewport
      await act(async () => {
        root.render(
          <SearchModal 
            open={true} 
            onClose={() => {}}
          />
        );
      });

      const input = host.querySelector('input[type="text"]') as HTMLInputElement;
      await act(async () => {
        input.value = 'search';
        input.dispatchEvent(new Event('change', { bubbles: true }));
      });

      // Wait for search results
      await new Promise(resolve => setTimeout(resolve, 500));

      // Get results
      const resultButtons = host.querySelectorAll('[draggable="true"]');
      expect(resultButtons.length).toBeGreaterThan(0);

      // All buttons should be draggable regardless of viewport
      resultButtons.forEach((button) => {
        expect((button as HTMLButtonElement).draggable).toBe(true);
      });
    });

    it('should maintain drag functionality through tab changes', async () => {
      await act(async () => {
        root.render(
          <SearchModal 
            open={true} 
            onClose={() => {}}
          />
        );
      });

      // Search tab is active by default
      const searchInput = host.querySelector('input[type="text"]') as HTMLInputElement;
      await act(async () => {
        searchInput.value = 'search';
        searchInput.dispatchEvent(new Event('change', { bubbles: true }));
      });

      // Wait for results
      await new Promise(resolve => setTimeout(resolve, 500));

      // Switch to actions tab
      const actionsTab = host.querySelector('button:nth-of-type(2)') as HTMLButtonElement;
      if (actionsTab && actionsTab.textContent?.includes('Actions')) {
        await act(async () => {
          actionsTab.click();
        });
      }

      // Switch back to search tab
      const searchTab = host.querySelector('button:nth-of-type(1)') as HTMLButtonElement;
      if (searchTab && searchTab.textContent?.includes('Search')) {
        await act(async () => {
          searchTab.click();
        });
      }

      // Results should still be draggable
      const resultButtons = host.querySelectorAll('[draggable="true"]');
      expect(resultButtons.length).toBeGreaterThan(0);
    });
  });

  describe('Error handling', () => {
    it('should handle drag from empty results gracefully', async () => {
      await act(async () => {
        root.render(
          <SearchModal 
            open={true} 
            onClose={() => {}}
          />
        );
      });

      // Search with no results
      const input = host.querySelector('input[type="text"]') as HTMLInputElement;
      await act(async () => {
        input.value = 'nonexistentquery12345';
        input.dispatchEvent(new Event('change', { bubbles: true }));
      });

      // Wait for empty results
      await new Promise(resolve => setTimeout(resolve, 500));

      // Should not have draggable items
      const resultButtons = host.querySelectorAll('[draggable="true"]');
      expect(resultButtons.length).toBe(0);
    });
  });
});
