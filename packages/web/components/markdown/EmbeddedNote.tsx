'use client';

/**
 * Fetch and frame a transcluded note (`![[note]]` / `![[note#Heading]]`).
 *
 * This component only resolves the target, reads the file and slices out the
 * requested section. It does **not** render markdown: the caller supplies
 * `renderBody`, which keeps this module free of a dependency on the vault
 * renderer (no import cycle) and lets that renderer decide — explicitly — that
 * embedded content is rendered with embeds turned off. See `VaultNoteEmbed`.
 */

import { useEffect, useState, type ReactNode } from 'react';
import {
  extractMarkdownSection,
  resolveWikiLinkTarget,
  type WikiLinkSubpath,
} from '@geminilight/mindos/foundation/markdown';
import { encodePath } from '@/lib/utils';

export type EmbeddedNoteVaultIndex = {
  files: ReadonlySet<string>;
  basenames: ReadonlyMap<string, string[]>;
} | null;

/** `heading:Some Title` / `block:abc` as stamped by the remark plugin. */
export function parseEmbedSubpath(raw: string | undefined): WikiLinkSubpath | undefined {
  if (!raw) return undefined;
  const separator = raw.indexOf(':');
  if (separator === -1) return undefined;
  const type = raw.slice(0, separator);
  const value = raw.slice(separator + 1);
  if (!value) return undefined;
  return type === 'heading' || type === 'block' ? { type, value } : undefined;
}

type State =
  | { status: 'loading' }
  | { status: 'ready'; content: string }
  | { status: 'missing' }
  | { status: 'error' };

export function EmbeddedNote({
  target,
  subpath,
  vaultIndex,
  renderBody,
}: {
  target: string;
  subpath?: WikiLinkSubpath;
  vaultIndex: EmbeddedNoteVaultIndex;
  /** Render the sliced markdown. `path` is the embedded note's vault path, so
   *  relative links inside it resolve from the right folder. */
  renderBody: (content: string, path: string) => ReactNode;
}) {
  const [state, setState] = useState<State>({ status: 'loading' });
  const resolved = vaultIndex ? resolveWikiLinkTarget(target, vaultIndex.files, vaultIndex.basenames) : null;

  useEffect(() => {
    if (!vaultIndex) return;
    if (!resolved) {
      setState({ status: 'missing' });
      return;
    }
    let cancelled = false;
    setState({ status: 'loading' });
    fetch(`/api/file?path=${encodeURIComponent(resolved)}&op=read_file`)
      .then(async (res) => {
        if (!res.ok) throw new Error(`read failed ${res.status}`);
        const body = await res.json() as { content?: string };
        if (cancelled) return;
        const section = extractMarkdownSection(body.content ?? '', subpath);
        setState(section === null ? { status: 'missing' } : { status: 'ready', content: section });
      })
      .catch(() => { if (!cancelled) setState({ status: 'error' }); });
    return () => { cancelled = true; };
  }, [resolved, subpath?.type, subpath?.value, vaultIndex]);

  const href = resolved ? `/view/${encodePath(resolved)}` : undefined;
  const label = subpath ? `${target} > ${subpath.value}` : target;

  return (
    <div className="markdown-embed" data-wikilink-note-embed={target}>
      <div className="markdown-embed-title">
        {href ? <a href={href}>{label}</a> : <span>{label}</span>}
      </div>
      {state.status === 'loading' && <p className="markdown-embed-state">载入中…</p>}
      {state.status === 'missing' && (
        <p className="markdown-embed-state">未找到{subpath ? '该小节' : '这篇笔记'}：{label}</p>
      )}
      {state.status === 'error' && <p className="markdown-embed-state">无法读取这篇笔记。</p>}
      {state.status === 'ready' && resolved && (
        <div className="markdown-embed-body">{renderBody(state.content, resolved)}</div>
      )}
    </div>
  );
}

export default EmbeddedNote;
