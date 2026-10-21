import { replayFingerprint, validateBranchStory } from '@geminilight/mindos/knowledge/branch-replay';
export function requestRaceExample(locale:'zh'|'en') {
  const zh=locale==='zh';
  const text=zh?'示例规则：切换到项目 B。旧请求在 900 ms 返回，新请求在 320 ms 返回。清理缓存不阻止旧返回。校验当前轮次后，旧结果被忽略。':'Example rules: switch to project B. The old request returns at 900 ms; the current request returns at 320 ms. Clearing cache does not prevent a late response. A current-round guard ignores it.';
  const refs=[{messageId:'rules',quote:text}];
  const story=validateBranchStory({id:'request-race',runtime:'example',title:zh?'旧请求为什么会覆盖页面？':'Why can an old request overwrite the page?',project:'MindOS',messages:[{id:'rules',role:'assistant',text}]},{
    title:zh?'演练：旧请求与新页面':'Practice: old requests, new pages',summary:zh?'改变条件，观察每次选择的实际状态变化。':'Change conditions and observe the simulated state.',scenes:[{
      id:'fork',title:zh?'你会先处理哪一层？':'Which layer would you address first?',context:zh?'已切换到项目 B，但上一轮请求还在执行。选择一条路，观察返回顺序如何影响页面。':'Project B is selected, but an earlier request is still running. Choose a route and observe its effect.',evidence:refs,
      choices:[
        {id:'cache',label:zh?'清理已有缓存':'Clear existing cache',description:zh?'先移除已经保存的旧数据。':'Remove the old data already stored.',proposal:refs[0],outcome:{kind:'simulation',title:zh?'观察这条路的结果':'Observe this route',steps:[
          {title:zh?'当前内容已经返回':'The current content has returned',text:zh?'先停在新请求返回的时刻。':'Pause at the current response.',refs},
          {title:zh?'再看看较早的请求返回后':'Now let the earlier request return',text:zh?'调整条件，可以改变到达顺序和最终显示。':'Adjust conditions to change arrival order and the final display.',refs},
        ]}},
        {id:'guard',label:zh?'校验当前请求归属':'Check the current request round',description:zh?'只允许当前轮次更新页面。':'Only let the current round update the page.',proposal:refs[0],outcome:{kind:'simulation',title:zh?'观察保护后的状态':'Observe the guarded state',steps:[
          {title:zh?'当前内容已经返回':'The current content has returned',text:zh?'新项目的返回可以更新页面。':'The current response can update the page.',refs},
          {title:zh?'旧返回到达，但没有覆盖页面':'The old result arrives without overwriting',text:zh?'旧请求继续运行，当前轮次的内容保持。':'The old request still runs; the current state is preserved.',refs},
        ]}},
      ],
    }],
  });
  // Translations share one scenario and cursor. Bump this version when its rules change.
  return {...story,fingerprint:replayFingerprint('request-race:v1')};
}
