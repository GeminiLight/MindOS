'use client';

/**
 * MarkdownMessage — streaming-friendly markdown renderer.
 *
 * Splits the source into stable top-level blocks (see markdown-blocks.ts) and
 * renders each through a memoized ReactMarkdown instance. During streaming
 * only the growing tail block re-parses, turning per-chunk render cost from
 * O(full document) into O(tail block). Output must be visually identical to a
 * single full-document ReactMarkdown pass (markdown-message-equivalence test).
 */

import { memo, useMemo } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { splitMarkdownBlocks } from './markdown-blocks';

const REMARK_PLUGINS = [remarkGfm];

const MarkdownBlock = memo(function MarkdownBlock({ source }: { source: string }) {
  return <ReactMarkdown remarkPlugins={REMARK_PLUGINS}>{source}</ReactMarkdown>;
});

const MarkdownMessage = memo(function MarkdownMessage({ content }: { content: string }) {
  const blocks = useMemo(() => splitMarkdownBlocks(content), [content]);
  return (
    <>
      {blocks.map((block, index) => (
        // Index keys are stable here: completed blocks never change position
        // while streaming (prefix-stability is covered by markdown-blocks tests).
        <MarkdownBlock key={index} source={block} />
      ))}
    </>
  );
});

export default MarkdownMessage;
