'use client';

import { useRef, useEffect } from 'react';
import { Crepe, CrepeFeature } from '@milkdown/crepe';
import { Milkdown, MilkdownProvider, useEditor } from '@milkdown/react';
import '@milkdown/crepe/theme/common/style.css';
import '@/styles/milkdown-overrides.css';
import { useEditorTheme } from '@/lib/stores/editor-theme-store';
import { twemojiToNative } from '@/lib/twemoji';
import GithubSlugger from 'github-slugger';

/** Add slug-based id attributes to heading elements so TOC can link to them */
function syncHeadingIds(container: HTMLElement) {
  const slugger = new GithubSlugger();
  const headings = container.querySelectorAll<HTMLElement>('h1, h2, h3, h4, h5, h6');
  for (const h of headings) {
    const text = h.textContent?.trim();
    if (text) {
      const id = slugger.slug(text);
      if (h.id !== id) h.id = id; // only write if changed to avoid triggering observers
    }
  }
}

interface InnerEditorProps {
  value: string;
  onChange: (markdown: string) => void;
}

function InnerEditor({ value, onChange }: InnerEditorProps) {
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;

  useEditor((root) => {
    const crepe = new Crepe({
      root,
      defaultValue: value,
      featureConfigs: {
        [CrepeFeature.CodeMirror]: {
          onCopy: (code: string) => {
            navigator.clipboard.writeText(code).catch(() => {});
          },
        },
      },
    });

    crepe.on((listener) => {
      listener.markdownUpdated((_ctx, markdown, _prevMarkdown) => {
        onChangeRef.current(twemojiToNative(markdown));
      });
    });

    return crepe;
  }, []);

  return <Milkdown />;
}

interface WysiwygEditorProps {
  value: string;
  onChange: (markdown: string) => void;
}

export default function WysiwygEditor({ value, onChange }: WysiwygEditorProps) {
  const theme = useEditorTheme(s => s.theme);
  const wrapperRef = useRef<HTMLDivElement>(null);

  // Keep heading ids in sync so TOC can scroll to them
  // Use debounced interval instead of MutationObserver to avoid infinite loops
  useEffect(() => {
    const el = wrapperRef.current;
    if (!el) return;
    syncHeadingIds(el);
    const interval = setInterval(() => syncHeadingIds(el), 1000);
    return () => clearInterval(interval);
  }, []);

  return (
    <div ref={wrapperRef} className="wysiwyg-wrapper h-full overflow-y-auto" data-editor-theme={theme}>
      <MilkdownProvider>
        <InnerEditor value={value} onChange={onChange} />
      </MilkdownProvider>
    </div>
  );
}
