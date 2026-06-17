import {
  appendAgentRunEvent,
  completeAgentRun,
  failAgentRun,
  startAgentRun,
} from '@geminilight/mindos/agent/ledger/run-ledger';
import { formatDreamingReport, runDreaming, type DreamingArtifacts, type DreamingRun } from './dreaming';
import {
  DREAMING_ASSISTANT_ID,
  DREAMING_ASSISTANT_NAME,
} from './dreaming-assistant';
import { getMindRoot } from './fs';

export type AssistantRunTrigger = 'manual' | 'schedule' | 'event';

export type AssistantRunRuntimeContextSnapshot = {
  assistantId: string;
  trigger: AssistantRunTrigger;
  runner: 'dreaming';
  permissionMode: 'agent';
  outputPolicy: {
    mode: 'review';
    target: '.mindos/dreaming';
  };
  context: {
    space: string;
  };
  dryRun: boolean;
};

export type AssistantRunSuccess = {
  ok: true;
  assistantId: typeof DREAMING_ASSISTANT_ID;
  trigger: AssistantRunTrigger;
  agentRunId: string;
  runtimeContextSnapshot: AssistantRunRuntimeContextSnapshot;
  run: DreamingRun;
  report: string;
  artifacts?: DreamingArtifacts;
};

type NormalizedAssistantRunInput = {
  assistantId: string;
  trigger: AssistantRunTrigger;
  space?: string;
  dryRun: boolean;
};

export class AssistantRunError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = 'AssistantRunError';
  }
}

const SAFE_ASSISTANT_ID = /^[a-z0-9][a-z0-9-]*$/;
const SUPPORTED_ASSISTANT_IDS = new Set([DREAMING_ASSISTANT_ID]);
const TRIGGERS = new Set<AssistantRunTrigger>(['manual', 'schedule', 'event']);

export function runAssistant(input: unknown): AssistantRunSuccess {
  const request = normalizeAssistantRunInput(input);
  if (!SUPPORTED_ASSISTANT_IDS.has(request.assistantId)) {
    throw new AssistantRunError(
      501,
      'UNSUPPORTED_ASSISTANT',
      `Assistant "${request.assistantId}" does not have a dedicated runner yet.`,
    );
  }

  return runDreamingAssistant(request);
}

function runDreamingAssistant(request: NormalizedAssistantRunInput): AssistantRunSuccess {
  const mindRoot = getMindRoot();
  const runtimeContextSnapshot = buildDreamingRuntimeContext(request);
  const ledgerRun = startAgentRun({
    agentKind: 'mindos-headless',
    runtimeId: `assistant:${DREAMING_ASSISTANT_ID}`,
    displayName: `${DREAMING_ASSISTANT_NAME} Assistant`,
    cwd: mindRoot,
    permissionMode: 'agent',
    inputSummary: summarizeAssistantRunInput(runtimeContextSnapshot),
    metadata: {
      source: 'assistant-run',
      assistantId: DREAMING_ASSISTANT_ID,
      trigger: request.trigger,
      dryRun: request.dryRun,
      space: runtimeContextSnapshot.context.space,
      outputTarget: runtimeContextSnapshot.outputPolicy.target,
    },
  });

  try {
    appendAgentRunEvent(ledgerRun.id, {
      type: 'tool_started',
      category: 'tool',
      toolName: 'dreaming',
      message: `Scanning ${runtimeContextSnapshot.context.space} for knowledge-health signals.`,
      data: {
        kind: 'tool',
        name: 'dreaming',
        status: 'started',
        inputSummary: summarizeAssistantRunInput(runtimeContextSnapshot),
      },
    });

    const run = runDreaming(mindRoot, {
      space: request.space,
      writeArtifacts: !request.dryRun,
    });
    const report = formatDreamingReport(run);
    const outputSummary = summarizeDreamingRun(run, request.dryRun);

    appendAgentRunEvent(ledgerRun.id, {
      type: 'tool_completed',
      category: 'tool',
      toolName: 'dreaming',
      message: outputSummary,
      data: {
        kind: 'tool',
        name: 'dreaming',
        status: 'completed',
        outputSummary,
      },
      metadata: {
        dreamingRunId: run.id,
        proposalCount: run.proposals.length,
        healthScore: run.lint.healthScore,
      },
    });

    completeAgentRun(ledgerRun.id, {
      outputSummary,
      metadata: {
        dreamingRunId: run.id,
        proposalCount: run.proposals.length,
        healthScore: run.lint.healthScore,
        artifacts: run.artifacts ?? null,
      },
    });

    return {
      ok: true,
      assistantId: DREAMING_ASSISTANT_ID,
      trigger: request.trigger,
      agentRunId: ledgerRun.id,
      runtimeContextSnapshot,
      run,
      report,
      ...(run.artifacts ? { artifacts: run.artifacts } : {}),
    };
  } catch (error) {
    failAgentRun(ledgerRun.id, {
      error,
      outputSummary: 'Dreaming Assistant failed before producing a complete run.',
      metadata: {
        assistantId: DREAMING_ASSISTANT_ID,
        trigger: request.trigger,
        dryRun: request.dryRun,
        space: runtimeContextSnapshot.context.space,
      },
    });
    throw error;
  }
}

