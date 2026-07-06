import {
  handleCodexThreadGet,
  type CodexThreadManagerServices,
} from '@geminilight/mindos/server';
import {
  listRuntimeSessionTranscripts,
  normalizeRuntimeSessionTranscriptId,
  resolveRuntimeSessionTranscriptTarget,
  type ExternalRuntimeSessionRecord,
  type RuntimeSessionTranscriptTarget,
} from '@geminilight/mindos/agent/runtime/adapters';
import {
  normalizeRuntimeSessionEntry,
  runtimeSessionEntryTurnsToMessages,
  type RuntimeSessionEntry,
} from '@/lib/runtime-session-entry';
import type { AgentRuntimeIdentity, Message } from '@/lib/types';

export type RuntimeSessionMessageCli =
  | 'codex'
  | 'codex-cli'
  | 'codex-app-server'
  | 'kimi'
  | 'kimi-cli'
  | 'kimi-code'
  | 'gemini'
  | 'gemini-cli'
  | 'opencode'
  | 'open-code'
  | 'opencode-cli'
  | 'claude'
  | 'claude-code'
  | 'qwen'
  | 'qwen-code'
  | 'qwen-cli'
  | 'codebuddy'
  | 'codebuddy-code'
  | 'openclaw'
  | 'cursor'
  | 'cursor-agent'
  | 'hermes'
  | 'hermes-code';

export type RuntimeSessionMessageLoadStatus =
  | 'loaded'
  | 'missing'
  | 'unsupported'
  | 'error';

export type RuntimeSessionMessageSourceConfidence =
  | 'full'
  | 'metadata-only'
  | 'missing';

export type RuntimeSessionMessageSource =
  | {
      kind: 'codex-thread';
      durable: true;
      confidence: RuntimeSessionMessageSourceConfidence;
    }
  | {
      kind: 'native-transcript';
      transcriptSource: ExternalRuntimeSessionRecord['transcriptSource'];
      durable: true;
      confidence: RuntimeSessionMessageSourceConfidence;
    }
  | {
      kind: 'unsupported';
      durable: false;
      confidence: 'missing';
      reason: string;
    }
  | {
      kind: 'missing';
      durable: false;
      confidence: 'missing';
      reason: string;
    };

export type LoadRuntimeSessionMessagesInput = {
  cli: RuntimeSessionMessageCli | string;
  sessionId: string;
  cwd?: string;
  homeDir?: string;
  codexServices?: CodexThreadManagerServices;
};

export type LoadRuntimeSessionMessagesResult = {
  cli: string;
  sessionId: string;
  runtime?: AgentRuntimeIdentity;
  status: RuntimeSessionMessageLoadStatus;
  entry?: RuntimeSessionEntry;
  messages: Message[];
  source: RuntimeSessionMessageSource;
  error?: string;
};

type RuntimeSessionMessageTarget =
  | {
      kind: 'codex';
      cli: 'codex';
      runtime: AgentRuntimeIdentity;
    }
  | {
      kind: 'native';
      cli: string;
      runtime: AgentRuntimeIdentity;
      transcriptTarget: RuntimeSessionTranscriptTarget;
    };

const CODEX_RUNTIME: AgentRuntimeIdentity = { id: 'codex', name: 'Codex', kind: 'codex' };

function normalizeCli(value: string): string {
  return normalizeRuntimeSessionTranscriptId(value);
}

export function resolveRuntimeSessionMessageTarget(
  cli: RuntimeSessionMessageCli | string,
): RuntimeSessionMessageTarget | null {
  switch (normalizeCli(cli)) {
    case 'codex':
    case 'codex-cli':
    case 'codex-app-server':
      return { kind: 'codex', cli: 'codex', runtime: CODEX_RUNTIME };
    default:
      break;
  }
  const transcriptTarget = resolveRuntimeSessionTranscriptTarget(cli);
  if (!transcriptTarget) return null;
  return {
    kind: 'native',
    cli: transcriptTarget.cli,
    runtime: transcriptTarget.runtime,
    transcriptTarget,
  };
}

function sourceConfidence(
  entry: RuntimeSessionEntry | undefined,
  messages: Message[],
): RuntimeSessionMessageSourceConfidence {
  if (!entry) return 'missing';
  return messages.length > 0 ? 'full' : 'metadata-only';
}

function emptyResult(input: {
  cli: string;
  sessionId: string;
  runtime?: AgentRuntimeIdentity;
  status: RuntimeSessionMessageLoadStatus;
  source: RuntimeSessionMessageSource;
  error?: string;
}): LoadRuntimeSessionMessagesResult {
  return {
    cli: input.cli,
    sessionId: input.sessionId,
    ...(input.runtime ? { runtime: input.runtime } : {}),
    status: input.status,
    messages: [],
    source: input.source,
    ...(input.error ? { error: input.error } : {}),
  };
}

