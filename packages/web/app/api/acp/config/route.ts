export const dynamic = 'force-dynamic';
import { delegateToMindos } from '../../_mindos-adapter';

export const GET = delegateToMindos('GET', '/api/acp/config');
export const POST = delegateToMindos('POST', '/api/acp/config');
export const DELETE = delegateToMindos('DELETE', '/api/acp/config');
