import { describe, it, expect } from 'vitest';
import { renderMarkdown as renderSkillMarkdown } from '@/components/agents/SkillDetailPopover';
import { appendSummaryStreamChunk, renderMarkdown } from '@/components/renderers/summary/SummaryRenderer';
import { renderBody } from '@/components/renderers/timeline/TimelineRenderer';

describe('generated renderer HTML safety', () => {
  it('escapes HTML in AI-generated summary markdown', () => {
    const html = renderMarkdown('## Update\n<script>alert(1)</script>\n**<img src=x onerror=alert(1)>**');

    expect(html).not.toContain('<script>');
    expect(html).not.toContain('<img');
    expect(html).toContain('&lt;script&gt;');
    expect(html).toContain('&lt;img');
  });

  it('parses MindOS summary SSE without rendering raw event JSON', () => {
    const text = appendSummaryStreamChunk('', [
      'data:{"type":"text_delta","delta":"Hello "}',
      'data:{"type":"thinking_delta","delta":"world"}',
      '',
    ].join('\n'));

    expect(text).toBe('Hello world');
  });

  it('throws summary stream errors instead of appending them as text', () => {
    expect(() => appendSummaryStreamChunk('', 'data:{"type":"error","message":"Model failed"}\n'))
      .toThrow('Model failed');
  });

  it('escapes timeline body HTML and rejects unsafe links', () => {
    const html = renderBody('- [click](javascript:alert(1))\n- [host](//example.com)\n- <img src=x onerror=alert(1)>');

    expect(html).not.toContain('javascript:alert');
    expect(html.match(/href="#"/g)).toHaveLength(2);
    expect(html).not.toContain('<img');
    expect(html).toContain('&lt;img');
  });

  it('escapes HTML in skill detail markdown', () => {
    const html = renderSkillMarkdown('# Skill\n<script>alert(1)</script>\n`<img src=x>`');

    expect(html).not.toContain('<script>');
    expect(html).not.toContain('<img');
    expect(html).toContain('&lt;script&gt;');
    expect(html).toContain('&lt;img');
  });
});
