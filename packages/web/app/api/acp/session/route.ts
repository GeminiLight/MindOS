export const dynamic = 'force-dynamic';
import { delegateToMindos } from '../../_mindos-adapter';

export const GET = delegateToMindos('GET', '/api/acp/session');
export const POST = delegateToMindos('POST', '/api/acp/session');
export const DELETE = delegateToMindos('DELETE', '/api/acp/session');
