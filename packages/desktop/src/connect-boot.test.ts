import { describe, expect, it } from 'vitest';
import { splitErrorDetail } from './connect-boot';

describe('splitErrorDetail', () => {
  it('lifts an indented line out of the prose as a command', () => {
    // The real port-conflict message from main-strings.portsAllInUse.
    const message = '端口 3456–3465 都被占用了。\n请关闭占用这些端口的程序后重试：\n  lsof -nP -iTCP:3456 -sTCP:LISTEN';
    expect(splitErrorDetail(message)).toEqual([
      { kind: 'prose', text: '端口 3456–3465 都被占用了。\n请关闭占用这些端口的程序后重试：' },
      { kind: 'command', text: 'lsof -nP -iTCP:3456 -sTCP:LISTEN' },
    ]);
  });

  it('keeps a message with no commands as a single run of prose', () => {
    expect(splitErrorDetail('Startup failed.\nTry again.')).toEqual([
      { kind: 'prose', text: 'Startup failed.\nTry again.' },
    ]);
  });

  it('groups consecutive command lines into one block', () => {
    expect(splitErrorDetail('Run:\n  npm install\n  npm run build')).toEqual([
      { kind: 'prose', text: 'Run:' },
      { kind: 'command', text: 'npm install\nnpm run build' },
    ]);
  });

  it('returns to prose after a command', () => {
    expect(splitErrorDetail('Before\n  cmd\nAfter')).toEqual([
      { kind: 'prose', text: 'Before' },
      { kind: 'command', text: 'cmd' },
      { kind: 'prose', text: 'After' },
    ]);
  });

  it('treats a tab-indented line as a command too', () => {
    expect(splitErrorDetail('x\n\tcmd')).toEqual([
      { kind: 'prose', text: 'x' },
      { kind: 'command', text: 'cmd' },
    ]);
  });

  it('does not mistake a single leading space for a command', () => {
    expect(splitErrorDetail(' not a command')).toEqual([{ kind: 'prose', text: ' not a command' }]);
  });

  it('drops blank lines at the edges of prose but keeps them inside', () => {
    expect(splitErrorDetail('\nA\n\nB\n\n  cmd')).toEqual([
      { kind: 'prose', text: 'A\n\nB' },
      { kind: 'command', text: 'cmd' },
    ]);
  });

  it('handles an empty message', () => {
    expect(splitErrorDetail('')).toEqual([]);
  });

  it('keeps markup-looking text as text', () => {
    // The renderer builds DOM nodes from these, so this must stay inert.
    const [only] = splitErrorDetail('<img src=x onerror=alert(1)>');
    expect(only).toEqual({ kind: 'prose', text: '<img src=x onerror=alert(1)>' });
  });
});
