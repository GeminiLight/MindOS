import { useSyncExternalStore } from 'react';
import { getWorkspaceIdentity, subscribeWorkspaceIdentity } from '@/lib/workspace-storage';

export function useWorkspaceIdentity(): string {
  return useSyncExternalStore(subscribeWorkspaceIdentity, getWorkspaceIdentity, getWorkspaceIdentity);
}
