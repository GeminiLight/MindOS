import { delegateToMindos } from '../../_mindos-adapter';

export const GET = delegateToMindos('GET', '/api/im/config');
export const PUT = delegateToMindos('PUT', '/api/im/config');
export const DELETE = delegateToMindos('DELETE', '/api/im/config');
