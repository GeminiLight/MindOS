import { listLocalAssistants } from './handlers/assistants.js';
import { createHash } from 'node:crypto';
import { statSync } from 'node:fs';
import { homedir } from 'node:os';
import path from 'node:path';
import { createStandalonePiRuntime, type StandalonePiRuntimeInput } from './agent-runtime.js';
import { collectAllFilesFromMindRoot, readTextFileFromMindRoot, readRuntimeSettings } from './runtime.js';
import { parseMindosAgentTurnRequest } from '../agent/turn/request.js';
import { buildMindosContextPrompt, createMindosActiveAssistantPrompt, prependMindosActiveAssistantPrompt, parseMindosAssistantMarkdownPrompt } from '../agent/prompt/index.js';
import { expandMindosAgentAttachedFiles, loadMindosAgentFileContext, normalizeMindosAgentStepLimit, type MindosUiAgentMessage } from '../agent/turn/index.js';
import { executeAgentTurn, executeMindosPiRuntimeTurn } from '../agent/turn/execute.js';
import type { MindOSSSEvent } from '../agent/turn/sse.js';
import { createMindosAgentPermissionPolicy } from '../agent/mindos-pi/permission/index.js';
import { createMindosAgentModeContract } from '../agent/mode.js';
import { createNativeRuntimeLane, createAcpRuntimeLane } from '../agent/runtime/lane-adapters.js';
import { createMindosRuntimeImageAttachments, createMindosRuntimeUploadedFileAttachments } from '../agent/runtime/attachments.js';
import * as acp from '../protocols/acp/index.js';

type Options = Pick<StandalonePiRuntimeInput, 'mindRoot' | 'homeDir' | 'runtimeRoot' | 'readSettings' | 'createRuntime'>;

/** Default HTTP host, using the same execution lifecycle as IM and automation. */
export function createStandaloneAgentTurnStream(options: Options): (body: unknown) => AsyncIterable<MindOSSSEvent> {
  return async function* (body) {
    const owner = new AbortController();
    let closed = false;
    let sentError = false;
    const stream = new ReadableStream<MindOSSSEvent>({
      start(controller) {
        const send = (event: MindOSSSEvent) => {
          if (closed) return;
          if (event.type === 'error') sentError = true;
          controller.enqueue(event);
        };
        void runStandaloneTurn(options, body, owner.signal, send).catch(error => {
          if (!sentError) send({ type: 'error', message: error instanceof Error ? error.message : String(error) });
        }).finally(() => { if (!closed) { closed = true; controller.close(); } });
      },
      cancel() { closed = true; owner.abort(); },
    });
    const reader = stream.getReader();
    try {
      for (;;) { const next = await reader.read(); if (next.done) break; yield next.value; }
    } finally { owner.abort(); await reader.cancel(); reader.releaseLock(); }
  };
}

