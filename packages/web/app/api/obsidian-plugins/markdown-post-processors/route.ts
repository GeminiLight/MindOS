export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from 'next/server';
import { ErrorCodes, handleRouteErrorSimple, MindOSError } from '@/lib/errors';
import { readSettings } from '@/lib/settings';
import { withObsidianPluginRuntime } from '@/lib/obsidian-compat/runtime-service';

const MAX_MARKDOWN_LENGTH = 100_000;
const MAX_SOURCE_PATH_LENGTH = 1_000;

interface MarkdownPostProcessorsBody {
  markdown?: unknown;
  sourcePath?: unknown;
}

function parseBody(body: MarkdownPostProcessorsBody): { markdown: string; sourcePath: string } {
  if (typeof body.markdown !== 'string') {
    throw new MindOSError(ErrorCodes.INVALID_REQUEST, 'Missing markdown');
  }
  if (body.markdown.length > MAX_MARKDOWN_LENGTH) {
    throw new MindOSError(ErrorCodes.INVALID_REQUEST, `Markdown source is too large; max ${MAX_MARKDOWN_LENGTH}`);
  }
  if (body.sourcePath !== undefined && typeof body.sourcePath !== 'string') {
    throw new MindOSError(ErrorCodes.INVALID_REQUEST, 'Invalid sourcePath');
  }

  const sourcePath = typeof body.sourcePath === 'string' ? body.sourcePath.trim() : '';
  if (sourcePath.length > MAX_SOURCE_PATH_LENGTH) {
    throw new MindOSError(ErrorCodes.INVALID_REQUEST, `sourcePath is too large; max ${MAX_SOURCE_PATH_LENGTH}`);
  }

  return {
    markdown: body.markdown,
    sourcePath,
  };
}

export async function POST(req: NextRequest) {
  try {
    const body = parseBody(await req.json() as MarkdownPostProcessorsBody);
    const settings = readSettings();

    return NextResponse.json({
      ok: true,
      renders: await withObsidianPluginRuntime(
        settings.mindRoot,
        (manager) => manager.renderMarkdownPostProcessors(body.markdown, body.sourcePath),
      ),
    });
  } catch (err) {
    return handleRouteErrorSimple(err);
  }
}
