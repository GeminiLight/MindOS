import {
  handleImFeishuLongConnectionDelete,
  handleImFeishuLongConnectionGet,
  handleImFeishuLongConnectionPost,
  type ImFeishuLongConnectionServices,
} from '@geminilight/mindos/server';
import { readIMConfig, writeIMConfig } from '@/lib/im/config';
import { getFeishuWSClientStatus, startFeishuWSClient, stopFeishuWSClient } from '@/lib/im/feishu-ws-client';
import { toNextResponse } from '../../../_mindos-adapter';

const services: ImFeishuLongConnectionServices = {
  readConfig: readIMConfig as ImFeishuLongConnectionServices['readConfig'],
  writeConfig: writeIMConfig as ImFeishuLongConnectionServices['writeConfig'],
  getFeishuWSClientStatus,
  startFeishuWSClient: startFeishuWSClient as ImFeishuLongConnectionServices['startFeishuWSClient'],
  stopFeishuWSClient,
};

export function GET() {
  return toNextResponse(handleImFeishuLongConnectionGet(services));
}

export async function POST() {
  return toNextResponse(await handleImFeishuLongConnectionPost(services));
}

export function DELETE() {
  return toNextResponse(handleImFeishuLongConnectionDelete(services));
}
