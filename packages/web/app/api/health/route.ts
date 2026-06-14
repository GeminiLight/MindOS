export const dynamic = 'force-dynamic';
import {
  handleHealth,
  handleHealthOptions,
  readMindosProductVersion,
} from '@geminilight/mindos/server';
import { getProjectRoot } from '@/lib/project-root';
import { readRuntimeAuthConfig } from '@/lib/runtime-auth-config';
import { toNextResponse } from '../_mindos-adapter';

const projectRoot = getProjectRoot();
const version = readMindosProductVersion({ projectRoot });

export async function GET() {
  const { webPassword } = readRuntimeAuthConfig();

  return toNextResponse(handleHealth({
    projectRoot,
    runtimeRoot: projectRoot,
    env: {
      ...process.env,
      WEB_PASSWORD: webPassword,
      npm_package_version: version,
    },
  }));
}

export async function OPTIONS() {
  return toNextResponse(handleHealthOptions());
}
