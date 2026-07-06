import type {
  ExternalRuntimeSessionListOptions,
  ExternalRuntimeSessionRecord,
  RuntimeSessionTranscriptAdapter,
} from '../types.js';

async function emptySessions(
  _options: ExternalRuntimeSessionListOptions,
): Promise<ExternalRuntimeSessionRecord[]> {
  return [];
}

export const CURSOR_SESSION_TRANSCRIPT_ADAPTER: RuntimeSessionTranscriptAdapter = {
  id: 'cursor',
  aliases: ['cursor', 'cursor-agent'],
  transcriptSource: 'cursor',
  status: 'unverified',
  durable: false,
  summary: 'Cursor is recognized as an agent runtime, but MindOS does not yet have a verified durable native transcript reader for Cursor sessions.',
  listSessions: emptySessions,
};

export const HERMES_SESSION_TRANSCRIPT_ADAPTER: RuntimeSessionTranscriptAdapter = {
  id: 'hermes',
  aliases: ['hermes', 'hermes-code'],
  transcriptSource: 'hermes',
  status: 'unverified',
  durable: false,
  summary: 'Hermes is recognized as an agent runtime, but MindOS does not yet have a verified durable native transcript reader for Hermes sessions.',
  listSessions: emptySessions,
};
