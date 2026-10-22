import {
  buildMindosEndpointCandidates,
  MINDOS_PROVIDER_PRESETS,
  resolveMindosProviderConfig,
} from "../provider-settings.js";
import type { MindosRuntimeSettings } from "../runtime.js";
import type { PageGenerationModel } from "../../knowledge/views/page-generation.js";
import { ViewError } from "../../knowledge/views/types.js";
const LOCAL = new Set(["ollama", "lm-studio", "vllm"]);
async function limitedJson(response: Response): Promise<any> {
  const reader = response.body?.getReader();
  if (!reader)
    throw new ViewError(
      "AI_UNAVAILABLE",
      "The AI provider returned an empty response.",
      502,
    );
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    for (;;) {
      const next = await reader.read();
      if (next.done) break;
      size += next.value.length;
      if (size > 512_000)
        throw new ViewError(
          "AI_RESPONSE_LIMIT",
          "The AI response exceeded the page limit. Try a smaller adjustment.",
          502,
        );
      chunks.push(next.value);
    }
  } finally {
    await reader.cancel().catch(() => {});
    reader.releaseLock();
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    throw new ViewError(
      "AI_UNAVAILABLE",
      "The AI provider returned an unreadable response.",
      502,
    );
  }
}
/** Uses the existing configured provider. No provider response body or secret enters UI errors. */
export function createPageModel(
  settings: MindosRuntimeSettings,
  fetcher: typeof fetch = fetch,
  env = process.env,
): PageGenerationModel {
  const config = resolveMindosProviderConfig(
    settings as Parameters<typeof resolveMindosProviderConfig>[0],
    undefined,
    env,
  );
  const preset = MINDOS_PROVIDER_PRESETS[config.provider];
  if (
    !config.baseUrl ||
    !config.model ||
    (!LOCAL.has(config.provider) && !config.apiKey)
  )
    throw new ViewError(
      "AI_NOT_CONFIGURED",
      "Configure an AI provider in Settings to adjust this page. Manual editing is still available.",
      503,
    );
  return async ({ system, prompt, signal }) => {
    const url = new URL(config.baseUrl);
    if (
      !["http:", "https:"].includes(url.protocol) ||
      url.username ||
      url.password
    )
      throw new ViewError(
        "AI_NOT_CONFIGURED",
        "The configured AI provider address is invalid.",
        503,
      );
    let endpoint: string, body: unknown;
    const headers: Record<string, string> = {
      "content-type": "application/json",
    };
    const type = preset?.apiType ?? "openai-completions";
    if (type === "anthropic-messages") {
      endpoint = buildMindosEndpointCandidates(
        config.baseUrl,
        "/messages",
        type,
      )[0]!;
      headers["x-api-key"] = config.apiKey;
      headers["anthropic-version"] = "2023-06-01";
      body = {
        model: config.model,
        max_tokens: 8192,
        system,
        messages: [{ role: "user", content: prompt }],
      };
    } else if (type === "gemini") {
      endpoint =
        config.baseUrl.replace(/\/+$/, "") +
        "/models/" +
        encodeURIComponent(config.model) +
        ":generateContent";
      headers["x-goog-api-key"] = config.apiKey;
      body = {
        systemInstruction: { parts: [{ text: system }] },
        contents: [{ role: "user", parts: [{ text: prompt }] }],
        generationConfig: { maxOutputTokens: 8192 },
      };
    } else {
      endpoint = buildMindosEndpointCandidates(
        config.baseUrl,
        "/chat/completions",
        type,
      )[0]!;
      if (config.apiKey) headers.authorization = "Bearer " + config.apiKey;
      body = {
        model: config.model,
        ...(config.provider === "openai"
          ? { max_completion_tokens: 8192 }
          : { max_tokens: 8192 }),
        messages: [
          { role: "system", content: system },
          { role: "user", content: prompt },
        ],
      };
    }
    let response: Response;
    try {
      response = await fetcher(endpoint, {
        method: "POST",
        headers,
        body: JSON.stringify(body),
        signal,
        redirect: "error",
      });
    } catch (error) {
      if (signal?.aborted) throw error;
      throw new ViewError(
        "AI_UNAVAILABLE",
        "The configured AI provider could not be reached. Your page is unchanged.",
        502,
      );
    }
    if (!response.ok) {
      await response.body?.cancel().catch(() => {});
      throw new ViewError(
        "AI_UNAVAILABLE",
        `The AI provider declined the request (HTTP ${response.status}). Check its configuration or try again.`,
        502,
      );
    }
    const data = await limitedJson(response);
    const text =
      type === "anthropic-messages"
        ? data.content
            ?.filter((p: any) => p.type === "text")
            .map((p: any) => p.text)
            .join("")
        : type === "gemini"
          ? data.candidates?.[0]?.content?.parts
              ?.map((p: any) => p.text ?? "")
              .join("")
          : data.choices?.[0]?.message?.content;
    if (typeof text !== "string" || !text.trim())
      throw new ViewError(
        "AI_UNAVAILABLE",
        "The AI provider returned no page content. Try a smaller adjustment.",
        502,
      );
    return { text, model: config.model };
  };
}
