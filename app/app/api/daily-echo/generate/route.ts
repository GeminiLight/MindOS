/**
 * API Route: Daily Echo Report Generation
 * POST /api/daily-echo/generate
 *
 * Generates or retrieves a daily echo report
 */

import { NextRequest, NextResponse } from 'next/server';
import type {
  DailyEchoGenerateRequest,
  DailyEchoGenerateResponse,
  DailyEchoErrorResponse,
} from '@/lib/daily-echo/types';
import { generateDailyEchoReport } from '@/lib/daily-echo/generator';
import { loadDailyEchoConfig } from '@/lib/daily-echo/config';
import { getDailyEchoReport } from '@/lib/db/daily-echo-db';

/**
 * POST /api/daily-echo/generate
 * Generate or retrieve a daily echo report
 */
export async function POST(
  request: NextRequest
): Promise<NextResponse<DailyEchoGenerateResponse | DailyEchoErrorResponse>> {
  try {
    const body = (await request.json()) as DailyEchoGenerateRequest;

    // Parse date (default to today)
    let targetDate = new Date();
    if (body.date) {
      const parsed = new Date(body.date);
      if (isNaN(parsed.getTime())) {
        return NextResponse.json(
          {
            code: 'invalid_date',
            message: 'Invalid date format. Use YYYY-MM-DD',
          },
          { status: 400 }
        );
      }
      targetDate = parsed;
    }

    const dateStr = targetDate.toISOString().split('T')[0]; // YYYY-MM-DD

    // Load config
    const config = loadDailyEchoConfig();

    // If not forcing regenerate, try cache
    if (!body.force) {
      try {
        const cached = await getDailyEchoReport(dateStr);
        if (cached) {
          const response: DailyEchoGenerateResponse = {
            report: cached,
            cached: true,
            generatedAt: cached.generatedAt,
          };
          return NextResponse.json(response);
        }
      } catch (err) {
        console.warn('[API] Cache lookup failed:', err);
        // Continue with generation
      }
    }

    // Generate new report
    try {
      const report = await generateDailyEchoReport(
        targetDate,
        config,
        body.force ?? false
      );

      const response: DailyEchoGenerateResponse = {
        report,
        cached: false,
        generatedAt: report.generatedAt,
      };

      return NextResponse.json(response);
    } catch (genErr) {
      // Check if it's a known error
      const message =
        genErr instanceof Error ? genErr.message : 'Unknown generation error';

      if (message.includes('LLM') || message.includes('AI')) {
        return NextResponse.json(
          {
            code: 'no_ai_provider',
            message: 'AI provider not configured. Please set up an AI provider in settings.',
            details: message,
          },
          { status: 400 }
        );
      }

      return NextResponse.json(
        {
          code: 'generation_failed',
          message: 'Failed to generate daily echo report',
          details: message,
        },
        { status: 500 }
      );
    }
  } catch (err) {
    // Request parsing error
    console.error('[API] Daily Echo request error:', err);
    return NextResponse.json(
      {
        code: 'generation_failed',
        message: 'Invalid request format',
        details:
          err instanceof Error ? err.message : 'Unknown error',
      },
      { status: 400 }
    );
  }
}

/**
 * GET /api/daily-echo/generate (retrieve cached report for date)
 */
export async function GET(request: NextRequest) {
  try {
    const url = new URL(request.url);
    const date = url.searchParams.get('date');

    if (!date || !date.match(/^\d{4}-\d{2}-\d{2}$/)) {
      return NextResponse.json(
        {
          code: 'invalid_date',
          message: 'Missing or invalid date parameter. Use YYYY-MM-DD format.',
        },
        { status: 400 }
      );
    }

    try {
      const report = await getDailyEchoReport(date);

      if (!report) {
        return NextResponse.json(
          {
            code: 'generation_failed',
            message: `No report found for date: ${date}`,
          },
          { status: 404 }
        );
      }

      const response: DailyEchoGenerateResponse = {
        report,
        cached: true,
        generatedAt: report.generatedAt,
      };

      return NextResponse.json(response);
    } catch (err) {
      return NextResponse.json(
        {
          code: 'generation_failed',
          message: 'Failed to retrieve report',
          details:
            err instanceof Error ? err.message : 'Unknown error',
        },
        { status: 500 }
      );
    }
  } catch (err) {
    return NextResponse.json(
      {
        code: 'generation_failed',
        message: 'Invalid request',
      },
      { status: 400 }
    );
  }
}
