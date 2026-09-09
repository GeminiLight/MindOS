export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
import { delegateToMindos } from '../_mindos-adapter';

export const GET = delegateToMindos('GET', '/api/assistants');
export const POST = delegateToMindos('POST', '/api/assistants');
export const DELETE = delegateToMindos('DELETE', '/api/assistants');
