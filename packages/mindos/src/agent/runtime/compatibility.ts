import type {
  AgentRuntimeCapabilities,
  AgentRuntimeCompatibilityAssessment,
  AgentRuntimeCompatibilityOwner,
  AgentRuntimeCompatibilityProfile,
  AgentRuntimeCompatibilityRequirement,
  AgentRuntimeHarnessCapabilities,
  AgentRuntimeLifecycle,
  AgentRuntimeStatus,
  NativeRuntimeId,
} from './registry.js';

type RuntimeCompatibilityInput = {
  capabilities: AgentRuntimeCapabilities;
  harnessCapabilities: AgentRuntimeHarnessCapabilities;
  lifecycle: AgentRuntimeLifecycle;
  status: AgentRuntimeStatus;
};

function requirement(
  id: string,
  status: AgentRuntimeCompatibilityRequirement['status'],
  owner: AgentRuntimeCompatibilityOwner,
  summary: string,
): AgentRuntimeCompatibilityRequirement {
  return { id, status, owner, summary };
}

function assessment(input: AgentRuntimeCompatibilityAssessment): AgentRuntimeCompatibilityAssessment {
  return input;
}

function availabilityGate(status: AgentRuntimeStatus, runtimeName: string): AgentRuntimeCompatibilityAssessment | null {
  if (status === 'available') return null;
  const reason = status === 'missing'
    ? `${runtimeName} is not installed on the MindOS server host.`
    : status === 'signed-out'
      ? `${runtimeName} is installed but not authenticated for this server environment.`
      : `${runtimeName} failed its runtime health check.`;

  return assessment({
    level: 'blocked',
    owner: 'shared',
    summary: reason,
    requirements: [
      requirement('runtime-detected', status === 'missing' ? 'missing' : 'satisfied', 'mindos', 'MindOS must detect the runtime command on the server host.'),
      requirement('runtime-authenticated', status === 'signed-out' ? 'missing' : 'unknown', 'external', 'The external runtime must be authenticated in the same environment that starts MindOS.'),
    ],
    blockers: [reason],
  });
}

function unattendedAssessment(runtimeName: string, input: RuntimeCompatibilityInput): AgentRuntimeCompatibilityAssessment {
  if (input.capabilities.supportsBackgroundRuns && input.lifecycle.remote.unattended === 'supported') {
    return assessment({
      level: 'ready',
      owner: 'shared',
      summary: `${runtimeName} can run background work through the current MindOS runtime contract.`,
      requirements: [
        requirement('background-runner', 'satisfied', 'mindos', 'MindOS exposes a background run lane for this runtime.'),
        requirement('approval-routing', 'satisfied', 'shared', 'Approvals can be resolved without blocking a headless run.'),
        requirement('automation-projection-contract', 'satisfied', 'mindos', 'MindOS exposes remote-control and unattended automation readiness diagnostics.'),
      ],
    });
  }

  return assessment({
    level: 'limited',
    owner: 'shared',
    summary: `${runtimeName} is not yet a full 24/7 unattended worker. Remote execution still needs product-level scheduling, approvals, wake/resume, and failure audit.`,
    requirements: [
      requirement('scheduler', 'missing', 'mindos', 'A durable scheduler must create, retry, and recover background turns.'),
      requirement('approval-routing', 'missing', 'shared', 'Permission prompts need an unattended-safe approval route before headless automation can be trusted.'),
      requirement('wake-resume', 'missing', 'mindos', 'MindOS must be able to wake, resume, and reconcile missed triggers.'),
      requirement('failure-audit', 'missing', 'mindos', 'Failed or partial background work needs a user-visible audit trail.'),
      requirement('automation-projection-contract', 'satisfied', 'mindos', 'MindOS exposes remote-control and unattended automation readiness diagnostics.'),
    ],
    blockers: ['scheduler', 'approval-routing', 'wake-resume', 'failure-audit'],
  });
}

