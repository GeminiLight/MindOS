export const CONTEXT_ASSET_KINDS = [
  'knowledge',
  'echo-playbook',
  'echo-practice',
  'skill',
  'workflow',
  'automation-run',
] as const;

export type ContextAssetKind = (typeof CONTEXT_ASSET_KINDS)[number];
export type ContextAssetStatus = 'draft' | 'active' | 'deprecated';
export type ContextAssetSourceKind = 'file' | 'echo-card' | 'skill' | 'workflow' | 'automation-run';

export type ContextAssetSource = {
  kind: ContextAssetSourceKind;
  ref: string;
};

export type ContextAsset = {
  id: string;
  kind: ContextAssetKind;
  status: ContextAssetStatus;
  title: string;
  path: string;
  contentHash: string;
  version: number;
  source: ContextAssetSource;
  createdAt: string;
  updatedAt: string;
  metadata?: Record<string, unknown>;
};

export type ContextAssetRegistry = {
  schemaVersion: 1;
  updatedAt: string;
  assets: ContextAsset[];
};

export type RegisterContextAssetInput = Omit<ContextAsset, 'id' | 'version' | 'createdAt' | 'updatedAt'> & {
  id?: string;
};

export type RegisterContextFileAssetInput = {
  path: string;
  kind?: ContextAssetKind;
  status?: ContextAssetStatus;
  title?: string;
  source?: ContextAssetSource;
  metadata?: Record<string, unknown>;
};

export type ListContextAssetsOptions = {
  kind?: ContextAssetKind;
  status?: ContextAssetStatus;
  sourceRef?: string;
  limit?: number;
};
