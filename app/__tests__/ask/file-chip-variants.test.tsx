// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import FileChip from '@/components/ask/FileChip';

describe('FileChip variants', () => {
  it('renders ACP agent chips with an amber bot icon', () => {
    const html = renderToStaticMarkup(
      <FileChip path="Claude Code" variant="agent" onRemove={() => {}} />,
    );

    expect(html).toContain('Claude Code');
    expect(html).toContain('lucide-bot');
    expect(html).toContain('text-[var(--amber)]');
    expect(html).not.toContain('lucide-zap');
  });
});
