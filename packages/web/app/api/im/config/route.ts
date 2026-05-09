import { NextRequest } from 'next/server';
import { handleImConfigDelete, handleImConfigGet, handleImConfigPut } from '@geminilight/mindos/server';
import { readIMConfig, writeIMConfig } from '@/lib/im/config';
import { toNextResponse } from '../../_mindos-adapter';

const services = {
  readConfig: readIMConfig,
  writeConfig: writeIMConfig,
};

export function GET() {
  return toNextResponse(handleImConfigGet(services));
}

export async function PUT(req: NextRequest) {
  const body = await req.json().catch(() => ({}));
  return toNextResponse(handleImConfigPut(body, services));
}

export function DELETE(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  return toNextResponse(handleImConfigDelete(searchParams, services));
}
