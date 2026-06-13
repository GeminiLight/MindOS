'use client';

import { ChangeLogRenderer } from '@/components/renderers/change-log/ChangeLogRenderer';
import type { RendererContext } from '@/lib/renderers/registry';

const noop = async () => {};
const ctx: RendererContext = { filePath: '.mindos/change-log.json', content: '', extension: 'json', saveAction: noop };

export default function ChangelogClient() {
  return (
    <div className="max-w-4xl mx-auto px-4 md:px-6">
      <ChangeLogRenderer {...ctx} />
    </div>
  );
}
