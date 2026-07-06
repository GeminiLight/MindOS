import {
  handleCodexThreadGet,
  type CodexThreadManagerServices,
} from '@geminilight/mindos/server';
import {
  normalizeRuntimeSessionEntry,
  runtimeSessionEntryTurnsToMessages,
  type RuntimeSessionEntry,
} from '@/lib/runtime-session-entry';
import type { AgentRuntimeIdentity, Message } from '@/lib/types';
import {
  listExternalRuntimeSessions,
  type ExternalRuntimeSessionRecord,
} from '@/lib/server/runtime-session-importers';

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
  | 'openclaw';

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
      cli: 'kimi' | 'gemini' | 'opencode' | 'claude' | 'qwen-code' | 'codebuddy' | 'openclaw';
      runtime: AgentRuntimeIdentity;
    }

const CODEX_RUNTIME: AgentRuntimeIdentity = { id: 'codex', name: 'Codex', kind: 'codex' };
const KIMI_RUNTIME: AgentRuntimeIdentity = { id: 'kimi', name: 'Kimi', kind: 'acp' };
const GEMINI_RUNTIME: AgentRuntimeIdentity = { id: 'gemini', name: 'Gemini', kind: 'acp' };
const OPENCODE_RUNTIME: AgentRuntimeIdentity = { id: 'opencode', name: 'OpenCode', kind: 'acp' };
const CLAUDE_RUNTIME: AgentRuntimeIdentity = { id: 'claude', name: 'Claude Code', kind: 'claude' };
const QWEN_RUNTIME: AgentRuntimeIdentity = { id: 'qwen-code', name: 'Qwen Code', kind: 'acp' };
const CODEBUDDY_RUNTIME: AgentRuntimeIdentity = { id: 'codebuddy', name: 'CodeBuddy', kind: 'acp' };
const OPENCLAW_RUNTIME: AgentRuntimeIdentity = { id: 'openclaw', name: 'OpenClaw', kind: 'acp' };

function normalizeCli(value: string): string {
  return value.trim().toLowerCase().replace(/[_\s]+/g, '-');
}

export function resolveRuntimeSessionMessageTarget(
  cli: RuntimeSessionMessageCli | string,
): RuntimeSessionMessageTarget | null {
  switch (normalizeCli(cli)) {
    case 'codex':
    case 'codex-cli':
    case 'codex-app-server':
      return { kind: 'codex', cli: 'codex', runtime: CODEX_RUNTIME };
    case 'kimi':
    case 'kimi-cli':
    case 'kimi-code':
      return { kind: 'native', cli: 'kimi', runtime: KIMI_RUNTIME };
    case 'gemini':
    case 'gemini-cli':
      return { kind: 'native', cli: 'gemini', runtime: GEMINI_RUNTIME };
    case 'opencode':
    case 'open-code':
    case 'opencode-cli':
      return { kind: 'native', cli: 'opencode', runtime: OPENCODE_RUNTIME };
    case 'claude':
    case 'claude-code':
      return { kind: 'native', cli: 'claude', runtime: CLAUDE_RUNTIME };
    case 'qwen':
    case 'qwen-code':
    case 'qwen-cli':
      return { kind: 'native', cli: 'qwen-code', runtime: QWEN_RUNTIME };
    case 'codebuddy':
    case 'codebuddy-code':
      return { kind: 'native', cli: 'codebuddy', runtime: CODEBUDDY_RUNTIME };
    case 'openclaw':
      return { kind: 'native', cli: 'openclaw', runtime: OPENCLAW_RUNTIME };
    default:
      return null;
  }
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
  const sessions = await listExternalRuntimeSessions({
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