function teamCoordinationAssessment(runtimeName: string, input: RuntimeCompatibilityInput): AgentRuntimeCompatibilityAssessment {
  const hasMailbox = input.lifecycle.coordination.supportsMailbox;
  const hasTaskBoard = input.lifecycle.coordination.supportsTaskBoard;
  if (hasMailbox && hasTaskBoard) {
    return assessment({
      level: 'ready',
      owner: 'mindos',
      summary: `${runtimeName} can participate in durable multi-agent coordination through shared context, mailbox, and task-board primitives.`,
      requirements: [
        requirement('shared-context', 'satisfied', 'mindos', 'MindOS can provide shared context to this runtime.'),
        requirement('mailbox', 'satisfied', 'mindos', 'Durable agent-to-agent mailbox primitives are available.'),
        requirement('task-board', 'satisfied', 'mindos', 'Durable delegated task state is available.'),
      ],
    });
  }

  return assessment({
    level: input.lifecycle.coordination.supportsSharedContext ? 'limited' : 'blocked',
    owner: 'mindos',
    summary: `${runtimeName} can consume shared MindOS context, but durable Team Mode primitives are not first-class yet.`,
    requirements: [
      requirement(
        'shared-context',
        input.lifecycle.coordination.supportsSharedContext ? 'satisfied' : 'missing',
        'mindos',
        'MindOS must provide a shared context surface for worker runtimes.',
      ),
      requirement('mailbox', hasMailbox ? 'satisfied' : 'missing', 'mindos', 'Async agent-to-agent handoff needs a durable mailbox.'),
      requirement('task-board', hasTaskBoard ? 'satisfied' : 'missing', 'mindos', 'Delegated work needs a recoverable task board or equivalent run index.'),
    ],
    blockers: [
      ...(hasMailbox ? [] : ['mailbox']),
      ...(hasTaskBoard ? [] : ['task-board']),
    ],
  });
}

