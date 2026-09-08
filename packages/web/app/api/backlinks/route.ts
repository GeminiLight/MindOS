export const dynamic = 'force-dynamic';
import { getContentVersion } from '@/lib/fs';
import { delegateToMindos } from '../_mindos-adapter';

// Content-aware version: the link-index snapshot must rebuild for content
// edits without forcing a sidebar/tree refresh.
export const GET = delegateToMindos('GET', '/api/backlinks', { services: { getTreeVersion: getContentVersion } });
