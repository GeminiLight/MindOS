'use client';

import { useCallback, useEffect, useLayoutEffect, useRef, type MouseEvent as ReactMouseEvent, type MutableRefObject } from 'react';
import { Crepe, CrepeFeature } from '@milkdown/crepe';
import { Milkdown, MilkdownProvider, useEditor } from '@milkdown/react';
import '@milkdown/crepe/theme/common/style.css';
import '@/styles/milkdown-overrides.css';
import { shouldHandleSmoothNavigation, useSmoothRouterPush } from '@/hooks/useSmoothRouterPush';
import { resolveMarkdownInternalHref } from '@/lib/markdown-links';
import { useEditorTheme } from '@/lib/stores/editor-theme-store';
import { twemojiToNative } from '@/lib/twemoji';

interface InnerEditorProps {
  value: string;
  onChange: (markdown: string) => void;
  userInteractedRef: MutableRefObject<boolean>;
  editorReadyForPointerRef: MutableRefObject<boolean>;
}

function InnerEditor({
  value,
  onChange,
  userInteractedRef,
  editorReadyForPointerRef,
}: InnerEditorProps) {
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
        const nextMarkdown = twemojiToNative(markdown);
        if (!userInteractedRef.current) {
          editorReadyForPointerRef.current = true;
          return;
        }
        onChangeRef.current(nextMarkdown);
      });
    });

    return crepe;
  }, []);

  return <Milkdown />;
}

interface WysiwygEditorProps {
  value: string;
  onChange: (markdown: string) => void;
  sourcePath?: string;
}

export default function WysiwygEditor({ value, onChange, sourcePath = '' }: WysiwygEditorProps) {
  const theme = useEditorTheme(s => s.theme);
  const smoothPush = useSmoothRouterPush();
  const userInteractedRef = useRef(false);
  const editorReadyForPointerRef = useRef(false);

  useEffect(() => {
    const handle = window.setTimeout(() => {
      editorReadyForPointerRef.current = true;
    }, 1500);
    return () => window.clearTimeout(handle);
  }, []);

  const markTextEditingIntent = useCallback(() => {
    userInteractedRef.current = true;
    editorReadyForPointerRef.current = true;
  }, []);

  const markPointerEditingIntent = useCallback(() => {
    if (editorReadyForPointerRef.current) {
      userInteractedRef.current = true;
    }
  }, []);

  const handleLinkClick = useCallback((event: ReactMouseEvent<HTMLDivElement>) => {
    if (!shouldHandleSmoothNavigation(event)) return;
    const target = event.target instanceof Element ? event.target : null;
    const anchor = target?.closest('a[href]');
    if (!(anchor instanceof HTMLAnchorElement)) return;
    const href = anchor.getAttribute('href') ?? '';
    const resolvedHref = resolveMarkdownInternalHref(href, sourcePath);
    if (!resolvedHref?.startsWith('/view/')) return;
    event.preventDefault();
    smoothPush(resolvedHref);
  }, [smoothPush, sourcePath]);

  return (
    <div
      className="wysiwyg-wrapper min-h-[50vh] overflow-visible"
      data-editor-theme={theme}
      onBeforeInputCapture={markTextEditingIntent}
      onCompositionStartCapture={markTextEditingIntent}
      onDropCapture={markTextEditingIntent}
      onInputCapture={markTextEditingIntent}
      onKeyDownCapture={markTextEditingIntent}
      onPasteCapture={markTextEditingIntent}
      onPointerDownCapture={markPointerEditingIntent}
      onClickCapture={handleLinkClick}
    >
      <MilkdownProvider>
        <InnerEditor
          value={value}
          onChange={onChange}
          userInteractedRef={userInteractedRef}
          editorReadyForPointerRef={editorReadyForPointerRef}
        />
      </MilkdownProvider>
    </div>
  );
}
