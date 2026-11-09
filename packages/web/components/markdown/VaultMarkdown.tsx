'use client';

/**
 * The single renderer for vault markdown.
 *
 * Every surface that shows note content — the reading view, a transcluded
 * `![[note]]`, a canvas text node — renders through this module. It owns the
 * three things that used to be copied per surface and drifted apart:
 *
 *  1. the remark plugin chain (`VAULT_REMARK_PLUGINS`);
 *  2. the component overrides that need the vault — wiki-link navigation and
 *     broken-link marking, tag chips, attachment resolution, note embeds;
 *  3. the vault file index those overrides resolve against.
 *
 * Embeds are single-level by construction: an embed renders its body with
 * `embeds={false}`, so a `![[...]]` inside embedded content becomes a link.
 * There is no recursion, hence no cycle to detect.
 */

import { createContext, useContext, useEffect, useMemo, useState, type MouseEvent, type ReactNode } from 'react';
import ReactMarkdown, { type Components, type Options as ReactMarkdownOptions } from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { buildWikiLinkBasenameMap, resolveWikiLinkTarget } from '@geminilight/mindos/foundation/markdown';
import { EmbeddedNote, parseEmbedSubpath } from '@/components/markdown/EmbeddedNote';
import { shouldHandleSmoothNavigation, useSmoothRouterPush } from '@/hooks/useSmoothRouterPush';
import { fetchAllFilePaths } from '@/lib/client-cache';
import { resolveImagePath } from '@/lib/image';
import { isExternalMarkdownHref, resolveMarkdownInternalHref } from '@/lib/markdown-links';
import remarkBlockId from '@/lib/markdown/remark-block-id';
import remarkCallout from '@/lib/markdown/remark-callout';
import remarkInlineTag from '@/lib/markdown/remark-inline-tag';
import remarkWikiLink from '@/lib/markdown/remark-wikilink';
import { requestSearchQuery } from '@/lib/search-events';
import { encodePath } from '@/lib/utils';

/**
 * Order matters: wiki links are tokenised before tags so `[[Note#Heading]]`
 * is never read as a tag, and block ids are stripped last, after every other
 * transform has seen the text.
 */
export const VAULT_REMARK_PLUGINS = [remarkGfm, remarkWikiLink, remarkInlineTag, remarkCallout, remarkBlockId];

/* ── vault index ─────────────────────────────────────────────────────────── */

export type VaultIndex = {
  files: ReadonlySet<string>;
  basenames: ReadonlyMap<string, string[]>;
} | null;

/**
 * `undefined` means "no provider above me"; `null` means "a provider exists but
 * the file list has not loaded (or failed)". Keeping them distinct lets nested
 * renderers inherit the parent's index instead of each fetching their own.
 */
const VaultIndexContext = createContext<VaultIndex | undefined>(undefined);

/**
 * Load the vault file list and index it for wiki-link resolution.
 *
 * Backed by the shared single-flight cache, so many callers cost one request.
 * Stays null until loaded and on failure — callers treat null as "unknown" and
 * degrade (links unmarked, attachments unresolved) rather than break.
 *
 * @param refreshKey re-fetch when this changes, e.g. the note content, so a note
 *   that was just created stops reading as a broken link.
 * @param enabled skip the fetch entirely, for renderers that inherit an index.
 */
export function useVaultIndex(refreshKey?: unknown, enabled = true): VaultIndex {
  const [files, setFiles] = useState<string[] | null>(null);

  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;
    fetchAllFilePaths()
      .then((paths) => { if (!cancelled) setFiles(Array.isArray(paths) ? paths : null); })
      .catch(() => { if (!cancelled) setFiles(null); });
    return () => { cancelled = true; };
  }, [enabled, refreshKey]);

  return useMemo(() => {
    if (!files) return null;
    const set = new Set(files);
    return { files: set, basenames: buildWikiLinkBasenameMap(set) };
  }, [files]);
}

/** Share one vault index with every vault renderer underneath. */
export function VaultIndexProvider({ value, children }: { value: VaultIndex; children: ReactNode }) {
  return <VaultIndexContext.Provider value={value}>{children}</VaultIndexContext.Provider>;
}

/** The index from the nearest provider, or a self-loaded one when there is none. */
export function useInheritedVaultIndex(refreshKey?: unknown): VaultIndex {
  const inherited = useContext(VaultIndexContext);
  const own = useVaultIndex(refreshKey, inherited === undefined);
  return inherited === undefined ? own : inherited;
}

