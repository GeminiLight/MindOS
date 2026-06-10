'use client';

import { useCallback, useEffect, useMemo, useRef } from 'react';
import type { LocalAttachment } from '@/lib/types';
import type { useAiOrganize } from '@/hooks/useAiOrganize';
import { checkAiAvailable } from '@/lib/space-ai-init';
import { isAiReadableCaptureName } from '@/lib/capture-formats';
import { buildInboxOrganizerRunPrompt, loadInboxOrganizerPrompt } from '@/lib/inbox-assistant';
import { toast } from '@/lib/toast';
import { archiveInboxFiles } from '@/lib/inbox-client';

export interface InboxOrganizeFile {
  name: string;
  path: string;
}

export interface InboxOrganizeOptions {
  providerOverride?: string | null;
  modelOverride?: string | null;
}

export interface InboxOrganizeLabels {
  organizeNoAi: string;
  organizeFailed: string;
  organizeBusy?: string;
  organizeReadFailed?: (failed: number, skipped: number) => string;
  organizeNoReadableFiles?: (skipped: number) => string;
}

export interface InboxOrganizeController {
  isOrganizing: boolean;
  requestInboxOrganize: (
    files: InboxOrganizeFile[],
    options?: InboxOrganizeOptions,
  ) => Promise<{ started: boolean; reason?: string }>;
  requestConversationOrganize: (detail: { content: string; name: string }) => void;
}

function buildReadFailureMessage(labels: InboxOrganizeLabels, failed: number, skipped: number): string {
  if (failed === 0 && skipped > 0) {
    return labels.organizeNoReadableFiles?.(skipped)
      ?? `${labels.organizeFailed} ${skipped} unsupported file${skipped === 1 ? '' : 's'} skipped.`;
  }
  if (failed > 0 || skipped > 0) {
    return labels.organizeReadFailed?.(failed, skipped)
      ?? `${labels.organizeFailed} ${failed} unreadable, ${skipped} unsupported.`;
  }
  return labels.organizeFailed;
}

async function readInboxFile(file: InboxOrganizeFile): Promise<LocalAttachment> {
  const res = await fetch(`/api/file?path=${encodeURIComponent(file.path)}`);
  if (!res.ok) {
    throw new Error(`Could not read ${file.name} (${res.status})`);
  }
  const data = await res.json() as { content?: string };
  return { name: file.name, content: data.content ?? '' };
}

export function useInboxOrganizeController({
  aiOrganize,
  labels,
}: {
  aiOrganize: ReturnType<typeof useAiOrganize>;
  labels: InboxOrganizeLabels;
}): InboxOrganizeController {
  const organizedReadableFileNamesRef = useRef<string[]>([]);

  const requestInboxOrganize = useCallback<InboxOrganizeController['requestInboxOrganize']>(async (files, options = {}) => {
    if (files.length === 0) return { started: false, reason: 'empty' };
    if (aiOrganize.phase === 'organizing') {
      if (labels.organizeBusy) toast.error(labels.organizeBusy, 3000);
      return { started: false, reason: 'busy' };
    }

    organizedReadableFileNamesRef.current = [];

    const aiReady = await checkAiAvailable(options.providerOverride);
    if (!aiReady) {
      organizedReadableFileNamesRef.current = [];
      toast.error(labels.organizeNoAi, 5000);
      window.dispatchEvent(new Event('mindos:organize-done'));
      return { started: false, reason: 'ai-unavailable' };
    }

    const assistantPrompt = await loadInboxOrganizerPrompt();
    const prompt = buildInboxOrganizerRunPrompt(files.map(f => f.path || f.name), assistantPrompt);
    const attachments: LocalAttachment[] = [];
    let failed = 0;
    let skipped = 0;
    for (const file of files) {
      if (!isAiReadableCaptureName(file.name)) {
        skipped++;
        continue;
      }
      try {
        attachments.push(await readInboxFile(file));
      } catch {
        failed++;
      }
    }

    if (attachments.length === 0) {
      organizedReadableFileNamesRef.current = [];
      toast.error(buildReadFailureMessage(labels, failed, skipped), 5000);
      window.dispatchEvent(new Event('mindos:organize-done'));
      return { started: false, reason: 'no-readable-files' };
    }

    if (failed > 0 || skipped > 0) {
      toast.error(buildReadFailureMessage(labels, failed, skipped), 5000);
    }

    organizedReadableFileNamesRef.current = attachments.map(attachment => attachment.name);
    aiOrganize.start(attachments, prompt, 'inbox-organize', options);
    return { started: true };
  }, [aiOrganize, labels]);

  const requestConversationOrganize = useCallback((detail: { content: string; name: string }) => {
    if (!detail.content || aiOrganize.phase === 'organizing') return;
    const attachment = { name: detail.name, content: detail.content };
    const prompt = 'Organize this conversation into well-structured notes in my knowledge base. Extract key insights, decisions, action items, and important details. Create appropriate files with clear titles. Write in the same language as the content.';
    aiOrganize.start([attachment], prompt, 'conversation');
  }, [aiOrganize]);

  useEffect(() => {
    if (aiOrganize.phase === 'done') {
      const hasSuccessfulChanges = aiOrganize.changes.some(c => c.ok);
      const hasFailedChanges = aiOrganize.changes.some(c => !c.ok);
      const names = organizedReadableFileNamesRef.current;
      if (hasSuccessfulChanges && !hasFailedChanges && names.length > 0) {
        archiveInboxFiles(names, labels.organizeFailed)
          .then(() => {
            window.dispatchEvent(new Event('mindos:inbox-updated'));
          })
          .catch(() => { /* best-effort cleanup */ });
      }
      organizedReadableFileNamesRef.current = [];
      window.dispatchEvent(new Event('mindos:organize-done'));
    } else if (aiOrganize.phase === 'error') {
      organizedReadableFileNamesRef.current = [];
      window.dispatchEvent(new Event('mindos:organize-done'));
    }
  }, [aiOrganize.phase, aiOrganize.changes, labels.organizeFailed]);

  return useMemo(() => ({
    isOrganizing: aiOrganize.phase === 'organizing',
    requestInboxOrganize,
    requestConversationOrganize,
  }), [aiOrganize.phase, requestConversationOrganize, requestInboxOrganize]);
}
