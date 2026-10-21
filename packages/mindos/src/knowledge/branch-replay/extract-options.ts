import type { ReplayScene, ReplaySource, ReplayMessage, ReplayRef } from './index.js';
const compact=(s:string,n:number)=>s.replace(/[#*_`]/g,'').replace(/\s+/g,' ').trim().slice(0,n);
const reference=(m:ReplayMessage,quote?:string):ReplayRef=>({messageId:m.id,quote:quote||m.text.trim().slice(0,400)});
function options(message:ReplayMessage) {
  const lines=message.text.split('\n');
  return lines.flatMap((line,index)=>{
    const plain=line.trim().replace(/^#{1,4}\s*/,'').replace(/^[-*]\s*/,'').replace(/\*\*/g,'');
    const match=plain.match(/^(?:方案|路径|方向|Option|Route)?\s*([A-E])\s*[.、)）:：｜|]\s*(.{2,80})$/i);
    return match?[{letter:match[1]!.toUpperCase(),label:compact(match[2]!,80),quote:line.trim(),description:compact(lines[index+1]||match[2]!,180)}]:[];
  });
}

/** Only explicit named alternatives qualify. Numbered action sequences do not. */
export function extractExplicitRoutes(source:ReplaySource):ReplayScene[] {
  const scenes:ReplayScene[]=[];
  for(let i=0;i<source.messages.length&&scenes.length<5;i++){
    const message=source.messages[i];if(!message||message.role!=='assistant')continue;
    const choices=options(message);
    if(choices.length<2||choices.length>5||new Set(choices.map(c=>c.letter)).size!==choices.length)continue;
    const context=source.messages.slice(0,i).reverse().find(m=>m.role==='user')||message;
    const nextOptions=source.messages.findIndex((m,j)=>j>i&&m.role==='assistant'&&options(m).length>=2);
    const future=source.messages.slice(i+1,nextOptions>i?nextOptions:Math.min(source.messages.length,i+20));
    const chinese=/[\u4e00-\u9fff]/.test(context.text);
    scenes.push({id:`options-${scenes.length+1}`,title:chinese?'你想先试哪条路径？':'Which route would you try first?',context:compact(context.text,360),evidence:[reference(context)],choices:choices.map(c=>{
      const recorded=future.filter(m=>m.text.includes(c.label)&&/(尝试|验证|测试|执行|采用|已完成|确认|成功|失败|tested|worked|failed)/i.test(m.text)&&!/(如果|假如|可能|建议|would|might|should)/i.test(m.text)).slice(0,4);
      return {id:`route-${c.letter.toLowerCase()}`,label:c.label,description:c.description,proposal:reference(message,c.quote),outcome:{
        kind:recorded.length?'recorded':'unobserved',title:recorded.length?(chinese?'会话中记录的后续':'What the session recorded'):(chinese?'这条路还没有后续记录':'No outcome recorded for this route'),
        steps:recorded.map(m=>({title:chinese?'看看原文中的结果':'Read the recorded outcome',text:compact(m.text,1000),refs:[reference(m)]})),
      }};
    })});
  }
  return scenes;
}
