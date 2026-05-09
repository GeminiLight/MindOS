export const dynamic = 'force-dynamic';
import {
  handleHealth,
  handleHealthOptions,
  readMindosProductVersion,
} from '@geminilight/mindos/server';
import { getProjectRoot } from '@/lib/project-root';
import { toNextResponse } from '../_mindos-adapter';

const projectRoot = getProjectRoot();
const version = readMindosProductVersion({ projectRoot });

export async function GET() {
  return toNextResponse(handleHealth({
    projectRoot,
    runtimeRoot: projectRoot,
    env: {
      ...process.env,
      npm_package_version: version,
    },
  }));
}

export async function OPTIONS() {
  return toNextResponse(handleHealthOptions());
}
