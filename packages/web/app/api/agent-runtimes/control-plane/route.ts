export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
import { delegateToMindos } from '../../_mindos-adapter';

export const GET = delegateToMindos('GET', '/api/agent-runtimes/control-plane');
export const POST = delegateToMindos('POST', '/api/agent-runtimes/control-plane');
