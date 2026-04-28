/**
 * Markdown formatting actions.
 * Applies inline/block formatting to selected text within a TextInput.
 */

export interface Selection {
  start: number;
  end: number;
}

export interface FormatResult {
  content: string;
  selection: Selection;
}

type ActionFn = (content: string, sel: Selection) => FormatResult;

/** Wrap selection with inline markers (bold, italic, code, strikethrough). */
function wrapInline(marker: string): ActionFn {
  return (content, sel) => {
    const before = content.slice(0, sel.start);
    const selected = content.slice(sel.start, sel.end);
    const after = content.slice(sel.end);

    // If already wrapped, unwrap
    if (selected.startsWith(marker) && selected.endsWith(marker) && selected.length >= marker.length * 2) {
      const unwrapped = selected.slice(marker.length, -marker.length);
      return {
        content: before + unwrapped + after,
        selection: { start: sel.start, end: sel.start + unwrapped.length },
      };
    }

    const wrapped = `${marker}${selected || 'text'}${marker}`;
    return {
      content: before + wrapped + after,
      selection: { start: sel.start + marker.length, end: sel.start + wrapped.length - marker.length },
    };
  };
}

/** Prefix current line(s) with a block marker (heading, list, quote). */
function prefixLine(prefix: string): ActionFn {
  return (content, sel) => {
    const lineStart = content.lastIndexOf('\n', sel.start - 1) + 1;
    const lineEnd = content.indexOf('\n', sel.end);
    const actualEnd = lineEnd === -1 ? content.length : lineEnd;
    const line = content.slice(lineStart, actualEnd);

    // Toggle off if already prefixed
    if (line.startsWith(prefix)) {
      const stripped = line.slice(prefix.length);
      const newContent = content.slice(0, lineStart) + stripped + content.slice(actualEnd);
      return {
        content: newContent,
        selection: {
          start: Math.max(lineStart, sel.start - prefix.length),
          end: Math.max(lineStart, sel.end - prefix.length),
        },
      };
    }

    const newContent = content.slice(0, lineStart) + prefix + content.slice(lineStart);
    return {
      content: newContent,
      selection: { start: sel.start + prefix.length, end: sel.end + prefix.length },
    };
  };
}

/** Insert text at cursor. */
function insertAt(text: string): ActionFn {
  return (content, sel) => {
    const before = content.slice(0, sel.start);
    const after = content.slice(sel.end);
    return {
      content: before + text + after,
      selection: { start: sel.start + text.length, end: sel.start + text.length },
    };
  };
}

/** Insert a link around selected text. */
function insertLink(): ActionFn {
  return (content, sel) => {
    const before = content.slice(0, sel.start);
    const selected = content.slice(sel.start, sel.end) || 'link text';
    const after = content.slice(sel.end);
    const wrapped = `[${selected}](url)`;
    return {
      content: before + wrapped + after,
      // Select "url" part
      selection: { start: sel.start + selected.length + 3, end: sel.start + selected.length + 6 },
    };
  };
}

export type ToolbarAction =
  | 'heading'
  | 'bold'
  | 'italic'
  | 'code'
  | 'strikethrough'
  | 'bullet'
  | 'numbered'
  | 'task'
  | 'quote'
  | 'link'
  | 'divider';

interface ActionConfig {
  icon: string;
  label: string;
  apply: ActionFn;
}

export const TOOLBAR_ACTIONS: Record<ToolbarAction, ActionConfig> = {
  heading:       { icon: 'text-outline',             label: 'H',    apply: prefixLine('## ') },
  bold:          { icon: 'text-outline',             label: 'B',    apply: wrapInline('**') },
  italic:        { icon: 'text-outline',             label: 'I',    apply: wrapInline('*') },
  code:          { icon: 'code-slash-outline',       label: '< >',  apply: wrapInline('`') },
  strikethrough: { icon: 'remove-outline',           label: 'S',    apply: wrapInline('~~') },
  bullet:        { icon: 'list-outline',             label: '•',    apply: prefixLine('- ') },
  numbered:      { icon: 'list-outline',             label: '1.',   apply: prefixLine('1. ') },
  task:          { icon: 'checkbox-outline',          label: '☐',    apply: prefixLine('- [ ] ') },
  quote:         { icon: 'chatbox-ellipses-outline',  label: '>',    apply: prefixLine('> ') },
  link:          { icon: 'link-outline',             label: '🔗',   apply: insertLink() },
  divider:       { icon: 'remove-outline',           label: '—',    apply: insertAt('\n---\n') },
};

export const TOOLBAR_ORDER: ToolbarAction[] = [
  'heading', 'bold', 'italic', 'code', 'bullet', 'numbered', 'task', 'quote', 'link', 'divider',
];
