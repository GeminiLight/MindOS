import {
  appendContentChangeToLog,
  getContentChangeSummaryFromLog,
  listContentChangesFromLog,
  markContentChangesSeenInLog,
} from '@geminilight/mindos/server';
import type {
  ContentChangeEvent,
  ContentChangeInput,
  ContentChangeSource,
  ContentChangeSummary,
} from '@geminilight/mindos/knowledge';

/**
 * Content change log facade for the Web app.
 *
 * The store lives in the product package (`@geminilight/mindos/server`,
 * `handlers/change-log-store.ts`) and is backed by `node:sqlite` at
 * `<mindRoot>/.mindos/db/change_log_1.sqlite` (spec-sqlite-derived-stores).
 * Web only forwards calls so the Product Server, the CLI and this app share
 * one writer and one reader; the legacy JSONL implementation that used to
 * live here is imported by the store on first open and renamed `*.migrated`.
 */

export type { ContentChangeEvent, ContentChangeInput, ContentChangeSource, ContentChangeSummary };

interface ListOptions {
  path?: string;
  space?: string;
  limit?: number;
  source?: ContentChangeSource;
  agent?: string;
  op?: string;
  q?: string;
}

/** Appends one change event (single SQLite INSERT) and projects it to the automation queue. */
export function appendContentChange(mindRoot: string, input: ContentChangeInput): ContentChangeEvent {
  return appendContentChangeToLog(mindRoot, input);
}

export function listContentChanges(mindRoot: string, options: ListOptions = {}): ContentChangeEvent[] {
  return listContentChangesFromLog(mindRoot, options);
}

/** Marks all changes seen by updating only the small state table. */
export function markContentChangesSeen(mindRoot: string): void {
  markContentChangesSeenInLog(mindRoot);
}

export function getContentChangeSummary(mindRoot: string): ContentChangeSummary {
  return getContentChangeSummaryFromLog(mindRoot);
}
