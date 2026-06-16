import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  DEFAULT_AGENT_TASK_DRAFT,
  buildStoredAgentTaskDraft,
  isDefaultAgentTaskDraft,
  parseStoredAgentTaskDraft,
  type AgentTaskDraftInput,
} from '@/lib/agent-task-draft';

export const AGENT_TASK_DRAFT_STORAGE_KEY = 'mindos_agent_task_draft_v1';

export async function loadAgentTaskDraft(): Promise<AgentTaskDraftInput> {
  const raw = await AsyncStorage.getItem(AGENT_TASK_DRAFT_STORAGE_KEY);
  return parseStoredAgentTaskDraft(raw);
}

export async function saveAgentTaskDraft(input: AgentTaskDraftInput): Promise<void> {
  if (isDefaultAgentTaskDraft(input)) {
    await clearAgentTaskDraft();
    return;
  }

  await AsyncStorage.setItem(
    AGENT_TASK_DRAFT_STORAGE_KEY,
    JSON.stringify(buildStoredAgentTaskDraft(input)),
  );
}

export async function clearAgentTaskDraft(): Promise<void> {
  await AsyncStorage.removeItem(AGENT_TASK_DRAFT_STORAGE_KEY);
}

export function createEmptyAgentTaskDraft(): AgentTaskDraftInput {
  return { ...DEFAULT_AGENT_TASK_DRAFT };
}
