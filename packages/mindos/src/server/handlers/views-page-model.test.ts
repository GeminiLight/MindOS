import { expect, it, vi } from "vitest";
import { createPageModel } from "./views-page-model.js";
function settings(protocol = "openai") {
  return {
    ai: {
      activeProvider: "p_test",
      providers: [
        {
          id: "p_test",
          name: "Test",
          protocol,
          apiKey: "secret-not-for-errors",
          model: "configured-model",
          baseUrl: "https://model.example/v1",
        },
      ],
    },
  };
}
it("uses the configured model and sends only supplied page context", async () => {
  const fetcher = vi.fn(
    async () =>
      new Response(
        JSON.stringify({ choices: [{ message: { content: '{"spec":{}}' } }] }),
      ),
  );
  const model = createPageModel(settings(), fetcher, {});
  const result = await model({ system: "schema", prompt: "page context" });
  expect(result.model).toBe("configured-model");
  expect(result.text).toBe('{"spec":{}}');
  expect(fetcher).toHaveBeenCalledWith(
    "https://model.example/v1/chat/completions",
    expect.objectContaining({ redirect: "error" }),
  );
  const body = JSON.parse((fetcher.mock.calls[0] as any)[1].body);
  expect(body.messages[1].content).toBe("page context");
});
it("provides actionable missing configuration and never exposes provider response secrets", async () => {
  expect(() => createPageModel({}, fetch, {})).toThrow(
    /Configure an AI provider/,
  );
  const model = createPageModel(
    settings(),
    async () => new Response("secret-not-for-errors", { status: 401 }),
    {},
  );
  await expect(model({ system: "s", prompt: "p" })).rejects.toMatchObject({
    code: "AI_UNAVAILABLE",
    message: expect.not.stringContaining("secret-not-for-errors"),
  });
});
it("supports Anthropic and Gemini envelopes and rejects oversized or empty responses", async () => {
  for (const [protocol, data] of [
    ["anthropic", { content: [{ type: "text", text: "page" }] }],
    ["google", { candidates: [{ content: { parts: [{ text: "page" }] } }] }],
  ] as const) {
    const model = createPageModel(
      settings(protocol),
      async () => new Response(JSON.stringify(data)),
      {},
    );
    expect((await model({ system: "s", prompt: "p" })).text).toBe("page");
  }
  await expect(
    createPageModel(
      settings(),
      async () => new Response("x".repeat(512001)),
      {},
    )({ system: "s", prompt: "p" }),
  ).rejects.toMatchObject({ code: "AI_RESPONSE_LIMIT" });
  await expect(
    createPageModel(
      settings(),
      async () => new Response("{}"),
      {},
    )({ system: "s", prompt: "p" }),
  ).rejects.toMatchObject({ code: "AI_UNAVAILABLE" });
});
