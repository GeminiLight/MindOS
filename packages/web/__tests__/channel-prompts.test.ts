import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const question = vi.fn();
const close = vi.fn();
const createInterface = vi.fn(() => ({
  question,
  close,
  closed: false,
}));

vi.mock('node:readline', () => ({
  default: {
    createInterface,
    emitKeypressEvents: vi.fn(),
  },
}));

describe('channel prompts', () => {
  const originalIsTTY = process.stdin.isTTY;
  const originalSetRawMode = (process.stdin as NodeJS.ReadStream & { setRawMode?: (mode: boolean) => void }).setRawMode;

  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    Object.defineProperty(process.stdin, 'isTTY', { value: false, configurable: true });
    (process.stdin as NodeJS.ReadStream & { setRawMode?: (mode: boolean) => void }).setRawMode = vi.fn();
  });

  afterEach(() => {
    Object.defineProperty(process.stdin, 'isTTY', { value: originalIsTTY, configurable: true });
    (process.stdin as NodeJS.ReadStream & { setRawMode?: (mode: boolean) => void }).setRawMode = originalSetRawMode;
  });

  it('falls back to readline question when tty hidden mode is unavailable', async () => {
    question.mockImplementation((_prompt: string, cb: (answer: string) => void) => cb('secret-value'));
    const { promptHidden } = await import('../../../packages/mindos/bin/lib/channel-prompts.js');
    const result = await promptHidden('Enter secret: ');
    expect(result).toBe('secret-value');
    expect(question).toHaveBeenCalled();
  });

  it('recreates the readline interface after closePrompts', async () => {
    const { closePrompts } = await import('../../../packages/mindos/bin/lib/channel-prompts.js');
    closePrompts();
    expect(close).toHaveBeenCalled();
    expect(createInterface).toHaveBeenCalledTimes(2);
  });
});
