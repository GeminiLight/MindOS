import { existsSync } from 'node:fs';
import { resolve } from 'node:path';

// The public mirror deliberately excludes .syncinclude and private fixtures.
// Use the CI repository identity as well so a missing marker fails in source CI.
export const privateCheckout =
  process.env.GITHUB_REPOSITORY?.toLowerCase() === 'geminilight/mindos-dev'
  || existsSync(resolve(__dirname, '../../.syncinclude'));
