export const dynamic = 'force-dynamic';
import { delegateToMindos } from '../_mindos-adapter';

// GET /api/bootstrap?target_dir=Workflows/Research
export const GET = delegateToMindos('GET', '/api/bootstrap');
