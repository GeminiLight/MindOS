export const dynamic = 'force-dynamic';
import { delegateToMindos } from '../_mindos-adapter';

export const GET = delegateToMindos('GET', '/api/health');
export const OPTIONS = delegateToMindos('OPTIONS', '/api/health');