async function loadCodexSessionMessages(
  target: Extract<RuntimeSessionMessageTarget, { kind: 'codex' }>,
  sessionId: string,
  services?: CodexThreadManagerServices,
): Promise<LoadRuntimeSessionMessagesResult> {
  const response = await handleCodexThreadGet(
    sessionId,
    new URLSearchParams({ includeTurns: '1' }),
    services,
  );
  if (response.status !== 200) {
    const body = response.body as { error?: string; message?: string };
    const error = body.error || body.message || `Failed to load Codex thread ${sessionId}.`;
    return emptyResult({
      cli: target.cli,
      sessionId,
      runtime: target.runtime,
      status: 'error',
      source: {
        kind: 'codex-thread',
        durable: true,
        confidence: 'missing',
      },
      error,
    });
  }

  const body = response.body as { thread?: unknown };
  const entry = normalizeRuntimeSessionEntry(body.thread, target.runtime);
  if (!entry) {
    return emptyResult({
      cli: target.cli,
      sessionId,
      runtime: target.runtime,
      status: 'missing',
      source: {
        kind: 'missing',
        durable: false,
        confidence: 'missing',
        reason: 'Codex did not return a readable thread for this id.',
      },
    });
  }

  const messages = runtimeSessionEntryTurnsToMessages(entry, target.runtime);
  return {
    cli: target.cli,
    sessionId,
    runtime: target.runtime,
    status: 'loaded',
    entry,
    messages,
    source: {
      kind: 'codex-thread',
      durable: true,
      confidence: sourceConfidence(entry, messages),
    },
  };
}

async function loadNativeSessionMessages(
  target: Extract<RuntimeSessionMessageTarget, { kind: 'native' }>,
  input: Pick<LoadRuntimeSessionMessagesInput, 'cwd' | 'homeDir'> & { sessionId: string },
): Promise<LoadRuntimeSessionMessagesResult> {
  if (target.transcriptTarget.adapter.status !== 'supported') {
    return emptyResult({
      cli: target.cli,
      sessionId: input.sessionId,
      runtime: target.runtime,
      status: 'unsupported',
      source: {
        kind: 'unsupported',
        durable: false,
        confidence: 'missing',
        reason: target.transcriptTarget.adapter.summary,
      },
    });
  }

  const sessions = await listRuntimeSessionTranscripts({
    runtimeId: target.runtime.id,
    sessionId: input.sessionId,
    cwd: input.cwd,
    homeDir: input.homeDir,
    limit: 1,
  });
  const nativeSession = sessions.find((session) => session.id === input.sessionId);
  if (!nativeSession) {
    return emptyResult({
      cli: target.cli,
      sessionId: input.sessionId,
      runtime: target.runtime,
      status: 'missing',
      source: {
        kind: 'missing',
        durable: false,
        confidence: 'missing',
        reason: 'No matching native transcript was found for this CLI session id.',
      },
    });
  }

  const entry = normalizeRuntimeSessionEntry(nativeSession, target.runtime);
  if (!entry) {
    return emptyResult({
      cli: target.cli,
      sessionId: input.sessionId,
      runtime: target.runtime,
      status: 'missing',
      source: {
        kind: 'missing',
        durable: false,
        confidence: 'missing',
        reason: 'The native transcript record could not be normalized.',
      },
    });
  }

  const messages = runtimeSessionEntryTurnsToMessages(entry, target.runtime);
  return {
    cli: target.cli,
    sessionId: input.sessionId,
    runtime: target.runtime,
    status: 'loaded',
    entry,
    messages,
    source: {
      kind: 'native-transcript',
      transcriptSource: nativeSession.transcriptSource,
      durable: true,
      confidence: sourceConfidence(entry, messages),
    },
  };
}

export async function loadRuntimeSessionMessages(
  input: LoadRuntimeSessionMessagesInput,
): Promise<LoadRuntimeSessionMessagesResult> {
  const rawCli = input.cli.trim();
  const sessionId = input.sessionId.trim();
  if (!rawCli) {
    return emptyResult({
      cli: '',
      sessionId,
      status: 'error',
      source: {
        kind: 'missing',
        durable: false,
        confidence: 'missing',
        reason: 'Missing CLI name.',
      },
      error: 'Missing CLI name.',
    });
  }
  if (!sessionId) {
    return emptyResult({
      cli: normalizeCli(rawCli),
      sessionId: '',
      status: 'error',
      source: {
        kind: 'missing',
        durable: false,
        confidence: 'missing',
        reason: 'Missing session id.',
      },
      error: 'Missing session id.',
    });
  }

  const target = resolveRuntimeSessionMessageTarget(rawCli);
  if (!target) {
    return emptyResult({
      cli: normalizeCli(rawCli),
      sessionId,
      status: 'unsupported',
      source: {
        kind: 'unsupported',
        durable: false,
        confidence: 'missing',
        reason: `Unsupported CLI: ${rawCli}.`,
      },
    });
  }

  if (target.kind === 'codex') {
    return loadCodexSessionMessages(target, sessionId, input.codexServices);
  }

  return loadNativeSessionMessages(target, {
    sessionId,
    cwd: input.cwd,
    homeDir: input.homeDir,
  });
}
