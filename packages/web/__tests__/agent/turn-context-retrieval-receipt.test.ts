import { beforeEach, describe, expect, it, vi } from 'vitest';

const recallMock = vi.hoisted(() => vi.fn());

vi.mock('@/lib/agent/active-recall', () => ({
  performActiveRecallWithReceipt: recallMock,
}));

vi.mock('@/lib/fs', async (importOriginal) => ({
  ...await importOriginal<typeof import('@/lib/fs')>(),
  getFileContent: vi.fn(),
  getMindRoot: vi.fn(() => '/mock/mind'),
  collectAllFiles: vi.fn(() => []),
}));

import { recallMindosTurnKnowledgeWithReceipt } from '../../app/api/agent/_lib/turn-context';

describe('turn context retrieval receipt', () => {
  beforeEach(() => {
    recallMock.mockReset();
  });

  it('returns recalled items and run metadata linked to the chat session receipt', async () => {
    recallMock.mockResolvedValue({
      items: [{ path: 'notes/a.md', content: 'A', score: 3 }],
      receipt: { id: 'retrieval-1' },
      metadata: {
        retrievalReceiptId: 'retrieval-1',
        retrievalSelectedAssetIds: ['asset-a'],
        retrievalOutcome: 'selected',
      },
    });

    const result = await recallMindosTurnKnowledgeWithReceipt({
      mindRoot: '/mock/mind',
      chatSessionId: 'chat-1',
      lastUserContent: 'find the architecture note',
      currentFile: 'current.md',
      attachedFiles: ['attached.md'],
      sessionSpaces: [{ path: 'Projects/One' }],
      activeRecall: { maxTokens: 800, maxFiles: 4, minScore: 0.5 },
    });

    expect(result.items).toEqual([{ path: 'notes/a.md', content: 'A', score: 3 }]);
    expect(result.metadata).toMatchObject({
      retrievalReceiptId: 'retrieval-1',
      retrievalSelectedAssetIds: ['asset-a'],
      retrievalOutcome: 'selected',
    });
    expect(recallMock).toHaveBeenCalledWith('/mock/mind', 'find the architecture note', {
      maxTokens: 800,
      maxFiles: 4,
      minScore: 0.5,
      excludePaths: ['current.md', 'attached.md'],
      preferredPaths: ['Projects/One'],
    }, { chatSessionId: 'chat-1' });
  });

  it('fails open with empty retrieval metadata when observability throws', async () => {
    recallMock.mockRejectedValue(new Error('receipt store unavailable'));
    const result = await recallMindosTurnKnowledgeWithReceipt({
      mindRoot: '/mock/mind',
      lastUserContent: 'find a note',
      sessionSpaces: [],
    });

    expect(result).toEqual({
      items: [],
      metadata: {
        retrievalSelectedAssetIds: [],
        retrievalOutcome: 'error',
      },
    });
  });

  it('persists a skipped receipt when active recall is explicitly disabled', async () => {
    recallMock.mockResolvedValue({
      items: [],
      receipt: { id: 'retrieval-disabled' },
      metadata: {
        retrievalReceiptId: 'retrieval-disabled',
        retrievalSelectedAssetIds: [],
        retrievalOutcome: 'skipped',
      },
    });

    const result = await recallMindosTurnKnowledgeWithReceipt({
      mindRoot: '/mock/mind',
      chatSessionId: 'chat-disabled',
      lastUserContent: 'do not search',
      sessionSpaces: [],
      activeRecall: { enabled: false },
    });

    expect(result.metadata).toMatchObject({
      retrievalReceiptId: 'retrieval-disabled',
      retrievalOutcome: 'skipped',
    });
    expect(recallMock).toHaveBeenCalledWith('/mock/mind', 'do not search', expect.any(Object), {
      chatSessionId: 'chat-disabled',
      trigger: 'disabled',
      skip: true,
    });
  });
});
