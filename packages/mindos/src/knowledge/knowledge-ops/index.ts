import {
  evaluatePermission,
  type PermissionActorType,
  type PermissionRule,
} from '../../foundation/permissions/index.js';

export type ContentChangeSource = 'user' | 'agent' | 'system';

export interface KnowledgeChangeEvent {
  op: string;
  path: string;
  summary: string;
  before?: string;
  after?: string;
  beforePath?: string;
  afterPath?: string;
}

export interface KnowledgeOperationHandlerResult<TResponse> {
  response: TResponse;
  changeEvent: KnowledgeChangeEvent | null;
}

export type KnowledgeOperationHandler<TResponse> = (
  filePath: string,
  params: Record<string, unknown>,
) => KnowledgeOperationHandlerResult<TResponse> | Promise<KnowledgeOperationHandlerResult<TResponse>>;

export interface PermissionRequiredInput {
  op: string;
  path: string;
  reason: string;
  requestId: string;
}

export interface KnowledgeOperationResponses<TResponse> {
  badRequest(message: string): TResponse;
  denied(reason: string): TResponse;
  permissionRequired(input: PermissionRequiredInput): TResponse;
}

export interface KnowledgeOperationResult<TResponse> {
  response: TResponse;
  changeEvent: KnowledgeChangeEvent | null;
  source: ContentChangeSource;
  treeChanged: boolean;
}

export interface ExecuteKnowledgeOperationOptions<TResponse> {
  body: Record<string, unknown>;
  source: ContentChangeSource;
  actor: {
    type: PermissionActorType;
    agentName?: string;
  };
  handlers: Record<string, KnowledgeOperationHandler<TResponse> | undefined>;
  responses: KnowledgeOperationResponses<TResponse>;
  permissionRules?: PermissionRule[];
  protectedRootFiles?: Iterable<string>;
  treeChangingOps?: Iterable<string>;
}

export interface DeriveSourceInput {
  hasAgentHeader?: boolean;
  bodySource?: unknown;
  headerSource?: unknown;
}

export const DEFAULT_TREE_CHANGING_OPS = new Set([
  'create_file',
  'delete_file',
  'rename_file',
  'move_file',
  'create_space',
  'rename_space',
]);

function isContentChangeSource(value: unknown): value is ContentChangeSource {
  return value === 'user' || value === 'agent' || value === 'system';
}

export function deriveKnowledgeOperationSource(input: DeriveSourceInput): ContentChangeSource {
  if (input.hasAgentHeader) return 'agent';
  if (isContentChangeSource(input.bodySource)) return input.bodySource;
  if (isContentChangeSource(input.headerSource)) return input.headerSource;
  return 'user';
}

export function createKnowledgeOperationActor(
  source: ContentChangeSource,
  rawAgentName?: string | null,
): { type: PermissionActorType; agentName?: string } {
  const type: PermissionActorType = source;
  const agentName = rawAgentName?.replace(/[\x00-\x1f]/g, '').slice(0, 100);
  return agentName ? { type, agentName } : { type };
}

function permissionRequestId(): string {
  return `perm_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

function badOperationResult<TResponse>(
  response: TResponse,
  source: ContentChangeSource,
): KnowledgeOperationResult<TResponse> {
  return {
    response,
    changeEvent: null,
    source,
    treeChanged: false,
  };
}

export async function executeKnowledgeOperation<TResponse>(
  options: ExecuteKnowledgeOperationOptions<TResponse>,
): Promise<KnowledgeOperationResult<TResponse>> {
  const { op, path: filePath, ...params } = options.body;
  const { source, responses } = options;

  if (!op || typeof op !== 'string') {
    return badOperationResult(responses.badRequest('missing op'), source);
  }
  if (!filePath || typeof filePath !== 'string') {
    return badOperationResult(responses.badRequest('missing path'), source);
  }

  const handler = options.handlers[op];
  if (!handler) {
    return badOperationResult(responses.badRequest(`unknown op: ${op}`), source);
  }

  const decision = evaluatePermission({
    actor: options.actor,
    op,
    path: filePath,
    rules: options.permissionRules,
    protectedRootFiles: options.protectedRootFiles,
  });

  if (decision.effect === 'deny') {
    return badOperationResult(responses.denied(decision.reason), source);
  }

  if (decision.effect === 'ask') {
    return badOperationResult(
      responses.permissionRequired({
        op,
        path: filePath,
        reason: decision.reason,
        requestId: permissionRequestId(),
      }),
      source,
    );
  }

  const result = await handler(filePath, params);
  const treeChangingOps = options.treeChangingOps ?? DEFAULT_TREE_CHANGING_OPS;

  return {
    response: result.response,
    changeEvent: result.changeEvent,
    source,
    treeChanged: new Set(treeChangingOps).has(op),
  };
}