export function mindosRuntimeCompatibilityProfile(input: RuntimeCompatibilityInput): AgentRuntimeCompatibilityProfile {
  const blocked = availabilityGate(input.status, 'MindOS Pi');
  return {
    schemaVersion: 1,
    summary: 'MindOS Pi is the primary managed runtime: strongest for governed context, skills, and product-native tooling; limited for unattended 24/7 work until scheduler and approval routing are first-class.',
    scenarios: {
      'interactive-turn': blocked ?? assessment({
        level: 'ready',
        owner: 'mindos',
        summary: 'MindOS owns the provider, session, context, tools, and stream for interactive turns.',
        requirements: [
          requirement('runtime-registered', 'satisfied', 'mindos', 'MindOS Pi is bundled with the product runtime.'),
          requirement('provider-configured', 'satisfied', 'mindos', 'MindOS owns provider/model configuration for this runtime.'),
        ],
      }),
      'coding-workflow': assessment({
        level: 'limited',
        owner: 'mindos',
        summary: 'MindOS Pi can execute tools and produce artifacts, but native coding runtime affordances such as branches, PRs, and checkpoints are not first-class.',
        requirements: [
          requirement('file-tools', input.harnessCapabilities.tools.includes('file') ? 'satisfied' : 'missing', 'mindos', 'File tools are available through MindOS Pi.'),
          requirement('git-branch-pr-output', 'missing', 'mindos', 'Branch and PR output contracts are not a native Pi runtime capability yet.'),
        ],
        blockers: ['git-branch-pr-output'],
      }),
      'session-continuity': blocked ?? assessment({
        level: 'ready',
        owner: 'mindos',
        summary: 'Pi SessionManager owns persisted JSONL history and compaction entries; MindOS keeps only metadata and run pointers.',
        requirements: [
          requirement('runtime-session-manager', 'satisfied', 'mindos', 'Pi SessionManager is the source of truth for full runtime history.'),
          requirement('run-ledger-pointer', 'satisfied', 'mindos', 'Run ledger stores index cards and archive pointers rather than replay history.'),
        ],
      }),
      'context-governance': assessment({
        level: 'ready',
        owner: 'mindos',
        summary: 'MindOS builds turn context while Pi owns compaction before provider execution.',
        requirements: [
          requirement('context-bridge', 'satisfied', 'mindos', 'MindOS has a product context bridge for selected files, session context, uploads, and recall.'),
          requirement('compact-owner', 'satisfied', 'mindos', 'Pi runtime owns compaction entries for its own session history.'),
        ],
      }),
      'permission-governance': assessment({
        level: 'ready',
        owner: 'mindos',
        summary: 'MindOS permission mode maps directly to the Pi permission policy and is exposed through the runtime permission projection contract.',
        requirements: [
          requirement('permission-policy', 'satisfied', 'mindos', 'MindOS can enforce read/ask/auto/full policy inside the Pi lane.'),
          requirement('permission-projection-contract', 'satisfied', 'mindos', 'MindOS exposes per-runtime permission readiness diagnostics for interactive and unattended scenarios.'),
        ],
      }),
      'mcp-tooling': assessment({
        level: input.capabilities.supportsMcpConfig ? 'ready' : 'blocked',
        owner: 'mindos',
        summary: 'MindOS can project explicitly allowlisted MCP tools into the Pi runtime through the read-only MCP runtime projection contract.',
        requirements: [
          requirement('mcp-config', input.capabilities.supportsMcpConfig ? 'satisfied' : 'missing', 'mindos', 'MindOS must own MCP configuration for this runtime.'),
          requirement('mcp-runtime-projection-contract', 'satisfied', 'mindos', 'MindOS exposes per-runtime MCP readiness diagnostics without leaking server secrets.'),
          requirement('mindos-agent-allowlist', 'satisfied', 'mindos', 'Pi only receives MCP servers explicitly allowlisted for MindOS Agent runtime exposure.'),
        ],
      }),
      'skill-execution': assessment({
        level: 'limited',
        owner: 'mindos',
        summary: 'MindOS Pi can load selected skills, read their runtime requirements, expose runtime match diagnostics, and block explicitly selected skills that are incompatible with the current runtime; automatic runtime routing is still separate.',
        requirements: [
          requirement('load-skill-tool', input.harnessCapabilities.tools.includes('skills') ? 'satisfied' : 'missing', 'mindos', 'Pi runtime can load skill instructions on demand.'),
          requirement('skill-runtime-requirements', 'satisfied', 'mindos', 'Skills can declare machine-readable runtime, tool, remote, unattended, approval, and user-input requirements.'),
          requirement('skill-runtime-matcher', 'satisfied', 'mindos', 'MindOS can explain skill/runtime matches from skill requirements and runtime descriptors.'),
          requirement('skill-runtime-enforcement', 'satisfied', 'mindos', 'The turn runner blocks explicitly selected skills whose matcher result is blocked for the current runtime.'),
          requirement('skill-runtime-routing', 'missing', 'mindos', 'MindOS does not yet auto-select a compatible runtime or surface limited-match warnings before turn start.'),
        ],
        blockers: ['skill-runtime-routing'],
      }),
      'artifact-governance': assessment({
        level: input.harnessCapabilities.output.includes('artifact') ? 'ready' : 'blocked',
        owner: 'mindos',
        summary: 'MindOS can emit artifact output and persist artifact pointers in a unified cross-runtime index for review.',
        requirements: [
          requirement('artifact-output', input.harnessCapabilities.output.includes('artifact') ? 'satisfied' : 'missing', 'mindos', 'Runtime can emit artifacts.'),
          requirement('artifact-projection-contract', 'satisfied', 'mindos', 'MindOS exposes read-only artifact readiness diagnostics for runtime outputs and handoff shapes.'),
          requirement('artifact-index', 'satisfied', 'mindos', 'MindOS has a cross-runtime artifact pointer index for durable review.'),
        ],
        blockers: input.harnessCapabilities.output.includes('artifact') ? [] : ['artifact-output'],
      }),
      'remote-control': blocked ?? assessment({
        level: input.lifecycle.remote.supported ? 'limited' : 'blocked',
        owner: 'mindos',
        summary: 'MindOS Pi can run wherever the MindOS server runs, but remote control is a product surface that still depends on the server being reachable and authenticated.',
        requirements: [
          requirement('server-runnable', input.lifecycle.remote.supported ? 'satisfied' : 'missing', 'mindos', 'Runtime must be runnable on the MindOS server host.'),
          requirement('remote-auth-surface', 'external', 'shared', 'The deployment must expose MindOS through an authenticated remote surface.'),
        ],
      }),
      'unattended-automation': unattendedAssessment('MindOS Pi', input),
      'team-coordination': teamCoordinationAssessment('MindOS Pi', input),
    },
  };
}

