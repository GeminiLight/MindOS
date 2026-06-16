'use client';

import { useLayoutEffect, useRef } from 'react';
import { Crepe, CrepeFeature } from '@milkdown/crepe';
import { Milkdown, MilkdownProvider, useEditor } from '@milkdown/react';
import '@milkdown/crepe/theme/common/style.css';
import '@/styles/milkdown-overrides.css';
import { useEditorTheme } from '@/lib/stores/editor-theme-store';
import { twemojiToNative } from '@/lib/twemoji';

interface InnerEditorProps {
  value: string;
  onChange: (markdown: string) => void;
}

function InnerEditor({ value, onChange }: InnerEditorProps) {
  const onChangeRef = useRef(onChange);
  useLayoutEffect(() => {
    onChangeRef.current = onChange;
  }, [onChange]);

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
      listener.markdownUpdated((_ctx, markdown) => {
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
    <div className="wysiwyg-wrapper min-h-[50vh] overflow-visible" data-editor-theme={theme}>
      <MilkdownProvider>
        <InnerEditor value={value} onChange={onChange} />
      </MilkdownProvider>
    </div>
  );
}
