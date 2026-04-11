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
      h.id = slugger.slug(text);
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
  useEffect(() => {
    const el = wrapperRef.current;
    if (!el) return;
    // Initial pass
    syncHeadingIds(el);
    // Watch for DOM changes (typing, adding headings)
    const observer = new MutationObserver(() => syncHeadingIds(el));
    observer.observe(el, { childList: true, subtree: true, characterData: true });
    return () => observer.disconnect();
  }, []);

  return (
    <div ref={wrapperRef} className="wysiwyg-wrapper h-full overflow-y-auto" data-editor-theme={theme}>
      <MilkdownProvider>
        <InnerEditor value={value} onChange={onChange} />
      </MilkdownProvider>
    </div>
  );
}
