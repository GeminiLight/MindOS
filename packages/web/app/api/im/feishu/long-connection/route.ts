import { delegateToMindos } from '../../../_mindos-adapter';

export const GET = delegateToMindos('GET', '/api/im/feishu/long-connection');
export const POST = delegateToMindos('POST', '/api/im/feishu/long-connection');
export const DELETE = delegateToMindos('DELETE', '/api/im/feishu/long-connection');
