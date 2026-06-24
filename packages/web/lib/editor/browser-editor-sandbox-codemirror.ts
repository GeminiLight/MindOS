import { StateField, type EditorState, type Extension, type Range } from '@codemirror/state';
import { Decoration, EditorView, type DecorationSet } from '@codemirror/view';
import {
  validateBrowserEditorSandboxContributions,
  type BrowserEditorSandboxContribution,
  type BrowserEditorSandboxTone,
} from '@/lib/obsidian-compat/browser-editor-sandbox';

export interface BrowserEditorSandboxDecorationSpec {
  id: string;
  pluginId: string;
  type: 'line' | 'range';
  className: string;
  title?: string;
  from: number;
  to?: number;
}

const TONE_CLASS: Record<BrowserEditorSandboxTone, string> = {
  accent: 'accent',
  success: 'success',
  warning: 'warning',
  danger: 'danger',
  muted: 'muted',
};

const browserEditorSandboxTheme = EditorView.baseTheme({
  '.cm-mindos-sandbox-range': {
    borderRadius: '3px',
    padding: '0 1px',
  },
  '.cm-mindos-sandbox-range-accent': {
    backgroundColor: 'color-mix(in srgb, var(--amber) 22%, transparent)',
  },
  '.cm-mindos-sandbox-range-success': {
    backgroundColor: 'color-mix(in srgb, var(--success) 18%, transparent)',
  },
  '.cm-mindos-sandbox-range-warning': {
    backgroundColor: 'color-mix(in srgb, var(--warning) 20%, transparent)',
  },
  '.cm-mindos-sandbox-range-danger': {
    backgroundColor: 'color-mix(in srgb, var(--error) 18%, transparent)',
  },
  '.cm-mindos-sandbox-range-muted': {
    backgroundColor: 'color-mix(in srgb, var(--muted-foreground) 14%, transparent)',
  },
  '.cm-line.cm-mindos-sandbox-line': {
    borderLeft: '2px solid transparent',
  },
  '.cm-line.cm-mindos-sandbox-line-accent': {
    backgroundColor: 'color-mix(in srgb, var(--amber) 12%, transparent)',
    borderLeftColor: 'var(--amber)',
  },
  '.cm-line.cm-mindos-sandbox-line-success': {
    backgroundColor: 'color-mix(in srgb, var(--success) 10%, transparent)',
    borderLeftColor: 'var(--success)',
  },
  '.cm-line.cm-mindos-sandbox-line-warning': {
    backgroundColor: 'color-mix(in srgb, var(--warning) 12%, transparent)',
    borderLeftColor: 'var(--warning)',
  },
  '.cm-line.cm-mindos-sandbox-line-danger': {
    backgroundColor: 'color-mix(in srgb, var(--error) 10%, transparent)',
    borderLeftColor: 'var(--error)',
  },
  '.cm-line.cm-mindos-sandbox-line-muted': {
    backgroundColor: 'color-mix(in srgb, var(--muted-foreground) 8%, transparent)',
    borderLeftColor: 'var(--muted-foreground)',
  },
});

function buildTitle(pluginId: string, label: string | undefined): string | undefined {
  if (!label) return undefined;
  return `${pluginId}: ${label}`;
}

function toneClass(tone: BrowserEditorSandboxTone | undefined): string {
  return TONE_CLASS[tone ?? 'accent'];
}

export function collectBrowserEditorSandboxDecorationSpecs(
  state: EditorState,
  contributions: readonly BrowserEditorSandboxContribution[] | undefined,
): BrowserEditorSandboxDecorationSpec[] {
  const validation = validateBrowserEditorSandboxContributions(contributions, {
    documentLength: state.doc.length,
    lineCount: state.doc.lines,
  });

  const specs: BrowserEditorSandboxDecorationSpec[] = [];

  for (const { contribution } of validation.accepted) {
    const tone = toneClass(contribution.tone);
    const title = buildTitle(contribution.pluginId, contribution.label);

    if (contribution.kind === 'line-highlight') {
      const line = state.doc.line(contribution.line);
      specs.push({
        id: contribution.id,
        pluginId: contribution.pluginId,
        type: 'line',
        className: `cm-mindos-sandbox-line cm-mindos-sandbox-line-${tone}`,
        title,
        from: line.from,
      });
      continue;
    }

    specs.push({
      id: contribution.id,
      pluginId: contribution.pluginId,
      type: 'range',
      className: `cm-mindos-sandbox-range cm-mindos-sandbox-range-${tone}`,
      title,
      from: contribution.from,
      to: contribution.to,
    });
  }

  return specs;
}

function buildBrowserEditorSandboxDecorations(
  state: EditorState,
  contributions: readonly BrowserEditorSandboxContribution[] | undefined,
): DecorationSet {
  const ranges: Range<Decoration>[] = [];
  const specs = collectBrowserEditorSandboxDecorationSpecs(state, contributions)
    .sort((a, b) => a.from - b.from || (a.to ?? a.from) - (b.to ?? b.from));

  for (const spec of specs) {
    const attributes = spec.title ? { title: spec.title } : undefined;
    const decoration = spec.type === 'line'
      ? Decoration.line({ attributes: { ...attributes, class: spec.className } })
      : Decoration.mark({ attributes: { ...attributes, class: spec.className } });
    ranges.push(decoration.range(spec.from, spec.to ?? spec.from));
  }

  return Decoration.set(ranges, true);
}

function createBrowserEditorSandboxStateField(
  contributions: readonly BrowserEditorSandboxContribution[],
): StateField<DecorationSet> {
  const safeContributions = [...contributions];

  return StateField.define<DecorationSet>({
    create(state) {
      return buildBrowserEditorSandboxDecorations(state, safeContributions);
    },
    update(decorations, transaction) {
      if (!transaction.docChanged) return decorations;
      return buildBrowserEditorSandboxDecorations(transaction.state, safeContributions);
    },
    provide: (field) => EditorView.decorations.from(field),
  });
}

export function createBrowserEditorSandboxExtension(
  contributions: readonly BrowserEditorSandboxContribution[] | undefined,
): Extension {
  if (!contributions || contributions.length === 0) return [];
  return [
    browserEditorSandboxTheme,
    createBrowserEditorSandboxStateField(contributions),
  ];
}
