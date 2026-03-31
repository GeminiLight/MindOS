'use client';

import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import rehypeHighlight from 'rehype-highlight';
import rehypeRaw from 'rehype-raw';
import rehypeSlug from 'rehype-slug';
import { useState, useCallback } from 'react';
import { Copy, Check } from 'lucide-react';
import { copyToClipboard } from '@/lib/clipboard';
import { toast } from '@/lib/toast';
import type { Components } from 'react-markdown';

interface MarkdownViewProps {
  content: string;
  /** Lines to highlight (1-indexed). Shown with amber left border. Fades after timeout. */
  highlightLines?: number[];
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

// Heading components with suppressHydrationWarning to prevent
// rehype-slug + emoji hydration mismatches between server and client
function makeHeading(Tag: 'h1' | 'h2' | 'h3' | 'h4' | 'h5' | 'h6') {
  const HeadingComponent = ({ children, ...props }: React.HTMLAttributes<HTMLHeadingElement>) => (
    <Tag {...props} suppressHydrationWarning>{children}</Tag>
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
  code({ children, ...props }) {
    return <code {...props} suppressHydrationWarning>{children}</code>;
  },
  pre({ children, ...props }) {
    // Extract code string from children
    let codeString = '';
    if (children && typeof children === 'object' && 'props' in children) {
      const codeEl = children as React.ReactElement<{ children?: React.ReactNode }>;
      codeString = extractText(codeEl.props?.children);
    }
    return (
      <div className="relative group">
        <pre {...props} suppressHydrationWarning>{children}</pre>
        <CopyButton code={codeString} />
      </div>
    );
  },
  li({ children, ...props }) {
    return <li {...props} suppressHydrationWarning>{children}</li>;
  },
  a({ href, children, ...props }) {
    const isExternal = href?.startsWith('http');
    return (
      <a
        href={href}
        target={isExternal ? '_blank' : undefined}
        rel={isExternal ? 'noopener noreferrer' : undefined}
        {...props}
      >
        {children}
      </a>
    );
  },
  img({ src, alt, ...props }) {
    if (!src) return null;
    // eslint-disable-next-line @next/next/no-img-element
    return <img src={src} alt={alt ?? ''} {...props} />;
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

export default function MarkdownView({ content, highlightLines }: MarkdownViewProps) {
  const hasHighlights = highlightLines && highlightLines.length > 0;

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
          <span className="w-1.5 h-1.5 rounded-full bg-[var(--amber)] animate-pulse" />
          <span className="font-display font-medium">
            {highlightLines.length} line{highlightLines.length !== 1 ? 's' : ''} updated by AI
          </span>
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