function buildDreamingRuntimeContext(
  request: NormalizedAssistantRunInput,
): AssistantRunRuntimeContextSnapshot {
  return {
    assistantId: DREAMING_ASSISTANT_ID,
    trigger: request.trigger,
    runner: 'dreaming',
    permissionMode: 'agent',
    outputPolicy: {
      mode: 'review',
      target: '.mindos/dreaming',
    },
    context: {
      space: request.space ?? 'all',
    },
    dryRun: request.dryRun,
  };
}

function normalizeAssistantRunInput(input: unknown): NormalizedAssistantRunInput {
  const record = objectBody(input);
  const assistantId = normalizeAssistantId(record.assistantId);
  if (!assistantId) {
    throw new AssistantRunError(400, 'INVALID_ASSISTANT_ID', 'Invalid assistant id.');
  }

  return {
    assistantId,
    trigger: normalizeTrigger(record.trigger),
    space: normalizeSpace(readContextSpace(record)),
    dryRun: record.dryRun === true,
  };
}

function objectBody(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function normalizeAssistantId(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const normalized = value.trim().toLowerCase();
  return SAFE_ASSISTANT_ID.test(normalized) ? normalized : undefined;
}

function normalizeTrigger(value: unknown): AssistantRunTrigger {
  if (typeof value !== 'string') return 'manual';
  const normalized = value.trim().toLowerCase();
  return TRIGGERS.has(normalized as AssistantRunTrigger)
    ? normalized as AssistantRunTrigger
    : 'manual';
}

function readContextSpace(record: Record<string, unknown>): unknown {
  const context = objectBody(record.context);
  return context.space ?? record.space;
}

function normalizeSpace(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const normalized = value
    .trim()
    .replace(/\\/g, '/')
    .replace(/^\/+|\/+$/g, '')
    .replace(/\/+/g, '/');
  if (!normalized) return undefined;
  const segments = normalized.split('/');
  if (segments.some(segment => segment === '.' || segment === '..' || segment.includes('\0'))) {
    throw new AssistantRunError(400, 'INVALID_SPACE', 'Invalid assistant run space.');
  }
  return normalized;
}

function summarizeAssistantRunInput(context: AssistantRunRuntimeContextSnapshot): string {
  const dryRunLabel = context.dryRun ? 'dry run' : 'write artifacts';
  return `Run Dreaming Assistant (${context.trigger}, ${context.context.space}, ${dryRunLabel})`;
}

function summarizeDreamingRun(run: DreamingRun, dryRun: boolean): string {
  const artifactText = dryRun ? 'no artifacts written' : 'artifacts written';
  return `${run.proposals.length} proposal(s), health ${run.lint.healthScore}/100, scope ${run.scope}; ${artifactText}.`;
}
