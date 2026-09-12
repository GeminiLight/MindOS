/** Read a bounded initialize response, including streaming SSE servers. */
export async function readMcpInitializeResult(response: Response): Promise<boolean> {
  if (!response.body) return false;
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  const sse = response.headers.get('content-type')?.includes('text/event-stream');
  let buffer = '';
  let bytes = 0;
  const valid = (text: string) => {
    try {
      const body = JSON.parse(text);
      const result = body?.result;
      return body?.jsonrpc === '2.0' && body.id === 1 && !body.error
        && typeof result?.protocolVersion === 'string'
        && result.capabilities !== null && typeof result.capabilities === 'object' && !Array.isArray(result.capabilities)
        && typeof result.serverInfo?.name === 'string' && typeof result.serverInfo?.version === 'string';
    } catch { return false; }
  };
  try {
    while (bytes <= 64 * 1024) {
      const { done, value } = await reader.read();
      if (value) { bytes += value.length; if (bytes > 64 * 1024) return false; buffer += decoder.decode(value, { stream: true }); }
      if (sse) {
        const events = buffer.split(/\r?\n\r?\n/);
        buffer = events.pop() ?? '';
        for (const event of events) {
          const data = event.split(/\r?\n/).filter(line => line.startsWith('data:')).map(line => line.slice(5).trimStart()).join('\n');
          if (valid(data)) return true;
        }
      } else if (done) return valid(buffer);
      if (done) return false;
    }
    return false;
  } finally {
    await reader.cancel().catch(() => {});
  }
}
