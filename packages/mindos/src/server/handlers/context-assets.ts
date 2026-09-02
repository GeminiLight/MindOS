import {
  CONTEXT_ASSET_KINDS,
  listContextAssets,
  type ContextAssetKind,
  type ContextAssetStatus,
} from '../../knowledge/context-assets/index.js';
import { json, type MindosServerResponse } from '../response.js';

export type ContextAssetsHandlerServices = { mindRoot: string };

export async function handleContextAssetsGet(
  searchParams: URLSearchParams,
  services: ContextAssetsHandlerServices,
): Promise<MindosServerResponse<unknown>> {
  const kind = parseKind(searchParams.get('kind'));
  const status = parseStatus(searchParams.get('status'));
  const sourceRef = boundedText(searchParams.get('sourceRef'), 500);
  const assets = listContextAssets(services.mindRoot, {
    ...(kind ? { kind } : {}),
    ...(status ? { status } : {}),
    ...(sourceRef ? { sourceRef } : {}),
    limit: parseLimit(searchParams.get('limit')),
  });
  return json({
    schemaVersion: 1,
    assets,
    summary: {
      total: assets.length,
      active: assets.filter((asset) => asset.status === 'active').length,
      draft: assets.filter((asset) => asset.status === 'draft').length,
      deprecated: assets.filter((asset) => asset.status === 'deprecated').length,
    },
  }, { headers: { 'Cache-Control': 'no-store' } });
}

function parseKind(value: string | null): ContextAssetKind | undefined {
  return value && CONTEXT_ASSET_KINDS.includes(value as ContextAssetKind) ? value as ContextAssetKind : undefined;
}

function parseStatus(value: string | null): ContextAssetStatus | undefined {
  return value === 'draft' || value === 'active' || value === 'deprecated' ? value : undefined;
}

function parseLimit(value: string | null): number {
  const parsed = Number.parseInt(value ?? '', 10);
  return Number.isFinite(parsed) ? Math.max(1, Math.min(1_000, parsed)) : 200;
}

function boundedText(value: string | null, max: number): string | undefined {
  const text = value?.trim();
  return text ? text.slice(0, max) : undefined;
}