export function nativeRuntimeCompatibilityProfile(
  runtime: NativeRuntimeId,
  input: RuntimeCompatibilityInput,
): AgentRuntimeCompatibilityProfile {
  const name = runtime === 'codex' ? 'Codex' : 'Claude Code';
  const blocked = availabilityGate(input.status, name);
  const codingReady = input.harnessCapabilities.tools.includes('git') &&
    (input.harnessCapabilities.output.includes('diff') || input.harnessCapabilities.output.includes('branch'));
  const sessionLevel = runtime === 'codex'
    ? 'ready'
    : input.capabilities.supportsResume ? 'limited' : 'blocked';

  return {
    schemaVersion: 1,
    summary: `${name} is best treated as an external coding worker: strong native execution, permissions, and session semantics, with MindOS providing detection, prompt/context bridging, run indexing, and remote governance.`,
    scenarios: {
      'interactive-turn': blocked ?? assessment({
        level: 'ready',
        owner: 'shared',
        summary: `MindOS can bridge interactive turns into ${name}, while ${name} owns model, auth, permission, and execution semantics.`,
        requirements: [
          requirement('runtime-detected', 'satisfied', 'mindos', `MindOS detects ${name} on the server PATH or configured command.`),
          requirement('runtime-authenticated', 'external', 'external', `${name} must be authenticated in the same environment that starts MindOS.`),
          requirement('stream-normalization', 'satisfied', 'mindos', 'MindOS normalizes native runtime events into product stream events.'),
        ],
      }),
      'coding-workflow': blocked ?? assessment({
        level: codingReady ? 'ready' : 'limited',
        owner: 'external',
        summary: `${name} owns the native coding workflow; MindOS should preserve its tool, diff, and permission semantics instead of reimplementing them.`,
        requirements: [
          requirement('shell-file-git-tools', input.harnessCapabilities.tools.includes('git') ? 'satisfied' : 'missing', 'external', `${name} should expose shell/file/git style coding tools.`),
          requirement('reviewable-output', codingReady ? 'satisfied' : 'unknown', 'shared', 'MindOS should receive reviewable text/diff/artifact output.'),
        ],
        ...(codingReady ? {} : { blockers: ['reviewable-output'] }),
      }),
      'session-continuity': blocked ?? assessment({
        level: sessionLevel,
        owner: 'external',
        summary: runtime === 'codex'
          ? 'Codex provides native thread continuity, list/attach/fork/archive semantics, and MindOS stores only bindings and archive pointers.'
          : 'Claude Code can resume through its own local semantics, but list/attach/archive are not exposed as a full MindOS session lifecycle.',
        requirements: [
          requirement('runtime-session-owner', 'external', 'external', `${name} owns full session history and compaction.`),
          requirement('mindos-runtime-binding', 'satisfied', 'mindos', 'MindOS stores the runtime binding needed to continue from the product session.'),
          requirement('list-attach-archive', runtime === 'codex' ? 'satisfied' : 'missing', 'external', 'Native runtime should expose list/attach/archive when MindOS needs full session lifecycle controls.'),
        ],
        ...(runtime === 'codex' ? {} : { blockers: ['list-attach-archive'] }),
      }),
      'context-governance': assessment({
        level: 'limited',
        owner: 'shared',
        summary: `MindOS can prepend product context, but ${name} owns native history, compaction, and model-specific context-window behavior.`,
        requirements: [
          requirement('product-context-bridge', 'satisfied', 'mindos', 'MindOS can provide selected files, active assistant, uploads, and recall as prompt context.'),
          requirement('native-compact-owner', 'external', 'external', `${name} owns compact/history behavior after context injection.`),
          requirement('context-window-introspection', 'unknown', 'external', 'MindOS does not yet have a universal native context-window telemetry contract.'),
        ],
      }),
      'permission-governance': assessment({
        level: input.capabilities.supportsApprovals ? 'limited' : 'unknown',
        owner: 'shared',
        summary: `${name} owns native permission semantics; MindOS bridges permission requests when the runtime exposes them, but unattended-safe approvals are separate.`,
        requirements: [
          requirement('runtime-approvals', input.capabilities.supportsApprovals ? 'external' : 'unknown', 'external', `${name} must expose approval prompts or a safe native permission mode.`),
          requirement('mindos-permission-bridge', input.capabilities.supportsApprovals ? 'satisfied' : 'unknown', 'mindos', 'MindOS can route supported native approval requests into product stream events.'),
          requirement('permission-projection-contract', 'satisfied', 'mindos', 'MindOS exposes read-only permission readiness diagnostics for native runtime bridges.'),
          requirement('durable-approval-queue', 'missing', 'mindos', 'Native approval prompts are still in-process and interactive, not durable for headless or resumed runs.'),
        ],
        ...(input.capabilities.supportsApprovals ? { blockers: ['durable-approval-queue'] } : {}),
      }),
      'mcp-tooling': assessment({
        level: input.capabilities.supportsMcpConfig ? 'limited' : 'blocked',
        owner: 'shared',
        summary: `${name} may support MCP through native configuration. MindOS can now report per-runtime MCP projection readiness, while actual native config sync remains explicit.`,
        requirements: [
          requirement('native-mcp-config', input.capabilities.supportsMcpConfig ? 'external' : 'missing', 'external', `${name} must own or consume its native MCP configuration.`),
          requirement('mindos-mcp-projection-contract', 'satisfied', 'mindos', 'MindOS exposes read-only MCP projection diagnostics for runtime-specific exposure.'),
          requirement('runtime-mcp-sync', 'missing', 'shared', 'MindOS does not automatically mutate native MCP configs; users still need explicit install/copy/sync action.'),
        ],
        blockers: ['runtime-mcp-sync'],
      }),
      'skill-execution': assessment({
        level: 'limited',
        owner: 'shared',
        summary: `MindOS can prepend skill instructions, expose runtime requirements, explain matches for ${name}, and block explicitly selected skills that are incompatible with the current runtime; automatic runtime routing is still separate.`,
        requirements: [
          requirement('skill-prompt-bridge', 'satisfied', 'mindos', 'MindOS can inject active skill instructions into external runtime prompts.'),
          requirement('skill-runtime-requirements', 'satisfied', 'mindos', 'Skills can declare machine-readable runtime, tool, remote, unattended, approval, and user-input requirements.'),
          requirement('skill-runtime-matcher', 'satisfied', 'mindos', 'MindOS can explain skill/runtime matches from skill requirements and runtime descriptors.'),
          requirement('skill-runtime-enforcement', 'satisfied', 'mindos', 'The turn runner blocks explicitly selected skills whose matcher result is blocked for the current runtime.'),
          requirement('skill-runtime-routing', 'missing', 'mindos', 'MindOS does not yet auto-select a compatible runtime or surface limited-match warnings before turn start.'),
        ],
        blockers: ['skill-runtime-routing'],
      }),
      'artifact-governance': assessment({
        level: input.harnessCapabilities.output.some((kind) => kind === 'diff' || kind === 'artifact' || kind === 'branch' || kind === 'pr')
          ? 'ready'
          : 'blocked',
        owner: 'shared',
        summary: `${name} can produce reviewable coding output, and MindOS can persist safe artifact pointers across runtimes.`,
        requirements: [
          requirement('runtime-review-output', 'satisfied', 'external', `${name} can emit text, diffs, artifacts, branches, or PR references through its native workflow.`),
          requirement('artifact-projection-contract', 'satisfied', 'mindos', 'MindOS exposes read-only artifact readiness diagnostics for native runtime outputs.'),
          requirement('artifact-index', 'satisfied', 'mindos', 'MindOS has a cross-runtime artifact pointer index for durable review and comparison.'),
        ],
        blockers: input.harnessCapabilities.output.some((kind) => kind === 'diff' || kind === 'artifact' || kind === 'branch' || kind === 'pr')
          ? []
          : ['runtime-review-output'],
      }),
      'remote-control': blocked ?? assessment({
        level: input.lifecycle.remote.supported ? 'limited' : 'blocked',
        owner: 'shared',
        summary: `${name} is remote-controllable through MindOS only when the server host has the runtime installed, authenticated, and permission prompts reachable.`,
        requirements: [
          requirement('server-host-install', input.lifecycle.remote.supported ? 'external' : 'missing', 'external', `${name} must be installed on the MindOS server host, not only on the user's laptop shell.`),
          requirement('server-host-auth', 'external', 'external', `${name} auth must be valid in the MindOS server process environment.`),
          requirement('permission-reachability', input.capabilities.supportsApprovals ? 'external' : 'unknown', 'shared', 'Runtime permission prompts must be reachable from the product surface.'),
        ],
      }),
      'unattended-automation': unattendedAssessment(name, input),
      'team-coordination': teamCoordinationAssessment(name, input),
    },
  };
}

