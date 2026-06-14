export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from 'next/server';
import { ErrorCodes, handleRouteErrorSimple, MindOSError } from '@/lib/errors';
import { readSettings } from '@/lib/settings';
import { withObsidianPluginRuntime } from '@/lib/obsidian-compat/runtime-service';

const MAX_BLOCKS = 20;
const MAX_SOURCE_LENGTH = 20_000;

interface MarkdownCodeBlockRequest {
  id?: unknown;
  language?: unknown;
  source?: unknown;
}

interface MarkdownCodeBlocksBody {
  blocks?: unknown;
}

function parseBlocks(body: MarkdownCodeBlocksBody): Array<{ id: string; language: string; source: string }> {
  if (!Array.isArray(body.blocks)) {
    throw new MindOSError(ErrorCodes.INVALID_REQUEST, 'Missing blocks');
  }
  if (body.blocks.length > MAX_BLOCKS) {
    throw new MindOSError(ErrorCodes.INVALID_REQUEST, `Too many markdown code blocks; max ${MAX_BLOCKS}`);
  }

  return body.blocks.map((raw, index) => {
    const block = raw as MarkdownCodeBlockRequest;
    if (typeof block.id !== 'string' || block.id.trim().length === 0) {
      throw new MindOSError(ErrorCodes.INVALID_REQUEST, `Missing block id at index ${index}`);
    }
    if (typeof block.language !== 'string' || block.language.trim().length === 0) {
      throw new MindOSError(ErrorCodes.INVALID_REQUEST, `Missing block language at index ${index}`);
    }
    if (typeof block.source !== 'string') {
      throw new MindOSError(ErrorCodes.INVALID_REQUEST, `Missing block source at index ${index}`);
    }
    if (block.source.length > MAX_SOURCE_LENGTH) {
      throw new MindOSError(ErrorCodes.INVALID_REQUEST, `Markdown code block source is too large at index ${index}`);
    }

    return {
      id: block.id.trim(),
      language: block.language.trim().toLowerCase(),
      source: block.source,
    };
  });
}

export async function POST(req: NextRequest) {
  try {
    const blocks = parseBlocks(await req.json() as MarkdownCodeBlocksBody);
    const settings = readSettings();

    const renderedBlocks = await withObsidianPluginRuntime(settings.mindRoot, async (manager) => {
      const results = [];
      for (const block of blocks) {
        results.push({
          id: block.id,
          language: block.language,
          renders: await manager.renderMarkdownCodeBlock(block.language, block.source),
        });
      }
      return results;
    });

    return NextResponse.json({
      ok: true,
      blocks: renderedBlocks,
    });
  } catch (err) {
    return handleRouteErrorSimple(err);
  }
}
