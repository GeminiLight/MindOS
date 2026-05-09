export const dynamic = 'force-dynamic';

import {
  handleAcpConfigDelete,
  handleAcpConfigGet,
  handleAcpConfigPost,
  type AcpConfigServices,
} from '@geminilight/mindos/server';
import { readSettings, writeSettings } from '@/lib/settings';
import { toNextResponse } from '../../_mindos-adapter';

const services: AcpConfigServices = {
  readSettings: readSettings as AcpConfigServices['readSettings'],
  writeSettings: writeSettings as AcpConfigServices['writeSettings'],
};

async function readJson(req: Request): Promise<unknown> {
  try {
    return await req.json();
  } catch {
    return null;
  }
}

export function GET() {
  return toNextResponse(handleAcpConfigGet(services));
}

export async function POST(req: Request) {
  return toNextResponse(handleAcpConfigPost(await readJson(req), services));
}

export async function DELETE(req: Request) {
  return toNextResponse(handleAcpConfigDelete(await readJson(req), services));
}
