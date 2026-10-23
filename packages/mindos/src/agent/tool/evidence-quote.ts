/** Match only formatting differences, then retain a verbatim span of the actual output. */
export function resolveEvidenceQuote(output: string, quote: string): string | null {
  if (output.includes(quote)) return quote;
  const normalize = (text: string) => {
    const formatting = new Set<number>();
    for (const match of text.matchAll(/(\*\*|~~|`|\*)(?=\S)([\s\S]*?\S)\1/g)) {
      const start = match.index!, width = match[1]!.length;
      for(let i=0;i<width;i++) {formatting.add(start+i);formatting.add(start+match[0].length-width+i);}
    }
    let value=''; const positions:number[]=[];
    for(let i=0;i<text.length;i++) {
      if(formatting.has(i)) continue;
      const char=/\s/.test(text[i]!) ? ' ' : text[i]!;
      if(char===' ' && value.endsWith(' ')) continue;
      value+=char;positions.push(i);
    }
    return {value,positions};
  };
  const source=normalize(output), target=normalize(quote).value.trim();
  if(target.length<24) return null;
  const at=source.value.indexOf(target);
  if(at<0 || at!==source.value.lastIndexOf(target)) return null;
  return output.slice(source.positions[at],source.positions[at+target.length-1]!+1);
}