async function runStandaloneTurn(options: Options, raw: unknown, signal: AbortSignal, send: (event: MindOSSSEvent) => void): Promise<void> {
  const parsed = parseMindosAgentTurnRequest(raw);
  if (!parsed.ok) throw new Error(parsed.message);
  const body = parsed.body;
  if (parsed.effortNotice) send({ type: 'status', message: parsed.effortNotice, visible: true });
  const settings = options.readSettings?.() ?? readRuntimeSettings({ homeDir: options.homeDir });
  const mindRoot = options.mindRoot;
  const cwd = path.resolve(body.workDir?.path || body.runtimeBinding?.cwd || mindRoot);
  if (!statSync(cwd).isDirectory()) throw new Error('Agent working directory is not a directory.');
  const messages = body.messages as MindosUiAgentMessage[];
  const lastUser = [...messages].reverse().find(message => message.role === 'user');
  if (!lastUser || (!lastUser.content?.trim() && !lastUser.images?.length)) throw new Error('Agent turn needs a user message.');
  const activeAssistant = body.assistantId && body.assistantId !== 'mindos' ? listLocalAssistants(mindRoot).find(assistant => assistant.id === body.assistantId) : undefined;
  if (body.assistantId && body.assistantId !== 'mindos' && !activeAssistant) throw new Error(`Assistant not found: ${body.assistantId}`);
  const mode = body.agentMode ?? 'default';
  const policy = createMindosAgentPermissionPolicy(mode === 'plan' ? 'read' : body.permissionMode ?? activeAssistant?.permissionMode);
  const attached = expandMindosAgentAttachedFiles(body.attachedFiles ?? [], () => collectAllFilesFromMindRoot(mindRoot));
  const fileContext = loadMindosAgentFileContext(attached, body.currentFile, {
    readFile: file => readTextFileFromMindRoot(mindRoot, file),
    truncate: text => text.slice(0, 100_000), maxContentChars: 100_000,
  });
  let prompt = await buildMindosContextPrompt({
    prompt: lastUser?.content ?? '', mindRoot, fileContext,
    uploadedParts: body.uploadedFiles?.map(file => `${file.name}\n${file.content}`),
    sessionWorkDir: { ...body.workDir, path: cwd }, sessionContextSelection: body.contextSelection,
  });
  if (activeAssistant) prompt = prependMindosActiveAssistantPrompt(prompt, createMindosActiveAssistantPrompt({
    ...activeAssistant, instructions: parseMindosAssistantMarkdownPrompt(activeAssistant.prompt.content ?? '').body,
  }));
  signal.throwIfAborted();
  const selected = body.selectedRuntime ?? (body.selectedAcpAgent ? { ...body.selectedAcpAgent, kind: 'acp' as const } : { id: 'mindos', name: 'MindOS', kind: 'mindos' as const });
  const capsuleRequest = { messages, runtime: selected, permissionMode: policy.permissionMode, agentMode: mode,
    context: { currentFile: body.currentFile, attachedFiles: body.attachedFiles ?? [], uploadedFiles: body.uploadedFiles ?? [], receiptIds: [], assetIds: [] },
    options: { workDir: body.workDir, contextSelection: body.contextSelection, assistantId: body.assistantId, providerOverride: body.providerOverride, modelOverride: body.modelOverride, maxSteps: body.maxSteps, agentOptions: body.agentOptions, runtimeOptions: body.runtimeOptions, acpRuntimeOptions: body.acpRuntimeOptions },
  };
  if (selected.kind === 'mindos') {
    const configured = settings.agent && typeof settings.agent === 'object' ? settings.agent : {};
    const maxSteps = normalizeMindosAgentStepLimit({ requestedMaxSteps: body.maxSteps, agentMaxSteps: (configured as { maxSteps?: number }).maxSteps });
    const runtime = await createStandalonePiRuntime({ ...options, readSettings: () => settings, workDir: cwd, messages, turnPrompt: prompt,
      permissionMode: policy.permissionMode, agentConfig: { ...configured, ...body.agentOptions },
      providerOverride: body.providerOverride, modelOverride: body.modelOverride,
      ...(body.chatSessionId ? { runtimeSession: { sessionDir: path.join(options.homeDir ?? homedir(), '.mindos', 'pi-sessions', createHash('sha256').update(body.chatSessionId).digest('hex')) } } : {}),
    });
    await executeMindosPiRuntimeTurn({ runtime, mindRoot, cwd, permissionMode: policy.permissionMode, agentMode: mode, capsuleRequest, maxSteps, signal, chatSessionId: body.chatSessionId, send });
    return;
  }
  const attachments = [...createMindosRuntimeImageAttachments(lastUser?.images), ...createMindosRuntimeUploadedFileAttachments(body.uploadedFiles)];
  const binding = body.runtimeBinding;
  const resume = binding?.runtime === selected.kind && binding.runtimeId === selected.id && (!binding.status || binding.status === 'active') ? binding.externalSessionId : undefined;
  const lane = selected.kind === 'acp'
    ? createAcpRuntimeLane({ agent: selected, cwd, prompt, attachments, resumeExternalSessionId: resume, acpPermissionMode: policy.acpPermissionMode, runtimeOptions: body.acpRuntimeOptions ?? {} }, {
      createSession: acp.createSession, loadSession: acp.loadSession,
      promptStream: async (...args) => { await acp.promptStream(...args); },
      cancelPrompt: acp.cancelPrompt, closeSession: acp.closeSession, setMode: acp.setMode,
      setConfigOption: async (...args) => { await acp.setConfigOption(...args); },
      takePooledSession: acp.takePooledAcpSession, parkPooledSession: acp.parkAcpSession,
    })
    : createNativeRuntimeLane({ runtime: { ...selected, kind: selected.kind, externalSessionId: resume }, cwd, prompt, attachments, permissionMode: policy.permissionMode, agentMode: mode, ...body.runtimeOptions });
  await executeAgentTurn(lane, {
    signal, chatSessionId: body.chatSessionId,
    ledger: { agentKind: selected.kind === 'acp' ? 'acp' : 'native-runtime', runtimeId: selected.id, displayName: selected.name, permissionMode: policy.permissionMode, inputSummary: prompt },
    capsule: { mindRoot, source: 'interactive', request: capsuleRequest, provenance: { cwd } },
    modeContract: createMindosAgentModeContract({ mode, prompt, requestedPermissionMode: body.permissionMode, effectivePermissionMode: policy.permissionMode }),
  }, send);
}
