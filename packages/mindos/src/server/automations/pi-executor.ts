import { homedir } from 'node:os';
import { buildMindosContextPrompt } from '../../agent/prompt/index.js';
import { executeMindosPiRuntimeTurn } from '../../agent/turn/execute.js';
import { createStandalonePiRuntime, type StandalonePiRuntimeInput } from '../agent-runtime.js';
import { readRuntimeSettings, type MindosRuntimeSettings } from '../runtime.js';
import type { StudioAutomationExecutorContext, StudioAutomationExecutorResult, StudioAutomationJob } from './types.js';
import { automationExecutionPrompt } from './event-prompt.js';
export { createStandalonePiHostServices } from '../agent-runtime.js';

export async function runStandaloneMindosPiAutomation(input: Pick<StandalonePiRuntimeInput, 'mindRoot' | 'homeDir' | 'runtimeRoot' | 'readSettings' | 'createRuntime'> & {
  job: StudioAutomationJob;
  context: StudioAutomationExecutorContext;
}): Promise<StudioAutomationExecutorResult> {
  input.context.signal.throwIfAborted();
  const settings = input.readSettings?.() ?? readRuntimeSettings({ homeDir: input.homeDir ?? homedir() });
  const prompt = automationExecutionPrompt(input.job, input.context);
  const agentConfig = automationAgentConfig(settings, input.job);
  const turnPrompt = await buildMindosContextPrompt({ prompt, mindRoot: input.mindRoot, sessionWorkDir: { path: input.mindRoot, source: 'mind-root' } });
  const runtime = await createStandalonePiRuntime({ ...input, readSettings: () => settings,
    messages: [{ role: 'user', content: prompt }], turnPrompt, agentConfig, permissionMode: input.job.permissionMode,
    modelOverride: input.job.model === 'gpt-5.5' ? 'gpt-5.5' : undefined,
  });
  return executeMindosPiRuntimeTurn({ runtime, mindRoot: input.mindRoot, cwd: input.mindRoot, permissionMode: input.job.permissionMode,
    maxSteps: agentConfig.maxSteps, signal: input.context.signal, source: 'automation', metadata: { automationId: input.job.id },
  });
}
function automationAgentConfig(settings: MindosRuntimeSettings, job: StudioAutomationJob) {
  const configured = settings.agent && typeof settings.agent === 'object' ? settings.agent : {};
  return {
    ...configured,
    maxSteps: job.effort === 'extra-high' ? 80 : job.effort === 'high' ? 50 : 30,
    thinkingLevel: job.effort === 'extra-high' ? 'xhigh' as const : job.effort === 'high' ? 'high' as const : 'medium' as const,
  };
}
