来想想AI到底怎么样帮助人来思考。

2. 模版空间选择器

你要再仔细检查现在判断Agent已连接的逻辑

支持更多文件类型！！
关于CLI的空间和Dir的区分是否同时支持。

2/2

Next.js 16.1.6 (stale)
Turbopack
Console Error



Maximum update depth exceeded. This can happen when a component calls setState inside useEffect, but useEffect either doesn't have a dependency array, or one of the dependencies changes on every render.
hooks/useAiOrganize.ts (307:34) @ useAiOrganize.useCallback[start]


  305 |           if (partial.changes) setChanges(partial.changes);
  306 |           if (partial.currentTool !== undefined) setCurrentTool(partial.currentTool);
> 307 |           if (partial.stageHint) setStageHint(partial.stageHint);
      |                                  ^
  308 |           if (partial.summary !== undefined) setSummary(partial.summary);
  309 |         },
  310 |         (path, content) => {
Call Stack
10

Show 7 ignore-listed frame(s)
useAiOrganize.useCallback[start]
hooks/useAiOrganize.ts (307:34)
consumeOrganizeStream
hooks/useAiOrganize.ts (215:13)
async useAiOrganize.useCallback[start] [as start]
hooks/useAiOrganize.ts (301:22)
1
2
Was this helpful?