export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
import { delegateToMindos } from '../_mindos-adapter';

export const GET = delegateToMindos('GET', '/api/sync');
export const POST = delegateToMindos('POST', '/api/sync');
