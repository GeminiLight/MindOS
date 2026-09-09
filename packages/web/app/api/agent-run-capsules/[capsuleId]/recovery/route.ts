export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
import { delegateToMindos } from '../../../_mindos-adapter';

export const POST = delegateToMindos('POST', '/api/agent-run-capsules/[capsuleId]/recovery');
