import { handleImTestPost, type ImTestServices } from '@geminilight/mindos/server';
import { sendIMMessage } from '@/lib/im/executor';
import { toNextResponse } from '../../_mindos-adapter';

const services: ImTestServices = {
  sendIMMessage: sendIMMessage as ImTestServices['sendIMMessage'],
};

export async function POST(req: Request) {
  return toNextResponse(await handleImTestPost(await req.json(), services));
}
