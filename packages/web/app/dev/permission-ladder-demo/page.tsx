'use client';

import { useState } from 'react';
import { FileText, ImageIcon, Target } from 'lucide-react';
import ModeCapsule from '@/components/ask/ModeCapsule';
import type { ComposerPermissionChoice } from '@/lib/agent/composer-permission';

/**
 * Preview for the reworked composer footer. The old 「模式」control
 * (Build/Plan/Goal) is gone: Plan joined the permission ladder, where the
 * server already put it, and Goal moved into the + menu as an objective.
 */
export default function PermissionLadderDemoPage() {
  const [choice, setChoice] = useState<ComposerPermissionChoice>('ask');
  const [planChoice, setPlanChoice] = useState<ComposerPermissionChoice>('plan');

  return (
    <main className="box-border min-h-[calc(100vh-var(--app-titlebar-h))] max-w-[100vw] overflow-x-hidden bg-background py-8 text-foreground">
      <div className="mx-6 box-border flex w-[calc(100vw_-_48px)] min-w-0 max-w-[calc(100vw_-_48px)] flex-col gap-6 sm:mx-auto sm:w-full sm:max-w-4xl">
        <header className="space-y-2">
          <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground">MindOS Agent Demo</p>
          <h1 className="text-2xl font-semibold tracking-normal">Composer Controls</h1>
          <p className="max-w-3xl text-sm leading-6 text-muted-foreground">
            One permission ladder instead of two overlapping mode controls.
          </p>
        </header>

        <section className="min-w-0 space-y-4">
          <div className="space-y-1.5">
            <p className="text-xs text-muted-foreground">权限阶梯（默认）</p>
            <ModeCapsule choice={choice} onChange={setChoice} />
          </div>
          <div className="space-y-1.5">
            <p className="text-xs text-muted-foreground">选中「计划」时</p>
            <ModeCapsule choice={planChoice} onChange={setPlanChoice} />
          </div>
          <div className="space-y-1.5">
            <p className="text-xs text-muted-foreground">加号菜单</p>
            <div className="w-[180px] rounded-xl border border-border/60 bg-card py-1 shadow-lg">
              <div className="flex w-full items-center gap-2.5 px-3 py-2 text-xs">
                <FileText size={12} className="shrink-0 text-muted-foreground" />文件
              </div>
              <div className="flex w-full items-center gap-2.5 px-3 py-2 text-xs">
                <ImageIcon size={12} className="shrink-0 text-muted-foreground" />图片
              </div>
              <div className="my-1 border-t border-border/50" />
              <div className="flex w-full items-center gap-2.5 px-3 py-2 text-xs">
                <Target size={12} className="shrink-0 text-muted-foreground" />设定目标
              </div>
            </div>
          </div>
        </section>
      </div>
    </main>
  );
}
