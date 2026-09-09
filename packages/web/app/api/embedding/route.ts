export const dynamic = 'force-dynamic';
import { delegateToMindos } from '../_mindos-adapter';

export const GET = delegateToMindos('GET', '/api/embedding');
export const POST = delegateToMindos('POST', '/api/embedding');
