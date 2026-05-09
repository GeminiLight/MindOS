export const dynamic = 'force-dynamic';

import {
  handleA2aOptions,
  handleA2aPost,
  type A2aServices,
} from '@geminilight/mindos/server';
import { handleSendMessage, handleGetTask, handleCancelTask } from '@/lib/a2a/task-handler';
import { toNextResponse } from '../_mindos-adapter';

const services: A2aServices = {
  handleSendMessage: handleSendMessage as A2aServices['handleSendMessage'],
  handleGetTask: handleGetTask as A2aServices['handleGetTask'],
  handleCancelTask: handleCancelTask as A2aServices['handleCancelTask'],
};

export async function POST(req: Request) {
  let body: unknown;
  let parseError = false;
  try {
    body = await req.json();
  } catch {
    parseError = true;
  }

  return toNextResponse(await handleA2aPost({
    contentLength: Number(req.headers.get('content-length') || 0),
    body,
    parseError,
  }, services));
}

export function OPTIONS() {
  return toNextResponse(handleA2aOptions());
}
