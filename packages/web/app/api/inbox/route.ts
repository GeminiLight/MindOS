export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
import { delegateToMindos } from '../_mindos-adapter';

export const GET = delegateToMindos('GET', '/api/inbox');
export const POST = delegateToMindos('POST', '/api/inbox');
export const DELETE = delegateToMindos('DELETE', '/api/inbox');
