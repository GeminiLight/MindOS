import { NextRequest } from 'next/server';
import { exchangeStudySession } from '@/lib/study-session-http';
import type { StudyRouteContext } from '@/lib/study-access-http';
export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export function POST(req: NextRequest, context: StudyRouteContext) { return exchangeStudySession(req, context, 'review'); }
