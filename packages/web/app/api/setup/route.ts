export const dynamic = 'force-dynamic';
import { delegateToMindos } from '../_mindos-adapter';

export const GET = delegateToMindos('GET', '/api/setup');
export const POST = delegateToMindos('POST', '/api/setup');
export const PATCH = delegateToMindos('PATCH', '/api/setup');
