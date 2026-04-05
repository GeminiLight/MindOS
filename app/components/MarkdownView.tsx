'use client';

import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import rehypeHighlight from 'rehype-highlight';
import rehypeRaw from 'rehype-raw';
import rehypeSlug from 'rehype-slug';
import { useState, useCallback } from 'react';
import { Copy, Check, X } from 'lucide-react';
import { copyToClipboard } from '@/lib/clipboard';
import { toast } from '@/lib/toast';
import type { Components } from 'react-markdown';

interface MarkdownViewProps {
  content: string;
  /** Lines changed by AI (1-indexed). Shows banner + fades after timeout. */
  highlightLines?: number[];
  /** Callback to dismiss the highlight banner */
  onDismissHighlight?: () => void;
  /** Placeholder shown when content is empty (read mode) */
  emptyPlaceholder?: string;
}

function CopyButton({ code }: { code: string }) {
  const [copied, setCopied] = useState(false);
  const handleCopy = useCallback(() => {
    copyToClipboard(code).then((ok) => {
      if (ok) {
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
        toast.copy();
      }
    });
  }, [code]);

  return (
    <button
      onClick={handleCopy}
      className="
        absolute top-2.5 right-2.5
        p-1.5 rounded-md
        bg-muted hover:bg-accent
        text-muted-foreground hover:text-foreground
        transition-colors duration-100
        opacity-0 group-hover:opacity-100
      "
      title="Copy code"
    >
      {copied ? <Check size={13} /> : <Copy size={13} />}
    </button>
  );
}

// react-markdown passes an AST `node` prop to custom components;
// strip it (and any other non-DOM keys) before forwarding to the real element.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function stripNonDom(props: Record<string, any>): Record<string, any> {
  const { node, inline, ordered, depth, isHeader, ...domProps } = props;
  return domProps;
}

function makeHeading(Tag: 'h1' | 'h2' | 'h3' | 'h4' | 'h5' | 'h6') {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const HeadingComponent = ({ children, ...props }: any) => (
    <Tag {...stripNonDom(props)} suppressHydrationWarning>{children}</Tag>
  );
  HeadingComponent.displayName = Tag;
  return HeadingComponent;
}

const components: Components = {
  h1: makeHeading('h1'),
  h2: makeHeading('h2'),
  h3: makeHeading('h3'),
  h4: makeHeading('h4'),
  h5: makeHeading('h5'),
  h6: makeHeading('h6'),
  code({ children, node, ...rest }) {
    void node;
    return <code {...stripNonDom(rest)} suppressHydrationWarning>{children}</code>;
  },
  pre({ children, node, ...rest }) {
    void node;
    let codeString = '';
    if (children && typeof children === 'object' && 'props' in children) {
      const codeEl = children as React.ReactElement<{ children?: React.ReactNode }>;
      codeString = extractText(codeEl.props?.children);
    }
    return (
      <div className="relative group">
        <pre {...stripNonDom(rest)} suppressHydrationWarning>{children}</pre>
        <CopyButton code={codeString} />
      </div>
    );
  },
  li({ children, node, ...rest }) {
    void node;
    return <li {...stripNonDom(rest)} suppressHydrationWarning>{children}</li>;
  },
  p({ children, node, ...rest }) {
    void node;
    return <p {...stripNonDom(rest)} suppressHydrationWarning>{children}</p>;
  },
  a({ href, children, node, ...rest }) {
    void node;
    const isExternal = href?.startsWith('http');
    return (
      <a
        href={href}
        target={isExternal ? '_blank' : undefined}
        rel={isExternal ? 'noopener noreferrer' : undefined}
        {...stripNonDom(rest)}
      >
        {children}
      </a>
    );
  },
  img({ src, alt, node, ...rest }) {
    void node;
    if (!src) return null;
    // eslint-disable-next-line @next/next/no-img-element
    return <img src={src} alt={alt ?? ''} {...stripNonDom(rest)} />;
  },
};

function extractText(node: React.ReactNode): string {
  if (typeof node === 'string') return node;
  if (Array.isArray(node)) return node.map(extractText).join('');
  if (node && typeof node === 'object' && 'props' in node) {
    return extractText((node as React.ReactElement<{ children?: React.ReactNode }>).props?.children);
  }
  return '';
}

export default function MarkdownView({ content, highlightLines, onDismissHighlight, emptyPlaceholder }: MarkdownViewProps) {
  const hasHighlights = highlightLines && highlightLines.length > 0;

  if (!content.trim() && emptyPlaceholder) {
    return (
      <div className="py-12 text-center text-sm text-muted-foreground/50">
        {emptyPlaceholder}
      </div>
    );
  }

  return (
    <div>
      {/* Change indicator banner */}
      {hasHighlights && (
        <div
          className="mb-4 flex items-center gap-2 rounded-md border px-3 py-2 text-xs animate-in fade-in-0 duration-300"
          style={{
            borderColor: 'color-mix(in srgb, var(--amber) 40%, var(--border))',
            background: 'color-mix(in srgb, var(--amber) 8%, var(--card))',
            color: 'var(--amber)',
          }}
          data-highlight-line
        >
          <span className="w-1.5 h-1.5 rounded-full bg-[var(--amber)] animate-pulse shrink-0" />
          <span className="font-display font-medium flex-1">
            {highlightLines.length} line{highlightLines.length !== 1 ? 's' : ''} updated by AI
          </span>
          {onDismissHighlight && (
            <button
              type="button"
              onClick={onDismissHighlight}
              className="p-0.5 rounded hover:bg-[var(--amber)]/15 transition-colors shrink-0"
              aria-label="Dismiss"
            >
              <X size={12} />
            </button>
          )}
        </div>
      )}
      <div className="prose max-w-none">
        <ReactMarkdown
          remarkPlugins={[remarkGfm]}
          rehypePlugins={[rehypeSlug, rehypeHighlight, rehypeRaw]}
          components={components}
        >
          {content}
        </ReactMarkdown>
      </div>
    </div>
  );
}
