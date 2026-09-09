export const dynamic = 'force-dynamic';
import { delegateToMindos } from '../../_mindos-adapter';

export const GET = delegateToMindos('GET', '/api/agent/sessions');
export const POST = delegateToMindos('POST', '/api/agent/sessions');
export const DELETE = delegateToMindos('DELETE', '/api/agent/sessions');