/* ── helpers ─────────────────────────────────────────────────────────────── */

/** Drop react-markdown's non-DOM props before forwarding to a real element. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function stripNonDom(props: Record<string, any>): Record<string, any> {
  const { node, inline, ordered, depth, isHeader, ...domProps } = props;
  void node; void inline; void ordered; void depth; void isHeader;
  return domProps;
}

/** Obsidian link targets omit `.md`; path-relative fallbacks need it. */
function withMarkdownExtension(target: string): string {
  return /\.md$/i.test(target) ? target : `${target}.md`;
}

function viewHref(vaultPath: string, fragment = ''): string {
  return `/view/${encodePath(vaultPath)}${fragment}`;
}

/** Resolve a wiki target against the vault; null when unknown or missing. */
function resolveTarget(target: string, vaultIndex: VaultIndex): string | null {
  if (!vaultIndex || !target) return null;
  return resolveWikiLinkTarget(target, vaultIndex.files, vaultIndex.basenames);
}

/**
 * Turn a vault-relative asset reference into an absolute vault path.
 *
 * Leaves URLs and already-absolute paths alone, and falls back to the original
 * string when the index is unavailable or the name does not resolve — a missing
 * image should render as a broken image, not crash the note.
 */
function toVaultAbsolutePath(src: string, vaultIndex: VaultIndex): string {
  if (!vaultIndex || /^([a-z]+:)?\/\//i.test(src) || src.startsWith('/') || src.startsWith('data:')) return src;
  // react-markdown percent-encodes urls, so a CJK or spaced filename arrives
  // escaped and would never match a vault path.
  let decoded = src;
  try { decoded = decodeURIComponent(src); } catch { /* keep the raw form */ }
  const resolved = resolveTarget(decoded, vaultIndex);
  return resolved ? `/${resolved}` : src;
}

/* ── component overrides ─────────────────────────────────────────────────── */

export type VaultComponentOptions = {
  /** Vault path of the note being rendered; relative links resolve from it. */
  sourcePath: string;
  vaultIndex: VaultIndex;
  navigateInternalHref: (href: string) => void;
  /** Render standalone `![[note]]` as transcluded content. False inside embeds. */
  embeds: boolean;
};

/**
 * Overrides for the elements whose meaning depends on the vault. Surfaces add
 * their own presentation overrides on top; these must not be replaced.
 */
export function createVaultComponents({
  sourcePath,
  vaultIndex,
  navigateInternalHref,
  embeds,
}: VaultComponentOptions): Pick<Components, 'a' | 'img' | 'div'> {
  const anchor = (
    domProps: Record<string, unknown>,
    href: string | undefined,
    children: ReactNode,
  ) => {
    // `remark-inline-tag` stamps the tag name. A tag has no vault path, so it is
    // a button that opens search rather than a navigable link.
    const tag = domProps['data-tag'];
    if (typeof tag === 'string' && tag.length > 0) {
      return (
        <button
          type="button"
          className="markdown-tag"
          data-tag={tag}
          title={`搜索 #${tag}`}
          onClick={() => requestSearchQuery(`#${tag}`)}
        >
          {children}
        </button>
      );
    }

    // `remark-wikilink` stamps the raw target. Obsidian resolves links by name
    // across the whole vault, so navigate to where the note actually lives —
    // a path-relative href would point at a sibling of the source note and
    // 404 whenever the target is in another folder. Until the index loads (or
    // if the target is missing) fall back to the relative form.
    const wikiTarget = typeof domProps['data-wikilink'] === 'string' ? domProps['data-wikilink'] as string : '';
    const resolvedWiki = wikiTarget ? resolveTarget(wikiTarget, vaultIndex) : null;
    const unresolved = vaultIndex !== null && wikiTarget.length > 0 && resolvedWiki === null;

    let resolvedHref: string | undefined;
    if (resolvedWiki) {
      const hashAt = href?.indexOf('#') ?? -1;
      resolvedHref = viewHref(resolvedWiki, hashAt >= 0 ? href!.slice(hashAt) : '');
    } else {
      resolvedHref = resolveMarkdownInternalHref(href, sourcePath);
    }

    const isExternal = isExternalMarkdownHref(resolvedHref);
    const isInternalDocumentLink = typeof resolvedHref === 'string' && resolvedHref.startsWith('/view/');
    const handleClick = (event: MouseEvent<HTMLAnchorElement>) => {
      if (!isInternalDocumentLink || !shouldHandleSmoothNavigation(event)) return;
      event.preventDefault();
      navigateInternalHref(resolvedHref!);
    };

    return (
      <a
        {...domProps}
        href={resolvedHref}
        target={isExternal ? '_blank' : undefined}
        rel={isExternal ? 'noopener noreferrer' : undefined}
        {...(unresolved ? { 'data-wikilink-unresolved': 'true' } : {})}
        title={unresolved ? `未找到：${wikiTarget}` : undefined}
        onClick={handleClick}
      >
        {children}
      </a>
    );
  };

  return {
    a({ href, children, ...rest }) {
      return anchor(stripNonDom(rest), href, children);
    },

    img({ src, alt, ...rest }) {
      if (!src) return null;
      // A relative src (`![[diagram.png]]`, `![](assets/pic.png)`) would be
      // resolved by the browser against /view/..., which serves no files. Look
      // the name up in the vault so `resolveImagePath` yields /api/file/raw.
      const resolvedSrc = typeof src === 'string' ? resolveImagePath(toVaultAbsolutePath(src, vaultIndex)) : src;
      // eslint-disable-next-line @next/next/no-img-element
      return <img src={resolvedSrc} alt={alt ?? ''} {...stripNonDom(rest)} />;
    },

    div({ children, ...rest }) {
      const domProps = stripNonDom(rest);
      // `remark-wikilink` lifts a standalone `![[note]]` into a div carrying the
      // target. At the top level it becomes transcluded content; inside an embed
      // it collapses to an ordinary link, which is what keeps embeds one level.
      const embedTarget = domProps['data-wikilink-note-embed'];
      if (typeof embedTarget === 'string' && embedTarget.length > 0) {
        const subpathRaw = domProps['data-wikilink-subpath'] as string | undefined;
        if (embeds) {
          return <VaultNoteEmbed target={embedTarget} subpath={subpathRaw} vaultIndex={vaultIndex} />;
        }
        const subpath = parseEmbedSubpath(subpathRaw);
        const fragment = subpath ? `#${subpath.type === 'block' ? `block-${subpath.value}` : subpath.value}` : '';
        return (
          <p>
            {anchor({ 'data-wikilink': embedTarget, 'data-wikilink-embed': 'true' }, `${withMarkdownExtension(embedTarget)}${fragment}`, children)}
          </p>
        );
      }
      return <div {...domProps} suppressHydrationWarning>{children}</div>;
    },
  };
}

/* ── renderers ───────────────────────────────────────────────────────────── */

/**
 * Render a transcluded note. Binds `EmbeddedNote` (which only fetches and slices)
 * to this renderer for the body, with embeds turned off.
 */
export function VaultNoteEmbed({
  target,
  subpath,
  vaultIndex,
}: {
  target: string;
  /** `heading:Title` / `block:id`, as stamped by `remark-wikilink`. */
  subpath?: string;
  vaultIndex: VaultIndex;
}) {
  return (
    <EmbeddedNote
      target={target}
      subpath={parseEmbedSubpath(subpath)}
      vaultIndex={vaultIndex}
      renderBody={(content, path) => (
        <VaultIndexProvider value={vaultIndex}>
          <VaultMarkdown content={content} sourcePath={path} embeds={false} />
        </VaultIndexProvider>
      )}
    />
  );
}

/**
 * Render vault markdown with every Obsidian syntax MindOS supports.
 *
 * Inherits the vault index from a `VaultIndexProvider` when present, otherwise
 * loads its own. `components` adds surface-specific presentation overrides; the
 * vault overrides (`a`, `img`, `div`) always win so behaviour stays uniform.
 */
export function VaultMarkdown({
  content,
  sourcePath,
  embeds = false,
  components,
  rehypePlugins,
}: {
  content: string;
  sourcePath: string;
  embeds?: boolean;
  components?: Components;
  rehypePlugins?: ReactMarkdownOptions['rehypePlugins'];
}) {
  const vaultIndex = useInheritedVaultIndex(content);
  const navigateInternalHref = useSmoothRouterPush();

  const merged = useMemo<Components>(() => ({
    ...components,
    ...createVaultComponents({ sourcePath, vaultIndex, navigateInternalHref, embeds }),
  }), [components, sourcePath, vaultIndex, navigateInternalHref, embeds]);

  return (
    <ReactMarkdown remarkPlugins={VAULT_REMARK_PLUGINS} rehypePlugins={rehypePlugins} components={merged}>
      {content}
    </ReactMarkdown>
  );
}

export default VaultMarkdown;
