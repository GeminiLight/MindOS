import type { StudyCoachingRequest } from '@geminilight/mindos/knowledge';
import { configuredStudyRuntime } from '@/lib/study-coaching-config';
type Result = { status: 'succeeded'; output: string; reportedModel?: string; responseId?: string } | { status: 'failed'; failure: 'provider' | 'configuration' | 'interrupted' | 'invalid-output' };
async function boundedText(response: Response, signal: AbortSignal) {
  if (!response.body) throw Error('Empty body');
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = []; let size = 0;
  const cancelled = () => { void reader.cancel().catch(() => {}); };
  signal.addEventListener('abort', cancelled, { once: true });
  try {
    while (true) {
      signal.throwIfAborted();
      const part = await reader.read();
      if (part.done) break;
      size += part.value.byteLength;
      if (size > 131072) { void reader.cancel().catch(() => {}); throw Error('Response too large'); }
      chunks.push(part.value);
    }
    signal.throwIfAborted();
    return Buffer.concat(chunks).toString('utf8');
  } finally { signal.removeEventListener('abort', cancelled); reader.releaseLock(); }
}
/** One stateless provider request. No generic Agent session, tools, retrieval, fallback, retries or history store. */
async function executeIsolatedChat(input: StudyCoachingRequest, caller?: AbortSignal, captureIdentity = false): Promise<Result> {
  const signal = AbortSignal.any([AbortSignal.timeout(90000), ...(caller ? [caller] : [])]);
  try {
    signal.throwIfAborted();
    const runtime = input.runtime;
    const config = configuredStudyRuntime(runtime);
    if (!config) return { status: 'failed', failure: 'configuration' };
    const endpoint = config.endpoint;
    // Credentials are snapshotted once and sent only to the configured, frozen endpoint.
    const response = await fetch(endpoint, { method: 'POST', redirect: 'error', cache: 'no-store', signal,
      headers: { 'Content-Type': 'application/json', ...(config.apiKey ? { Authorization: 'Bearer ' + config.apiKey } : {}) },
      body: JSON.stringify({ model: runtime.model, messages: input.messages, stream: false, temperature: runtime.temperature, max_tokens: runtime.maxOutputTokens }),
    });
    if (!response.ok) { void response.body?.cancel().catch(() => {}); return { status: 'failed', failure: 'provider' }; }
    let data;
    try { data = JSON.parse(await boundedText(response, signal)); } catch { return { status: 'failed', failure: signal.aborted ? 'interrupted' : 'invalid-output' }; }
    const choice = data?.choices?.[0]; const message = choice?.message;
    if (!Array.isArray(data?.choices) || data.choices.length !== 1 || choice.finish_reason !== 'stop' || message?.role !== 'assistant'
      || message.tool_calls?.length || message.function_call || typeof message.content !== 'string' || !message.content.trim() || message.content.trim().length > 8000
      || (data.model !== undefined && (typeof data.model !== 'string' || !data.model.trim() || data.model.length > 200)))
      return { status: 'failed', failure: 'invalid-output' };
    if (captureIdentity && data.id !== undefined && (typeof data.id !== 'string' || !data.id.trim() || data.id.length > 200)) return { status: 'failed', failure: 'invalid-output' };
    return { status: 'succeeded', output: message.content.trim(), ...(typeof data.model === 'string' ? { reportedModel: data.model.trim() } : {}), ...(captureIdentity && typeof data.id === 'string' ? { responseId: data.id.trim() } : {}) };
  } catch { return { status: 'failed', failure: signal.aborted ? 'interrupted' : 'provider' }; }
}
export const executeStudyCoaching = (input: StudyCoachingRequest, caller?: AbortSignal) => executeIsolatedChat(input, caller);
export const executeMethodComparison = (input: StudyCoachingRequest, caller?: AbortSignal) => executeIsolatedChat(input, caller, true);
