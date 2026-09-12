import AsyncStorage from '@react-native-async-storage/async-storage';
import { getWorkspaceIdentity, workspaceKey } from './workspace-storage';
import {
  DEFAULT_AGENT_TASK_DRAFT,
  buildStoredAgentTaskDraft,
  isDefaultAgentTaskDraft,
  parseStoredAgentTaskDraft,
  type AgentTaskDraftInput,
} from '@/lib/agent-task-draft';

export const AGENT_TASK_DRAFT_STORAGE_KEY = 'mindos_agent_task_draft_v1';

export async function loadAgentTaskDraft(scope = getWorkspaceIdentity()): Promise<AgentTaskDraftInput> {
  const raw = await AsyncStorage.getItem(workspaceKey(AGENT_TASK_DRAFT_STORAGE_KEY, scope));
  return parseStoredAgentTaskDraft(raw);
}

export async function saveAgentTaskDraft(input: AgentTaskDraftInput, scope = getWorkspaceIdentity()): Promise<void> {
  if (isDefaultAgentTaskDraft(input)) {
    await clearAgentTaskDraft(scope);
    return;
  }

  await AsyncStorage.setItem(
    workspaceKey(AGENT_TASK_DRAFT_STORAGE_KEY, scope),
    JSON.stringify(buildStoredAgentTaskDraft(input)),
  );
}

export async function clearAgentTaskDraft(scope = getWorkspaceIdentity()): Promise<void> {
  await AsyncStorage.removeItem(workspaceKey(AGENT_TASK_DRAFT_STORAGE_KEY, scope));
}

export function createEmptyAgentTaskDraft(): AgentTaskDraftInput {
  return { ...DEFAULT_AGENT_TASK_DRAFT };
}
