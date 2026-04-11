'use client';

import { useRef } from 'react';
import { Crepe } from '@milkdown/crepe';
import { Milkdown, MilkdownProvider, useEditor } from '@milkdown/react';
import '@milkdown/crepe/theme/common/style.css';
import { useEditorTheme } from '@/lib/stores/editor-theme-store';

/**
 * Convert twemoji image markdown back to native Unicode emoji.
 * Some OS emoji pickers insert `<img src="twemoji-cdn-url">` instead of
 * the actual Unicode character; ProseMirror serializes these as
 * `![](https://cdn.jsdelivr.net/gh/twitter/twemoji@.../CODEPOINTS.svg "")`
 */
const TWEMOJI_RE = /!\[\]\(https?:\/\/cdn\.jsdelivr\.net\/gh\/twitter\/twemoji@[^/]+\/assets\/svg\/([a-f0-9-]+)\.svg\s*(?:"[^"]*")?\)/g;

function twemojiToNative(markdown: string): string {
  return markdown.replace(TWEMOJI_RE, (_match, codepoints: string) => {
    try {
      return String.fromCodePoint(
        ...codepoints.split('-').map((cp: string) => parseInt(cp, 16)),
      );
    } catch {
      return _match; // keep as-is if conversion fails
    }
  });
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

  return (
    <div className="wysiwyg-wrapper h-full overflow-y-auto" data-editor-theme={theme}>
      <MilkdownProvider>
        <InnerEditor value={value} onChange={onChange} />
      </MilkdownProvider>
    </div>
  );
}
