'use client';

import { useRef } from 'react';
import { Crepe } from '@milkdown/crepe';
import { Milkdown, MilkdownProvider, useEditor } from '@milkdown/react';
import '@milkdown/crepe/theme/common/style.css';
import '@/styles/milkdown-overrides.css';
import { useEditorTheme } from '@/lib/stores/editor-theme-store';
import { twemojiToNative } from '@/lib/twemoji';
import { $prose } from '@milkdown/utils';
import { Plugin, PluginKey } from '@milkdown/kit/prose/state';
import type { Editor } from '@milkdown/kit/core';

const TWEMOJI_SRC_RE = /^https?:\/\/cdn\.jsdelivr\.net\/gh\/twitter\/twemoji@[^/]+\/assets\/svg\/([a-f0-9-]+)\.svg$/;

function codepointsToEmoji(codepoints: string): string | null {
  try {
    return String.fromCodePoint(
      ...codepoints.split('-').map((cp: string) => parseInt(cp, 16)),
    );
  } catch {
    return null;
  }
}

/**
 * ProseMirror plugin that intercepts twemoji image nodes at the document
 * model level and replaces them with native Unicode text.
 *
 * This works at the right layer — not DOM (which fights the extension in
 * an infinite loop), but ProseMirror's internal document model. When the
 * extension injects <img src="twemoji">, ProseMirror parses it as an image
 * node via parseDOM. This plugin catches it in appendTransaction and
 * replaces it with a text node containing the real emoji character.
 */
const twemojiFilterPlugin = $prose(() => {
  return new Plugin({
    key: new PluginKey('twemoji-filter'),
    appendTransaction: (_transactions, _oldState, newState) => {
      let tr = newState.tr;
      let changed = false;

      newState.doc.descendants((node, pos) => {
        if (node.type.name === 'image') {
          const src = node.attrs.src as string;
          const match = src.match(TWEMOJI_SRC_RE);
          if (match) {
            const emoji = codepointsToEmoji(match[1]);
            if (emoji) {
              tr = tr.replaceWith(pos, pos + node.nodeSize, newState.schema.text(emoji));
              changed = true;
            }
          }
        }
      });

      return changed ? tr : null;
    },
  });
});

/** Crepe feature: register the twemoji filter as a milkdown plugin */
function twemojiFilterFeature(editor: Editor) {
  editor.use(twemojiFilterPlugin);
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

    // Register twemoji filter plugin to intercept image nodes at model level
    crepe.addFeature(twemojiFilterFeature);

    crepe.on((listener) => {
      listener.markdownUpdated((_ctx, markdown, _prevMarkdown) => {
        // Safety net: clean any twemoji URLs that slip through
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
