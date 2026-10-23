/** Keep human turns and neighboring replies before filling the remaining excerpt budget. */
export function sessionExcerpts(messages: readonly { id: string; role: string; text: string }[]) {
  const conversation = messages.filter(m => (m.role === 'user' || m.role === 'assistant') && m.text.trim());
  const chosen = new Set<number>();
  const add = (index: number) => { if(index >= 0 && index < conversation.length && chosen.size < 20) chosen.add(index); };
  const humans = conversation.flatMap((m, index) => m.role === 'user' ? [index] : []);
  // For very long histories keep a spread of human turns, including first and last.
  const anchors = humans.length <= 8 ? humans : Array.from({length:8},(_,i)=>humans[Math.round(i*(humans.length-1)/7)]);
  for (const index of anchors) add(index);
  for (const index of anchors) { add(index-1); add(index+1); }
  add(0); add(conversation.length-1);
  return [...chosen].sort((a,b)=>a-b).map(index=>{const m=conversation[index];return {messageId:m.id,role:m.role as 'user'|'assistant',quote:m.text.trim().slice(0,500)};});
}
