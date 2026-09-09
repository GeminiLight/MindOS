export const dynamic = 'force-dynamic';
import { delegateToMindos } from '../../_mindos-adapter';

export const POST = delegateToMindos('POST', '/api/agents/custom');
export const PUT = delegateToMindos('PUT', '/api/agents/custom');
export const DELETE = delegateToMindos('DELETE', '/api/agents/custom');
