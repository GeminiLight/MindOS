'use client';

import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import rehypeHighlight from 'rehype-highlight';
import rehypeRaw from 'rehype-raw';
import rehypeSlug from 'rehype-slug';
import { useState, useCallback, useEffect, useId } from 'react';
import { Copy, Check, X, ChevronDown } from 'lucide-react';
import { copyToClipboard } from '@/lib/clipboard';
import { toast } from '@/lib/toast';
import { resolveImagePath } from '@/lib/image';
import { splitMarkdownFrontmatter, type FrontmatterValue } from '@/lib/parsing/frontmatter';
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
        hit-target-box inline-flex h-8 w-8 items-center justify-center
        text-muted-foreground hover:text-foreground
        transition-colors duration-75
        opacity-60 group-hover:opacity-100
        focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring
        touch-manipulation
        [--hit-target-bg:var(--muted)]
        [--hit-target-hover-bg:var(--accent)]
        [--hit-target-radius:var(--radius-md)]
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
  span({ children, node, ...rest }) {
    void node;
    return <span {...stripNonDom(rest)} suppressHydrationWarning>{children}</span>;
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
    const resolvedSrc = typeof src === 'string' ? resolveImagePath(src) : src;
    // eslint-disable-next-line @next/next/no-img-element
    return <img src={resolvedSrc} alt={alt ?? ''} {...stripNonDom(rest)} />;
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

function formatPrimitiveValue(value: string | number | boolean | null | Date): string {
  if (value === null || value === '') return 'empty';
  if (value instanceof Date) return value.toISOString().replace(/T00:00:00\.000Z$/, '');
  if (typeof value === 'boolean') return value ? 'true' : 'false';
  return String(value);
}

function renderFrontmatterValue(value: FrontmatterValue): React.ReactNode {
  if (Array.isArray(value)) {
    if (value.length === 0) {
      return <span className="markdown-frontmatter__empty">empty list</span>;
    }
    return (
      <span className="markdown-frontmatter__chips">
        {value.map((item, index) => (
          <span className="markdown-frontmatter__chip" key={`${index}-${JSON.stringify(item)}`}>
            {typeof item === 'object' && item !== null && !(item instanceof Date)
              ? JSON.stringify(item)
              : formatPrimitiveValue(item)}
          </span>
        ))}
      </span>
    );
  }

  if (value && typeof value === 'object' && !(value instanceof Date)) {
    return <code className="markdown-frontmatter__object">{JSON.stringify(value)}</code>;
  }

  if (value === null || value === '') {
    return <span className="markdown-frontmatter__empty">{formatPrimitiveValue(value)}</span>;
  }

  return <span>{formatPrimitiveValue(value)}</span>;
}

function FrontmatterPanel({ frontmatter }: { frontmatter: NonNullable<ReturnType<typeof splitMarkdownFrontmatter>['frontmatter']> }) {
  const [expanded, setExpanded] = useState(false);
  const listId = useId();

  if (frontmatter.entries.length === 0) return null;

  return (
    <section className="markdown-frontmatter" aria-label="Markdown properties" data-expanded={expanded}>
      <button
        type="button"
        className="markdown-frontmatter__toggle"
        aria-expanded={expanded}
        aria-controls={listId}
        onClick={() => setExpanded((value) => !value)}
      >
        <span className="markdown-frontmatter__label">Properties</span>
        <span className="markdown-frontmatter__meta">
          <span className="markdown-frontmatter__count">
            {frontmatter.entries.length} field{frontmatter.entries.length === 1 ? '' : 's'}
          </span>
          <ChevronDown className="markdown-frontmatter__chevron" size={14} aria-hidden="true" />
        </span>
      </button>
      {expanded && (
        <dl className="markdown-frontmatter__list" id={listId}>
          {frontmatter.entries.map((entry) => (
            <div className="markdown-frontmatter__row" key={entry.key}>
              <dt title={entry.key}>{entry.key}</dt>
              <dd>{renderFrontmatterValue(entry.value)}</dd>
            </div>
          ))}
        </dl>
      )}
    </section>
  );
}

export default function MarkdownView({ content, highlightLines, onDismissHighlight, emptyPlaceholder }: MarkdownViewProps) {
  const hasHighlights = highlightLines && highlightLines.length > 0;
  const parsedMarkdown = splitMarkdownFrontmatter(content);

  // Defer markdown rendering to the client to avoid hydration mismatches
  // caused by browser extensions (e.g. Twemoji) that replace emoji Unicode
  // with <img> tags before React hydrates.
  const [mounted, setMounted] = useState(false);
  useEffect(() => { setMounted(true); }, []);

  if (!content.trim() && emptyPlaceholder) {
    return (
      <div className="py-16 text-center text-sm text-muted-foreground/60">
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
              className="hit-target-box inline-flex h-7 w-7 shrink-0 items-center justify-center transition-colors duration-75 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring touch-manipulation [--hit-target-hover-bg:color-mix(in_srgb,var(--amber)_15%,transparent)] [--hit-target-radius:var(--radius-sm)]"
              aria-label="Dismiss"
            >
              <X size={12} />
            </button>
          )}
        </div>
      )}
      {parsedMarkdown.frontmatter && (
        <FrontmatterPanel frontmatter={parsedMarkdown.frontmatter} />
      )}
      <div className="prose max-w-none">
        {mounted ? (
          <ReactMarkdown
            remarkPlugins={[remarkGfm]}
            rehypePlugins={[rehypeSlug, rehypeHighlight, rehypeRaw]}
            components={components}
          >
            {parsedMarkdown.body}
          </ReactMarkdown>
        ) : null}
      </div>
    </div>
  );
}
