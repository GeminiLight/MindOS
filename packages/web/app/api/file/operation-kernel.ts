import { NextRequest, NextResponse } from 'next/server';
import {
  createKnowledgeOperationActor,
  deriveKnowledgeOperationSource,
  executeKnowledgeOperation as executeKernel,
  type ContentChangeSource,
  type KnowledgeOperationHandler,
  parsePermissionRules,
} from '@geminilight/mindos';
import { SYSTEM_FILES } from '@/lib/types';
import { fileOperations, type ChangeEvent } from './handlers';

export interface KnowledgeOperationResult {
  resp: NextResponse;
  changeEvent: ChangeEvent | null;
  source: ContentChangeSource;
  treeChanged: boolean;
}

function err(msg: string, status = 400) {
  return NextResponse.json({ error: msg }, { status });
}

function deniedResponse(reason: string) {
  return NextResponse.json({ error: reason }, { status: 403 });
}

const operationHandlers: Record<string, KnowledgeOperationHandler<NextResponse> | undefined> =
  Object.fromEntries(
    Object.entries(fileOperations).map(([op, handler]) => [
      op,
      async (filePath: string, params: Record<string, unknown>) => {
        const { resp, changeEvent } = await handler(filePath, params);
        return { response: resp, changeEvent };
      },
    ]),
  );

export async function executeKnowledgeOperation(
  req: NextRequest,
  body: Record<string, unknown>,
): Promise<KnowledgeOperationResult> {
  const agentHeader = req.headers.get('x-mindos-agent');
  const source = deriveKnowledgeOperationSource({
    hasAgentHeader: Boolean(agentHeader),
    bodySource: body.source,
    headerSource: req.headers.get('x-mindos-source'),
  });

  const result = await executeKernel({
    body,
    source,
    actor: createKnowledgeOperationActor(source, agentHeader),
    handlers: operationHandlers,
    permissionRules: parsePermissionRules(process.env.MINDOS_PERMISSION_RULES),
    protectedRootFiles: SYSTEM_FILES,
    responses: {
      badRequest: (message) => err(message),
      denied: deniedResponse,
      permissionRequired: ({ op, path, reason, requestId }) => NextResponse.json(
        {
          error: 'permission_required',
          requestId,
          message: `${reason} (${op} ${path})`,
        },
        { status: 403 },
      ),
    },
  });
  return {
    resp: result.response,
    changeEvent: result.changeEvent,
    source: result.source,
    treeChanged: result.treeChanged,
  };
}
