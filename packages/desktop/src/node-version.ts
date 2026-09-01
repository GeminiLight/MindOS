export const MIN_NODE_VERSION = '22.19.0';

function parseStableNodeVersion(value: string): [number, number, number] | null {
  const match = value.trim().match(/^v?(\d+)\.(\d+)\.(\d+)$/);
  if (!match) return null;
  return [Number(match[1]), Number(match[2]), Number(match[3])];
}

export function isNodeVersionAcceptable(value: string): boolean {
  const actual = parseStableNodeVersion(value);
  const minimum = parseStableNodeVersion(MIN_NODE_VERSION);
  if (!actual || !minimum) return false;

  for (let index = 0; index < actual.length; index += 1) {
    if (actual[index]! > minimum[index]!) return true;
    if (actual[index]! < minimum[index]!) return false;
  }
  return true;
}
