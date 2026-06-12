'use client';

import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';

/**
 * Markdown renderer for Echo insight content.
 *
 * Lives in its own module so react-markdown (~46KB gz) stays out of the Echo
 * first-screen chunk — EchoInsightCollapsible dynamic-imports this when the
 * insight panel is opened.
 */
export default function EchoInsightMarkdown({ markdown }: { markdown: string }) {
  return <ReactMarkdown remarkPlugins={[remarkGfm]}>{markdown}</ReactMarkdown>;
}
