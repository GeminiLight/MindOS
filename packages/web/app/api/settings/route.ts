export const dynamic = 'force-dynamic';
import { delegateToMindos } from '../_mindos-adapter';

export const GET = delegateToMindos('GET', '/api/settings');
export const POST = delegateToMindos('POST', '/api/settings');
