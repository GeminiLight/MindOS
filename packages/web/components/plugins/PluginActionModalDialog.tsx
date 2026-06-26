'use client';

import { useEffect, useState } from 'react';
import { Check, ListChecks, Loader2, Terminal } from 'lucide-react';
import type { PluginModalSnapshot, PluginModalSuggestionChoice } from '@/lib/plugins/client';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';

interface PluginActionModalDialogProps {
  modal: PluginModalSnapshot | null;
  onClose: () => void;
  onChooseSuggestion?: (modal: PluginModalSnapshot, suggestion: PluginModalSuggestionChoice) => void;
  onSubmitText?: (modal: PluginModalSnapshot, text: string) => void;
  choosingSuggestionIndex?: number | null;
  submittingText?: boolean;
  choiceError?: string | null;
}

export default function PluginActionModalDialog({
  modal,
  onClose,
  onChooseSuggestion,
  onSubmitText,
  choosingSuggestionIndex = null,
  submittingText = false,
  choiceError = null,
}: PluginActionModalDialogProps) {
  const [textValue, setTextValue] = useState('');

  useEffect(() => {
    setTextValue(modal?.textInput?.value ?? '');
  }, [modal?.id, modal?.textInput?.value]);

  if (!modal) return null;

  const hasSuggestions = modal.kind === 'suggest' && (modal.suggestions?.length ?? 0) > 0;
  const hasTextInput = modal.kind === 'modal' && Boolean(modal.textInput);
  const canChooseSuggestions = Boolean(onChooseSuggestion && modal.interactionId);
  const canSubmitText = Boolean(onSubmitText && modal.interactionId && hasTextInput);
  const title = modal.title || (modal.kind === 'suggest' ? 'Suggestion modal' : 'Plugin modal');

  return (
    <Dialog open={Boolean(modal)} onOpenChange={(nextOpen) => { if (!nextOpen) onClose(); }}>
      <DialogContent showCloseButton={false} className="overflow-hidden p-0 sm:max-w-lg">
        <DialogHeader className="flex-row items-center gap-3 border-b border-border/70 bg-card/75 px-5 py-4">
          <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-[var(--amber-subtle)] text-[var(--amber)]">
            {modal.kind === 'suggest' ? <ListChecks size={14} /> : <Terminal size={14} />}
          </span>
          <div className="min-w-0">
            <DialogTitle id="plugin-action-modal-title" className="truncate text-sm font-semibold">
              {title}
            </DialogTitle>
            <DialogDescription className="sr-only">
              Plugin modal snapshot from the Obsidian compatibility host.
            </DialogDescription>
          </div>
        </DialogHeader>

        <div className="max-h-[60vh] space-y-3 overflow-y-auto px-5 py-4">
          <div className="rounded-lg border border-border/70 bg-background/70 px-3 py-2 text-xs text-muted-foreground">
            {canChooseSuggestions && modal.kind === 'suggest'
              ? 'Choose a suggestion to continue in the MindOS compatibility host.'
              : canSubmitText
                ? 'Submit text to continue in the MindOS compatibility host.'
                : 'Safe plugin modal snapshot.'}
          </div>

          {modal.placeholder && (
            <div className="rounded-lg border border-border/70 bg-card/70 px-3 py-2">
              <div className="text-2xs uppercase tracking-wider text-muted-foreground/70">Prompt</div>
              <div className="mt-1 text-sm text-foreground">{modal.placeholder}</div>
            </div>
          )}

          {modal.text && (
            <div className="rounded-lg border border-border/70 bg-card/70 px-3 py-2">
              <div className="text-2xs uppercase tracking-wider text-muted-foreground/70">Content</div>
              <pre className="mt-1 whitespace-pre-wrap break-words font-sans text-sm leading-5 text-foreground">{modal.text}</pre>
            </div>
          )}

          {hasTextInput && (
            <div className="space-y-1.5">
              <div className="text-2xs font-medium uppercase tracking-wider text-muted-foreground">Input</div>
              <input
                value={textValue}
                placeholder={modal.textInput?.placeholder ?? modal.placeholder}
                onChange={(event) => setTextValue(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter' && canSubmitText && !submittingText) {
                    onSubmitText?.(modal, textValue);
                  }
                }}
                disabled={!canSubmitText || submittingText}
                className="h-9 w-full rounded-md border border-border/70 bg-background px-3 text-sm text-foreground outline-none transition-colors placeholder:text-muted-foreground/60 focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-60"
              />
            </div>
          )}

          {hasSuggestions && (
            <div className="space-y-1.5">
              <div className="text-2xs font-medium uppercase tracking-wider text-muted-foreground">Suggestions</div>
              <div className="space-y-1.5">
                {modal.suggestions!.map((suggestion) => (
                  <button
                    key={`${modal.id}:${suggestion.index}`}
                    type="button"
                    disabled={!canChooseSuggestions || choosingSuggestionIndex !== null}
                    onClick={() => onChooseSuggestion?.(modal, suggestion)}
                    className="flex min-h-9 w-full items-center justify-between gap-2 rounded-lg border border-border/60 bg-card/70 px-3 py-2 text-left text-sm text-foreground transition-colors hover:bg-muted/45 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-60"
                  >
                    <span className="min-w-0 truncate">{suggestion.label}</span>
                    {choosingSuggestionIndex === suggestion.index && <Loader2 size={13} className="shrink-0 animate-spin text-muted-foreground" />}
                  </button>
                ))}
              </div>
            </div>
          )}

          {(modal.suggestionError || choiceError) && (
            <div className="rounded-lg border border-[var(--error)]/25 bg-[var(--error)]/10 px-3 py-2 text-xs text-[var(--error)]">
              {choiceError ?? modal.suggestionError}
            </div>
          )}
        </div>

        <DialogFooter className="mx-0 mb-0 flex-row rounded-none border-t border-border/70 bg-card/95 px-5 py-3">
          {hasTextInput && (
            <button
              type="button"
              onClick={() => onSubmitText?.(modal, textValue)}
              disabled={!canSubmitText || submittingText}
              className="inline-flex h-8 items-center justify-center gap-1.5 rounded-md bg-[var(--amber)] px-3 text-xs font-medium text-[var(--amber-foreground)] transition-opacity hover:opacity-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-60"
            >
              {submittingText ? <Loader2 size={13} className="animate-spin" /> : <Check size={13} />}
              Submit
            </button>
          )}
          <button
            type="button"
            onClick={onClose}
            className="inline-flex h-8 items-center justify-center rounded-md bg-[var(--amber)] px-3 text-xs font-medium text-[var(--amber-foreground)] transition-opacity hover:opacity-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            Close
          </button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
