export const dynamic = 'force-dynamic';
import { delegateToMindos } from '../_mindos-adapter';

export const GET = delegateToMindos('GET', '/api/agent-activity');
export const POST = delegateToMindos('POST', '/api/agent-activity');
