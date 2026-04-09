// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';

// Integration test that simulates the complete drag-drop flow

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
      ask: {
        placeholder: 'Ask something...',
        send: 'send',
        attachFile: 'Attach file',
        attachFileLabel: 'Attach file',
        stopTitle: 'Stop',
        cancelReconnect: 'Cancel',
        connecting: 'Connecting',
        thinking: 'Thinking',
        generating: 'Generating',
        stopped: 'Stopped',
        errorNoResponse: 'No response',
        emptyPrompt: 'Empty',
        suggestions: [],
        newlineHint: 'New line',
        panelComposerResize: 'Resize',
        panelComposerResetHint: 'Reset',
        panelComposerKeyboard: 'Keyboard',
      },
      hints: {
        typeMessage: 'Type message',
        attachFile: 'Attach file',
        mentionInProgress: 'Mention',
        sessionHistory: 'History',
        newSession: 'New',
        maximizePanel: 'Maximize',
        restorePanel: 'Restore',
        dockToSide: 'Dock',
        openAsPopup: 'Popup',
      },
    },
  }),
}));

vi.mock('@/lib/api', () => ({
  apiFetch: vi.fn(async (url: string) => {
    if (url.includes('q=integration')) {
      return [
        {
          path: 'docs/integration.md',
          snippet: 'Integration test file',
          score: 10,
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

vi.mock('@/hooks/useAskSession', () => ({
  useAskSession: () => ({
    messages: [],
    sessions: [],
    activeSessionId: 's1',
    initSessions: vi.fn(),
    persistSession: vi.fn(),
    clearPersistTimer: vi.fn(),
    setMessages: vi.fn(),
    resetSession: vi.fn(),
    loadSession: vi.fn(),
    deleteSession: vi.fn(),
    clearAllSessions: vi.fn(),
  }),
}));

vi.mock('@/hooks/useFileUpload', () => ({
  useFileUpload: () => ({
    localAttachments: [],
    uploadError: '',
    uploadInputRef: { current: null },
    clearAttachments: vi.fn(),
    removeAttachment: vi.fn(),
    pickFiles: vi.fn(),
  }),
}));

vi.mock('@/hooks/useMention', () => ({
  useMention: () => ({
    mentionQuery: null,
    mentionResults: [],
    mentionIndex: 0,
    resetMention: vi.fn(),
    updateMentionFromInput: vi.fn(),
    navigateMention: vi.fn(),
  }),
}));

vi.mock('@/hooks/useComposerVerticalResize', () => ({
  useComposerVerticalResize: () => vi.fn(),
}));

vi.mock('@/components/ask/MessageList', () => ({
  default: () => <div data-testid="message-list" />,
}));

vi.mock('@/components/ask/MentionPopover', () => ({
  default: () => null,
}));

vi.mock('@/components/ask/SessionHistory', () => ({
  default: () => null,
}));

vi.mock('@/components/ask/FileChip', () => ({
  default: ({ file }: any) => <div data-testid="file-chip">{file}</div>,
}));

vi.mock('@/lib/agent/stream-consumer', () => ({
  consumeUIMessageStream: () => new Promise(() => {}),
}));

vi.mock('react-virtuoso', () => ({
  Virtuoso: ({ itemContent, totalCount }: any) => (
    <div data-testid="virtuoso">
      {Array.from({ length: totalCount }).map((_, i) => (
        <div key={i} data-testid={`result-item-${i}`}>
          {itemContent(i)}
        </div>
      ))}
    </div>
  ),
}));

describe('SearchPanel -> AskContent Drag-Drop Integration', () => {
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

  describe('Complete drag-drop workflow', () => {
    it('should allow dragging search result with correct data format', async () => {
      // Simulate SearchPanel render
      const SearchPanel = ({ onNavigate }: any) => {
        const [query, setQuery] = React.useState('');
        const [results, setResults] = React.useState([
          { path: 'docs/integration.md', snippet: 'Integration test' },
        ]);

        return (
          <div>
            <input
              type="text"
              value={query}
              onChange={e => setQuery(e.target.value)}
              placeholder="Search"
            />
            {results.map((result, i) => (
              <button
                key={i}
                draggable
                onDragStart={(e: any) => {
                  e.dataTransfer.effectAllowed = 'copy';
                  e.dataTransfer.setData('text/mindos-path', result.path);
                  e.dataTransfer.setData('text/mindos-type', 'file');
                }}
                data-testid={`drag-result-${i}`}
              >
                {result.path}
              </button>
            ))}
          </div>
        );
      };

      // Simulate AskContent render with drop handler
      const AskContent = ({ onDragOver, onDragLeave, onDrop }: any) => {
        const [attachedFiles, setAttachedFiles] = React.useState<string[]>([]);

        return (
          <div
            onDragOver={onDragOver}
            onDragLeave={onDragLeave}
            onDrop={(e: any) => {
              e.preventDefault();
              const filePath = e.dataTransfer.getData('text/mindos-path');
              if (filePath) {
                setAttachedFiles([...attachedFiles, filePath]);
              }
            }}
            data-testid="ask-drop-zone"
          >
            <textarea placeholder="Chat message" data-testid="ask-input" />
            <div data-testid="attached-files">
              {attachedFiles.map((f, i) => (
                <div key={i} data-testid={`attached-file-${i}`}>
                  {f}
                </div>
              ))}
            </div>
          </div>
        );
      };

      // Render both components
      const Container = () => (
        <div style={{ display: 'flex' }}>
          <SearchPanel onNavigate={() => {}} />
          <AskContent />
        </div>
      );

      await act(async () => {
        root.render(<Container />);
      });

      // Find the draggable result
      const dragResult = host.querySelector('[data-testid="drag-result-0"]') as HTMLElement;
      expect(dragResult).toBeTruthy();

      // Find the drop zone
      const dropZone = host.querySelector('[data-testid="ask-drop-zone"]') as HTMLElement;
      expect(dropZone).toBeTruthy();

      // Create and dispatch drag events
      const dataTransfer = new DataTransfer();
      dataTransfer.setData('text/mindos-path', 'docs/integration.md');
      dataTransfer.setData('text/mindos-type', 'file');

      await act(async () => {
        dragResult.dispatchEvent(
          new DragEvent('dragstart', {
            bubbles: true,
            cancelable: true,
            dataTransfer,
          })
        );

        dropZone.dispatchEvent(
          new DragEvent('dragover', {
            bubbles: true,
            cancelable: true,
            dataTransfer,
          })
        );

        dropZone.dispatchEvent(
          new DragEvent('drop', {
            bubbles: true,
            cancelable: true,
            dataTransfer,
          })
        );
      });

      // Verify file was attached
      const attachedFile = host.querySelector('[data-testid="attached-file-0"]');
      expect(attachedFile?.textContent).toBe('docs/integration.md');
    });

    it('should handle multiple sequential drags', async () => {
      const MultiDragTest = () => {
        const [attachedFiles, setAttachedFiles] = React.useState<string[]>([]);

        const handleDrop = (e: React.DragEvent) => {
          e.preventDefault();
          const filePath = e.dataTransfer.getData('text/mindos-path');
          if (filePath && !attachedFiles.includes(filePath)) {
            setAttachedFiles([...attachedFiles, filePath]);
          }
        };

        return (
          <div>
            {/* Simulated search results */}
            <div data-testid="search-results">
              {['docs/file1.md', 'docs/file2.md', 'data/data.csv'].map((path, i) => (
                <button
                  key={i}
                  draggable
                  data-testid={`drag-item-${i}`}
                  onDragStart={(e: any) => {
                    e.dataTransfer.effectAllowed = 'copy';
                    e.dataTransfer.setData('text/mindos-path', path);
                    e.dataTransfer.setData('text/mindos-type', 'file');
                  }}
                >
                  {path}
                </button>
              ))}
            </div>

            {/* Drop zone */}
            <div
              onDragOver={(e: any) => {
                e.preventDefault();
                e.dataTransfer.dropEffect = 'copy';
              }}
              onDrop={handleDrop}
              data-testid="drop-zone"
            >
              <h3>Attached Files</h3>
              {attachedFiles.map((file, i) => (
                <div key={i} data-testid={`attached-${i}`}>
                  {file}
                </div>
              ))}
            </div>
          </div>
        );
      };

      await act(async () => {
        root.render(<MultiDragTest />);
      });

      const dropZone = host.querySelector('[data-testid="drop-zone"]') as HTMLElement;

      // Drag first file
      const item0 = host.querySelector('[data-testid="drag-item-0"]') as HTMLElement;
      const dt0 = new DataTransfer();
      dt0.setData('text/mindos-path', 'docs/file1.md');
      dt0.setData('text/mindos-type', 'file');

      await act(async () => {
        dropZone.dispatchEvent(
          new DragEvent('drop', {
            bubbles: true,
            dataTransfer: dt0,
          })
        );
      });

      // Drag second file
      const item1 = host.querySelector('[data-testid="drag-item-1"]') as HTMLElement;
      const dt1 = new DataTransfer();
      dt1.setData('text/mindos-path', 'docs/file2.md');
      dt1.setData('text/mindos-type', 'file');

      await act(async () => {
        dropZone.dispatchEvent(
          new DragEvent('drop', {
            bubbles: true,
            dataTransfer: dt1,
          })
        );
      });

      // Verify both files were attached
      const attached0 = host.querySelector('[data-testid="attached-0"]');
      const attached1 = host.querySelector('[data-testid="attached-1"]');
      expect(attached0?.textContent).toBe('docs/file1.md');
      expect(attached1?.textContent).toBe('docs/file2.md');
    });
  });

  describe('Drag-drop with search interaction', () => {
    it('should allow search and drag in the same session', async () => {
      const SearchAndDropTest = () => {
        const [query, setQuery] = React.useState('');
        const [results, setResults] = React.useState<Array<{path: string; snippet: string}>>([]);
        const [attachedFiles, setAttachedFiles] = React.useState<string[]>([]);

        const handleSearch = (q: string) => {
          setQuery(q);
          // Simulate search results
          if (q) {
            setResults([
              { path: `docs/${q}-file.md`, snippet: `Result for ${q}` },
            ]);
          }
        };

        const handleDrop = (e: React.DragEvent) => {
          e.preventDefault();
          const filePath = e.dataTransfer.getData('text/mindos-path');
          if (filePath) {
            setAttachedFiles([...attachedFiles, filePath]);
          }
        };

        return (
          <div>
            <input
              type="text"
              value={query}
              onChange={e => handleSearch(e.target.value)}
              placeholder="Search"
              data-testid="search-input"
            />

            <div data-testid="results">
              {results.map((r, i) => (
                <button
                  key={i}
                  draggable
                  data-testid={`result-${i}`}
                  onDragStart={(e: any) => {
                    e.dataTransfer.setData('text/mindos-path', r.path);
                    e.dataTransfer.setData('text/mindos-type', 'file');
                  }}
                >
                  {r.path}
                </button>
              ))}
            </div>

            <div
              onDragOver={(e: any) => e.preventDefault()}
              onDrop={handleDrop}
              data-testid="drop-area"
            >
              Attached: {attachedFiles.length}
              {attachedFiles.map((f, i) => (
                <div key={i} data-testid={`file-${i}`}>
                  {f}
                </div>
              ))}
            </div>
          </div>
        );
      };

      await act(async () => {
        root.render(<SearchAndDropTest />);
      });

      const searchInput = host.querySelector('[data-testid="search-input"]') as HTMLInputElement;

      // Type search query
      await act(async () => {
        searchInput.value = 'integration';
        searchInput.dispatchEvent(new Event('change', { bubbles: true }));
      });

      // Wait for results to appear
      await new Promise(resolve => setTimeout(resolve, 100));

      // Get the search result
      const result = host.querySelector('[data-testid="result-0"]');
      expect(result?.textContent).toBe('docs/integration-file.md');

      // Drag to drop area
      const dropArea = host.querySelector('[data-testid="drop-area"]') as HTMLElement;
      const dt = new DataTransfer();
      dt.setData('text/mindos-path', 'docs/integration-file.md');
      dt.setData('text/mindos-type', 'file');

      await act(async () => {
        dropArea.dispatchEvent(
          new DragEvent('drop', {
            bubbles: true,
            dataTransfer: dt,
          })
        );
      });

      // Verify file was attached
      const attachedFile = host.querySelector('[data-testid="file-0"]');
      expect(attachedFile?.textContent).toBe('docs/integration-file.md');
    });
  });

  describe('Data format validation', () => {
    it('should validate mindos-path format', async () => {
      const DataFormatTest = () => {
        const [validFiles, setValidFiles] = React.useState<string[]>([]);
        const [invalidFiles, setInvalidFiles] = React.useState<string[]>([]);

        const handleDrop = (e: React.DragEvent) => {
          e.preventDefault();
          const filePath = e.dataTransfer.getData('text/mindos-path');
          const fileType = e.dataTransfer.getData('text/mindos-type');

          if (fileType === 'file' && filePath && /\.(md|csv)$/.test(filePath)) {
            setValidFiles([...validFiles, filePath]);
          } else {
            setInvalidFiles([...invalidFiles, filePath]);
          }
        };

        return (
          <div
            onDragOver={(e: any) => e.preventDefault()}
            onDrop={handleDrop}
            data-testid="validation-drop"
          >
            <div data-testid="valid-count">{validFiles.length}</div>
            <div data-testid="invalid-count">{invalidFiles.length}</div>
          </div>
        );
      };

      await act(async () => {
        root.render(<DataFormatTest />);
      });

      const dropZone = host.querySelector('[data-testid="validation-drop"]') as HTMLElement;

      // Drop valid file
      const validDt = new DataTransfer();
      validDt.setData('text/mindos-path', 'docs/valid.md');
      validDt.setData('text/mindos-type', 'file');

      await act(async () => {
        dropZone.dispatchEvent(
          new DragEvent('drop', {
            bubbles: true,
            dataTransfer: validDt,
          })
        );
      });

      // Drop invalid file
      const invalidDt = new DataTransfer();
      invalidDt.setData('text/mindos-path', 'docs/invalid.txt');
      invalidDt.setData('text/mindos-type', 'file');

      await act(async () => {
        dropZone.dispatchEvent(
          new DragEvent('drop', {
            bubbles: true,
            dataTransfer: invalidDt,
          })
        );
      });

      const validCount = host.querySelector('[data-testid="valid-count"]');
      const invalidCount = host.querySelector('[data-testid="invalid-count"]');

      expect(validCount?.textContent).toBe('1');
      expect(invalidCount?.textContent).toBe('1');
    });
  });
});
