export const dynamic = 'force-dynamic';

import {
  handleEmbeddingGet,
  handleEmbeddingPost,
  type EmbeddingServices,
} from '@geminilight/mindos/server';
import { handleRouteErrorSimple } from '@/lib/errors';
import {
  isLocalModelDownloaded,
  downloadLocalModel,
  DEFAULT_LOCAL_MODEL,
  LOCAL_MODEL_OPTIONS,
} from '@/lib/core/embedding-provider';
import { getEmbeddingStatus } from '@/lib/core/hybrid-search';
import { toNextResponse } from '../_mindos-adapter';

const services: EmbeddingServices = {
  isLocalModelDownloaded,
  downloadLocalModel,
  defaultLocalModel: DEFAULT_LOCAL_MODEL,
  localModelOptions: LOCAL_MODEL_OPTIONS,
  getEmbeddingStatus,
};

export async function GET() {
  try {
    return toNextResponse(await handleEmbeddingGet(services));
  } catch (error) {
    return handleRouteErrorSimple(error);
  }
}

export async function POST(req: Request) {
  try {
    return toNextResponse(await handleEmbeddingPost(await req.json(), services));
  } catch (error) {
    return handleRouteErrorSimple(error);
  }
}
