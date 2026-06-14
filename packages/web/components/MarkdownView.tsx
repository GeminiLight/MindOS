'use client';

import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import rehypeRaw from 'rehype-raw';
import rehypeSlug from 'rehype-slug';
import { useState, useCallback, useEffect, useId, useMemo } from 'react';
import { Copy, Check, X, ChevronDown } from 'lucide-react';
import { copyToClipboard } from '@/lib/clipboard';
import { toast } from '@/lib/toast';
import { resolveImagePath } from '@/lib/image';
import { splitMarkdownFrontmatter, type FrontmatterValue } from '@/lib/parsing/frontmatter';
import {
  fetchPluginMarkdownCodeBlockSnapshots,
  fetchPluginMarkdownPostProcessorSnapshots,
  fetchPluginSurfaces,
  type PluginMarkdownCodeBlockRender,
  type PluginMarkdownCodeBlockRequest,
  type PluginMarkdownPostProcessorRender,
} from '@/lib/plugins/client';
import type { PluginSurface } from '@/lib/plugins/surfaces';
import type { Components, Options as ReactMarkdownOptions } from 'react-markdown';

type RehypePlugin = NonNullable<ReactMarkdownOptions['rehypePlugins']>[number];

interface MarkdownViewProps {
  content: string;
  /** Lines changed by AI (1-indexed). Shows banner + fades after timeout. */
  highlightLines?: number[];
  /** Callback to dismiss the highlight banner */
  onDismissHighlight?: () => void;
  /** Placeholder shown when content is empty (read mode) */
  emptyPlaceholder?: string;
  /** Relative markdown path used by Obsidian compatibility processors. */
  sourcePath?: string;
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

type MarkdownHookMap = Map<string, PluginSurface[]>;
type MarkdownRenderMap = Map<string, PluginMarkdownCodeBlockRender[]>;
type MarkdownCodeBlockRenderState = PluginMarkdownCodeBlockRender & { blockId: string };

function getCodeLanguage(children: React.ReactNode): string {
  if (!children || typeof children !== 'object' || !('props' in children)) return '';
  const codeEl = children as React.ReactElement<{ className?: string }>;
  const className = codeEl.props?.className ?? '';
  const match = className.match(/(?:^|\s)language-([^\s]+)/);
  return match?.[1]?.toLowerCase() ?? '';
}

function markdownHookSummary(language: string, surfaces: PluginSurface[]): string {
  if (surfaces.length === 1) return `Obsidian hook: ${surfaces[0].pluginName}`;
  return `${surfaces.length} Obsidian hooks for \`\`\`${language}`;
}

function markdownHookHostLabel(surfaces: PluginSurface[]): string {
  const mounted = surfaces.some((surface) => surface.host.state === 'mounted');
  const catalog = surfaces.some((surface) => surface.host.state === 'catalog');
  if (mounted) return 'Mounted';
  if (catalog) return 'Catalog';
  return 'Recorded only';
}

function normalizeCodeBlockSource(source: string): string {
  return source.replace(/\n$/, '');
}

function markdownCodeBlockId(language: string, source: string): string {
  const normalized = `${language}\n${source}`;
  let hash = 2166136261;
  for (let index = 0; index < normalized.length; index += 1) {
    hash ^= normalized.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return `code-block-${language}-${(hash >>> 0).toString(36)}`;
}

function extractFencedCodeBlocks(markdown: string): PluginMarkdownCodeBlockRequest[] {
  const blocks = new Map<string, PluginMarkdownCodeBlockRequest>();
  const fencePattern = /(?:^|\n)(```|~~~)([^\n]*)\n([\s\S]*?)(?:\n\1)(?=\n|$)/g;
  let match: RegExpExecArray | null;
  while ((match = fencePattern.exec(markdown)) !== null) {
    const info = (match[2] ?? '').trim();
    const language = info.split(/\s+/)[0]?.replace(/^language-/, '').toLowerCase() ?? '';
    if (!language) continue;
    const source = normalizeCodeBlockSource(match[3] ?? '');
    const id = markdownCodeBlockId(language, source);
    if (!blocks.has(id)) {
      blocks.set(id, { id, language, source });
    }
  }
  return Array.from(blocks.values());
}

function isMarkdownCodeBlockSurface(surface: PluginSurface): boolean {
  return surface.kind === 'markdown'
    && surface.metadata !== undefined
    && typeof surface.metadata.language === 'string';
}

function isMarkdownPostProcessorSurface(surface: PluginSurface): boolean {
  return surface.kind === 'markdown'
    && surface.availability === 'available'
    && surface.metadata !== undefined
    && surface.metadata.processorType === 'post';
}

function scheduleMarkdownIdleWork(callback: () => void): () => void {
  const idleWindow = typeof window !== 'undefined'
    ? window as Window & typeof globalThis & {
      requestIdleCallback?: (cb: IdleRequestCallback, options?: IdleRequestOptions) => number;
      cancelIdleCallback?: (handle: number) => void;
    }
    : null;

  if (idleWindow?.requestIdleCallback) {
    const handle = idleWindow.requestIdleCallback(() => callback(), { timeout: 1_000 });
    return () => idleWindow.cancelIdleCallback?.(handle);
  }

  const handle = setTimeout(callback, 0);
  return () => clearTimeout(handle);
}

function MarkdownPostProcessorSnapshots({ renders }: { renders: PluginMarkdownPostProcessorRender[] }) {
  const visibleRenders = renders.filter((render) => render.text || render.error);
  if (visibleRenders.length === 0) return null;

  return (
    <section
      className="mb-4 rounded-lg border border-[var(--amber)]/20 bg-card/80 p-3 text-xs shadow-sm"
      data-plugin-markdown-post-processors
      aria-label="Obsidian markdown post processor snapshots"
    >
      <div className="mb-2 flex items-center justify-between gap-2 text-2xs">
        <span className="font-medium uppercase tracking-wider text-[var(--amber-text)]">
          Obsidian post-process snapshot
        </span>
        <span className="shrink-0 rounded-md border border-success/25 bg-success/10 px-1.5 py-0.5 text-success">
          Text only
        </span>
      </div>
      <div className="space-y-2">
        {visibleRenders.map((render) => (
          <div key={render.processorId} className="rounded-md border border-border/60 bg-background/70 px-2.5 py-2">
            <div className="mb-1 flex items-center justify-between gap-2">
              <span className="truncate text-2xs font-medium text-foreground">{render.pluginName}</span>
              {render.error && (
                <span className="shrink-0 text-2xs text-error">Render failed</span>
              )}
            </div>
            {render.error ? (
              <div className="text-2xs text-error">{render.error}</div>
            ) : (
              <pre className="whitespace-pre-wrap font-mono text-2xs leading-relaxed text-foreground">
                {render.text}
              </pre>
            )}
          </div>
        ))}
      </div>
    </section>
  );
}

function createMarkdownComponents(markdownHooks: MarkdownHookMap, markdownRenders: MarkdownRenderMap): Components {
  return {
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
      const language = getCodeLanguage(children);
      const hookSurfaces = language ? (markdownHooks.get(language) ?? []) : [];
      if (children && typeof children === 'object' && 'props' in children) {
        const codeEl = children as React.ReactElement<{ children?: React.ReactNode }>;
        codeString = extractText(codeEl.props?.children);
      }
      const normalizedCodeString = normalizeCodeBlockSource(codeString);
      const blockId = language ? markdownCodeBlockId(language, normalizedCodeString) : '';
      const renderedBlocks = blockId
        ? (markdownRenders.get(blockId) ?? markdownRenders.get(`language:${language}`) ?? [])
        : (language ? markdownRenders.get(`language:${language}`) ?? [] : []);
      const hasRenderSnapshot = renderedBlocks.length > 0;
      const shouldFloatHookBadge = hookSurfaces.length > 0 && !hasRenderSnapshot;

      const domProps = stripNonDom(rest);
      const preClassName = [
        typeof domProps.className === 'string' ? domProps.className : '',
        shouldFloatHookBadge ? '!pt-16' : '',
      ].filter(Boolean).join(' ');

      return (
        <div>
          {hookSurfaces.length > 0 && !shouldFloatHookBadge && (
            <div
              className="mb-2 flex w-fit max-w-full items-center gap-1.5 rounded-md border border-[var(--amber)]/25 bg-[var(--amber-subtle)] px-2 py-1 text-2xs text-[var(--amber-text)] shadow-sm backdrop-blur"
              data-plugin-markdown-hook={language}
              title={hookSurfaces.map((surface) => surface.host.description).join(' ')}
            >
              <span className="truncate font-medium">{markdownHookSummary(language, hookSurfaces)}</span>
              <span className="shrink-0 rounded bg-background/65 px-1.5 py-0.5 text-muted-foreground">
                {markdownHookHostLabel(hookSurfaces)}
              </span>
            </div>
          )}
          {hasRenderSnapshot && (
            <div
              className="mb-2 rounded-lg border border-[var(--amber)]/20 bg-card/80 p-3 text-xs shadow-sm"
              data-plugin-markdown-render={language}
            >
              <div className="mb-2 flex items-center justify-between gap-2 text-2xs">
                <span className="font-medium uppercase tracking-wider text-[var(--amber-text)]">
                  Obsidian render snapshot
                </span>
                <span className="shrink-0 rounded-md border border-success/25 bg-success/10 px-1.5 py-0.5 text-success">
                  Text only
                </span>
              </div>
              <div className="space-y-2">
                {renderedBlocks.map((render) => (
                  <div key={render.processorId} className="rounded-md border border-border/60 bg-background/70 px-2.5 py-2">
                    <div className="mb-1 flex items-center justify-between gap-2">
                      <span className="truncate text-2xs font-medium text-foreground">{render.pluginName}</span>
                      {render.error && (
                        <span className="shrink-0 text-2xs text-error">Render failed</span>
                      )}
                    </div>
                    {render.error ? (
                      <div className="text-2xs text-error">{render.error}</div>
                    ) : render.text ? (
                      <pre className="whitespace-pre-wrap font-mono text-2xs leading-relaxed text-foreground">
                        {render.text}
                      </pre>
                    ) : (
                      <div className="text-2xs text-muted-foreground">Processor did not render text content.</div>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}
          <div className="relative group">
            {hookSurfaces.length > 0 && shouldFloatHookBadge && (
              <div
                className="absolute left-2.5 top-2.5 z-10 flex max-w-[calc(100%-5.5rem)] items-center gap-1.5 rounded-md border border-[var(--amber)]/25 bg-[var(--amber-subtle)] px-2 py-1 text-2xs text-[var(--amber-text)] shadow-sm backdrop-blur"
                data-plugin-markdown-hook={language}
                title={hookSurfaces.map((surface) => surface.host.description).join(' ')}
              >
                <span className="truncate font-medium">{markdownHookSummary(language, hookSurfaces)}</span>
                <span className="shrink-0 rounded bg-background/65 px-1.5 py-0.5 text-muted-foreground">
                  {markdownHookHostLabel(hookSurfaces)}
                </span>
              </div>
            )}
            <pre {...domProps} className={preClassName || undefined} suppressHydrationWarning>{children}</pre>
            <CopyButton code={codeString} />
          </div>
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
}

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

export default function MarkdownView({ content, highlightLines, onDismissHighlight, emptyPlaceholder, sourcePath = '' }: MarkdownViewProps) {
  const hasHighlights = highlightLines && highlightLines.length > 0;
  const parsedMarkdown = splitMarkdownFrontmatter(content);
  const hasFencedCodeBlocks = /(^|\n)(```|~~~)/.test(parsedMarkdown.body);
  const fencedCodeBlocks = useMemo(
    () => hasFencedCodeBlocks ? extractFencedCodeBlocks(parsedMarkdown.body) : [],
    [hasFencedCodeBlocks, parsedMarkdown.body],
  );

  // Defer markdown rendering to the client to avoid hydration mismatches
  // caused by browser extensions (e.g. Twemoji) that replace emoji Unicode
  // with <img> tags before React hydrates.
  const [mounted, setMounted] = useState(false);
  const [markdownHookSurfaces, setMarkdownHookSurfaces] = useState<PluginSurface[]>([]);
  const [markdownCodeBlockRenders, setMarkdownCodeBlockRenders] = useState<MarkdownCodeBlockRenderState[]>([]);
  const [markdownPostProcessorRenders, setMarkdownPostProcessorRenders] = useState<PluginMarkdownPostProcessorRender[]>([]);
  useEffect(() => { setMounted(true); }, []);

  useEffect(() => {
    if (!mounted || !parsedMarkdown.body.trim()) {
      setMarkdownHookSurfaces([]);
      setMarkdownCodeBlockRenders([]);
      setMarkdownPostProcessorRenders([]);
      return;
    }
    let cancelled = false;
    let cancelDeferredPostProcessors: (() => void) | null = null;
    fetchPluginSurfaces('kind=markdown&source=obsidian')
      .then(async (surfaces) => {
        if (cancelled) return;
        const hookSurfaces = surfaces.filter(isMarkdownCodeBlockSurface);
        const postProcessorSurfaces = surfaces.filter(isMarkdownPostProcessorSurface);
        if (!cancelled) {
          setMarkdownHookSurfaces(hookSurfaces);
        }

        const availableLanguages = new Set(hookSurfaces
          .filter((surface) => surface.availability === 'available')
          .map((surface) => String(surface.metadata?.language ?? '').toLowerCase())
          .filter(Boolean));
        const renderBlocks = fencedCodeBlocks.filter((block) => availableLanguages.has(block.language));
        if (renderBlocks.length === 0) {
          if (!cancelled) setMarkdownCodeBlockRenders([]);
        } else {
          try {
            const snapshots = await fetchPluginMarkdownCodeBlockSnapshots(renderBlocks);
            if (!cancelled) {
              setMarkdownCodeBlockRenders(snapshots.flatMap((snapshot) => (
                snapshot.renders.map((render) => ({
                  ...render,
                  language: snapshot.language,
                  blockId: snapshot.id,
                }))
              )));
            }
          } catch {
            if (!cancelled) setMarkdownCodeBlockRenders([]);
          }
        }

        if (postProcessorSurfaces.length === 0) {
          if (!cancelled) setMarkdownPostProcessorRenders([]);
        } else {
          if (!cancelled) setMarkdownPostProcessorRenders([]);
          cancelDeferredPostProcessors = scheduleMarkdownIdleWork(() => {
            if (cancelled) return;
            fetchPluginMarkdownPostProcessorSnapshots(parsedMarkdown.body, sourcePath)
              .then((renders) => {
                if (!cancelled) setMarkdownPostProcessorRenders(renders);
              })
              .catch(() => {
                if (!cancelled) setMarkdownPostProcessorRenders([]);
              });
          });
        }
      })
      .catch(() => {
        if (!cancelled) {
          setMarkdownHookSurfaces([]);
          setMarkdownCodeBlockRenders([]);
          setMarkdownPostProcessorRenders([]);
        }
      });
    return () => {
      cancelled = true;
      cancelDeferredPostProcessors?.();
    };
  }, [fencedCodeBlocks, mounted, parsedMarkdown.body, sourcePath]);

  const markdownHooks = useMemo<MarkdownHookMap>(() => {
    const next: MarkdownHookMap = new Map();
    for (const surface of markdownHookSurfaces) {
      const language = typeof surface.metadata?.language === 'string'
        ? surface.metadata.language.toLowerCase()
        : '';
      if (!language) continue;
      const existing = next.get(language) ?? [];
      existing.push(surface);
      next.set(language, existing);
    }
    return next;
  }, [markdownHookSurfaces]);
  const markdownRenders = useMemo<MarkdownRenderMap>(() => {
    const next: MarkdownRenderMap = new Map();
    for (const render of markdownCodeBlockRenders) {
      const existing = next.get(render.blockId) ?? [];
      existing.push(render);
      next.set(render.blockId, existing);
      const languageKey = `language:${render.language.toLowerCase()}`;
      const languageExisting = next.get(languageKey) ?? [];
      languageExisting.push(render);
      next.set(languageKey, languageExisting);
    }
    return next;
  }, [markdownCodeBlockRenders]);
  const markdownComponents = useMemo(() => createMarkdownComponents(markdownHooks, markdownRenders), [markdownHooks, markdownRenders]);

  // rehype-highlight pulls in highlight.js (~100KB gz) — load it lazily so it
  // stays out of the /view route's first-load chunk. Code renders
  // un-highlighted for a frame and re-renders once the plugin arrives.
  const [highlightPlugin, setHighlightPlugin] = useState<RehypePlugin | null>(null);
  useEffect(() => {
    let cancelled = false;
    import('rehype-highlight')
      .then((mod) => {
        if (!cancelled) setHighlightPlugin(() => mod.default as RehypePlugin);
      })
      .catch((err) => {
        // Graceful degradation: code stays readable without highlighting.
        console.error('[MarkdownView] Failed to load syntax highlighter:', err);
    });
    return () => { cancelled = true; };
  }, []);

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
      <MarkdownPostProcessorSnapshots renders={markdownPostProcessorRenders} />
      <div className="prose max-w-none">
        {mounted ? (
          <ReactMarkdown
            remarkPlugins={[remarkGfm]}
            rehypePlugins={highlightPlugin ? [rehypeSlug, highlightPlugin, rehypeRaw] : [rehypeSlug, rehypeRaw]}
            components={markdownComponents}
          >
            {parsedMarkdown.body}
          </ReactMarkdown>
        ) : null}
      </div>
    </div>
  );
}