export function acpRuntimeCompatibilityProfile(input: RuntimeCompatibilityInput): AgentRuntimeCompatibilityProfile {
  const blocked = availabilityGate(input.status, 'ACP runtime');
  return {
    schemaVersion: 1,
    summary: 'ACP runtimes are protocol workers: useful for broad adapter compatibility, but MindOS only knows the protocol surface until the adapter exposes stronger health, session, MCP, permission, and artifact contracts.',
    scenarios: {
      'interactive-turn': blocked ?? assessment({
        level: 'ready',
        owner: 'shared',
        summary: 'MindOS can start an ACP session and normalize text/tool events for an interactive turn.',
        requirements: [
          requirement('acp-command-detected', 'satisfied', 'mindos', 'MindOS detected an ACP command or configured adapter.'),
          requirement('acp-session-stream', 'external', 'external', 'The adapter must provide a working ACP session stream.'),
        ],
      }),
      'coding-workflow': blocked ?? assessment({
        level: 'limited',
        owner: 'external',
        summary: 'ACP may wrap coding agents, but generic ACP descriptors do not prove git, diff, branch, PR, or checkpoint support.',
        requirements: [
          requirement('adapter-tool-declaration', 'unknown', 'external', 'Adapter-specific tool and artifact capabilities need to be declared before MindOS can trust coding workflow support.'),
        ],
        blockers: ['adapter-tool-declaration'],
      }),
      'session-continuity': assessment({
        level: 'limited',
        owner: 'external',
        summary: 'ACP session identity belongs to the adapter/protocol; MindOS records bindings but cannot list, attach, fork, or archive generic ACP sessions.',
        requirements: [
          requirement('runtime-session-binding', 'satisfied', 'mindos', 'MindOS can remember the runtime binding for a run.'),
          requirement('list-attach-archive', 'missing', 'external', 'Generic ACP session list/attach/archive is not part of the current contract.'),
        ],
        blockers: ['list-attach-archive'],
      }),
      'context-governance': assessment({
        level: 'limited',
        owner: 'shared',
        summary: 'MindOS provides prompt/context text, while the ACP adapter owns native history and context-window handling.',
        requirements: [
          requirement('product-context-bridge', 'satisfied', 'mindos', 'MindOS can provide product context to the ACP prompt.'),
          requirement('adapter-context-owner', 'external', 'external', 'ACP adapter owns native context-window behavior.'),
        ],
      }),
      'permission-governance': assessment({
        level: 'unknown',
        owner: 'external',
        summary: 'Generic ACP does not expose a shared permission/approval prompt contract through MindOS yet.',
        requirements: [
          requirement('permission-projection-contract', 'satisfied', 'mindos', 'MindOS exposes read-only permission readiness diagnostics for runtime descriptors.'),
          requirement('adapter-approval-contract', 'unknown', 'external', 'Adapter-specific permission semantics must be declared before MindOS can route approvals reliably.'),
        ],
      }),
      'mcp-tooling': assessment({
        level: 'unknown',
        owner: 'external',
        summary: 'Generic ACP adapters may own their own MCP/tool configuration; MindOS can report known MCP profiles, but adapter-specific tool contracts remain required.',
        requirements: [
          requirement('mindos-mcp-projection-contract', 'satisfied', 'mindos', 'MindOS exposes read-only MCP projection diagnostics for runtimes with known MCP profiles.'),
          requirement('adapter-mcp-contract', 'unknown', 'external', 'Adapter-specific MCP/tool projection needs to be declared.'),
        ],
      }),
      'skill-execution': assessment({
        level: 'limited',
        owner: 'shared',
        summary: 'MindOS can prepend skill instructions to ACP prompts, expose their runtime requirements, explain runtime matches, and block explicitly selected skills that are incompatible with the current runtime; automatic runtime routing is still separate.',
        requirements: [
          requirement('skill-prompt-bridge', 'satisfied', 'mindos', 'MindOS can inject active skill instructions into ACP prompts.'),
          requirement('skill-runtime-requirements', 'satisfied', 'mindos', 'Skills can declare machine-readable runtime, tool, remote, unattended, approval, and user-input requirements.'),
          requirement('skill-runtime-matcher', 'satisfied', 'mindos', 'MindOS can explain skill/runtime matches from skill requirements and runtime descriptors.'),
          requirement('skill-runtime-enforcement', 'satisfied', 'mindos', 'The turn runner blocks explicitly selected skills whose matcher result is blocked for the current runtime.'),
          requirement('skill-runtime-routing', 'missing', 'mindos', 'MindOS does not yet auto-select a compatible runtime or surface limited-match warnings before turn start.'),
        ],
        blockers: ['skill-runtime-routing'],
      }),
      'artifact-governance': assessment({
        level: 'blocked',
        owner: 'shared',
        summary: 'Generic ACP descriptors only prove text/tool-event streaming; durable artifact, diff, branch, or PR outputs still need adapter-specific declarations.',
        requirements: [
          requirement('artifact-projection-contract', 'satisfied', 'mindos', 'MindOS exposes read-only artifact readiness diagnostics for runtime descriptors.'),
          requirement('artifact-output-contract', 'missing', 'external', 'ACP adapters must declare artifact/diff/output capabilities.'),
          requirement('artifact-index', 'satisfied', 'mindos', 'MindOS has a cross-runtime artifact pointer index for durable review.'),
        ],
        blockers: ['artifact-output-contract'],
      }),
      'remote-control': blocked ?? assessment({
        level: input.lifecycle.remote.supported ? 'limited' : 'blocked',
        owner: 'shared',
        summary: 'ACP is remote-controllable only when the adapter command, dependencies, auth, and subprocess health are valid on the MindOS server host.',
        requirements: [
          requirement('server-host-install', input.lifecycle.remote.supported ? 'external' : 'missing', 'external', 'ACP command must be installed on the MindOS server host.'),
          requirement('adapter-health-contract', 'unknown', 'external', 'MindOS does not yet have a universal ACP health probe contract.'),
        ],
      }),
      'unattended-automation': unattendedAssessment('ACP runtime', input),
      'team-coordination': teamCoordinationAssessment('ACP runtime', input),
    },
  };
}
