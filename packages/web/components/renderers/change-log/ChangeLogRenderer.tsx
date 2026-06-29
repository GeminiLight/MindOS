'use client';

import type { RendererContext } from '@/lib/renderers/registry';
import { ChangesSurface } from '@/components/changes/ChangesContentPage';

export function ChangeLogRenderer(_ctx: RendererContext) {
  return <ChangesSurface variant="embedded" />;
}
