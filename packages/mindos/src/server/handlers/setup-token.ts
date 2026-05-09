import { createHash, randomBytes as cryptoRandomBytes } from 'node:crypto';
import { json, type MindosServerResponse } from '../response.js';

export type SetupGenerateTokenOptions = {
  randomBytes?: (size: number) => Buffer;
};

export function handleSetupGenerateToken(
  body: unknown,
  options: SetupGenerateTokenOptions = {},
): MindosServerResponse<{ token: string }> {
  const seed = body && typeof body === 'object' ? (body as { seed?: unknown }).seed : undefined;
  const raw = typeof seed === 'string' && seed.trim()
    ? createHash('sha256').update(seed.trim()).digest('hex').slice(0, 24)
    : (options.randomBytes ?? cryptoRandomBytes)(12).toString('hex');
  return json({ token: raw.match(/.{4}/g)?.join('-') ?? raw });
}
