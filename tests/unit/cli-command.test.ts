import { describe, expect, it } from 'vitest';

import { parseArgs } from '../../packages/mindos/bin/lib/command.js';

describe('CLI argument parser', () => {
  it('keeps -p and --print as boolean flags so the following task stays positional', () => {
    expect(parseArgs(['agent', '-p', 'hello world'])).toEqual({
      command: 'agent',
      args: ['hello world'],
      flags: { p: true },
    });

    expect(parseArgs(['agent', '--print', 'hello world'])).toEqual({
      command: 'agent',
      args: ['hello world'],
      flags: { print: true },
    });
  });

  it('keeps agent permission toggles as boolean flags so task text stays positional', () => {
    expect(parseArgs(['agent', '--readonly', 'review this'])).toEqual({
      command: 'agent',
      args: ['review this'],
      flags: { readonly: true },
    });

    expect(parseArgs(['agent', '--agent', '--no-thinking', 'fix this'])).toEqual({
      command: 'agent',
      args: ['fix this'],
      flags: { agent: true, 'no-thinking': true },
    });
  });

  it('parses --flag=value without swallowing the next positional argument', () => {
    expect(parseArgs(['agent', '--port=4567', '--max-steps=3', 'summarize notes'])).toEqual({
      command: 'agent',
      args: ['summarize notes'],
      flags: { port: '4567', 'max-steps': '3' },
    });
  });

  it('preserves value flags and supports -- as a literal separator', () => {
    expect(parseArgs(['file', 'write', 'note.md', '--content', '# Title'])).toEqual({
      command: 'file',
      args: ['write', 'note.md'],
      flags: { content: '# Title' },
    });

    expect(parseArgs(['agent', '--', '--not-a-flag'])).toEqual({
      command: 'agent',
      args: ['--not-a-flag'],
      flags: {},
    });
  });
});
