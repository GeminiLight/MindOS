// @vitest-environment jsdom
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import ToolCallDiffView from '@/components/ask/ToolCallDiffView';

/**
 * External agents (Claude Code, Codex, Gemini …) report edits as structured ACP
 * diffs. Before this view they were invisible in chat — the regression this
 * guards (spec-acp-first-agent-integration 验收标准 Phase 1a).
 */

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let host: HTMLDivElement;
let root: Root;

function render(node: React.ReactNode) {
  act(() => root.render(node));
  return host;
}

beforeEach(() => {
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
});

describe('ToolCallDiffView', () => {
  it('shows the edited file with its added and removed line counts', () => {
    render(<ToolCallDiffView diffs={[{ path: '/notes/todo.md', oldText: 'one\ntwo', newText: 'one\nthree' }]} />);

    expect(host.textContent).toContain('todo.md');
    expect(host.textContent).toContain('+1');
    expect(host.textContent).toContain('-1');
    expect(host.textContent).toContain('three');
  });

  it('renders a created file as all additions', () => {
    render(<ToolCallDiffView diffs={[{ path: '/notes/new.md', oldText: '', newText: 'first\nsecond' }]} />);

    expect(host.textContent).toContain('+2');
    expect(host.textContent).not.toContain('-1');
  });

  it('renders an emptied file as all removals', () => {
    render(<ToolCallDiffView diffs={[{ path: '/notes/gone.md', oldText: 'body\ntail', newText: '' }]} />);

    expect(host.textContent).toContain('-2');
  });

  it('lists every edited file when one tool call touched several', () => {
    render(<ToolCallDiffView diffs={[
      { path: '/a.md', oldText: 'a', newText: 'b' },
      { path: '/nested/b.md', oldText: 'c', newText: 'd' },
    ]} />);

    expect(host.textContent).toContain('a.md');
    expect(host.textContent).toContain('b.md');
  });

  it('tells the user when the agent file content was clipped', () => {
    render(<ToolCallDiffView diffs={[{ path: '/big.md', oldText: 'a', newText: 'b', truncated: true }]} />);

    expect(host.textContent).toContain('truncated');
  });

  it('renders nothing when a reported file did not actually change', () => {
    render(<ToolCallDiffView diffs={[{ path: '/same.md', oldText: 'same', newText: 'same' }]} />);

    expect(host.textContent).toBe('');
  });

  it('renders nothing for an empty diff list rather than an empty panel', () => {
    render(<ToolCallDiffView diffs={[]} />);

    expect(host.textContent).toBe('');
  });

  it('keeps a very large rewrite bounded so the chat stays responsive', () => {
    const oldText = Array.from({ length: 2000 }, (_unused, index) => `old ${index}`).join('\n');
    const newText = Array.from({ length: 2000 }, (_unused, index) => `new ${index}`).join('\n');

    render(<ToolCallDiffView diffs={[{ path: '/huge.md', oldText, newText }]} />);

    expect(host.querySelectorAll('div').length).toBeLessThan(500);
    expect(host.textContent).toContain('truncated');
  });

  it('shows a unicode path and emoji content without mangling them', () => {
    render(<ToolCallDiffView diffs={[{ path: '/笔记/待办.md', oldText: 'a', newText: '完成 ✅' }]} />);

    expect(host.textContent).toContain('待办.md');
    expect(host.textContent).toContain('完成 ✅');
  });
});
