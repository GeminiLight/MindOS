import { it, expect, vi } from "vitest";
import { parseProviders } from "@/lib/custom-endpoints";
import { currentComparisonRuntime } from "@/lib/method-comparison-runtime";
import { configuredStudyRuntime } from "@/lib/study-coaching-config";
vi.mock("@/lib/settings", () => ({
  effectiveAiConfig: () => ({
    provider: "openai",
    model: "k3",
    baseUrl: "https://example.test/v1",
    apiKey: "test",
    providerEntry: { temperature: 1, studyMaxOutputTokens: 4096 },
  }),
}));
it("preserves a configured sampling temperature and freezes it into a comparison", () => {
  expect(
    parseProviders([
      {
        id: "p_test",
        name: "Test",
        protocol: "openai",
        apiKey: "",
        baseUrl: "",
        model: "k3",
        temperature: 1,
      },
    ])[0].temperature,
  ).toBe(1);
  expect(currentComparisonRuntime()?.temperature).toBe(1);
});
it("rejects temperature drift before making a provider request", () => {
  const runtime = {
    provider: "openai",
    model: "k3",
    endpoint: "https://example.test/v1/chat/completions",
    temperature: 0,
  };
  expect(configuredStudyRuntime(runtime)).toBeNull();
  expect(configuredStudyRuntime({ ...runtime, temperature: 1 })).not.toBeNull();
});
it("drops invalid sampling settings rather than persisting NaN or out-of-range values", () => {
  for (const temperature of [-1, 3, NaN, Infinity, "1", null])
    expect(
      parseProviders([
        {
          id: "p_test",
          protocol: "openai",
          apiKey: "",
          baseUrl: "",
          model: "k3",
          temperature,
        },
      ])[0].temperature,
    ).toBeUndefined();
});
it("preserves a bounded research token budget for new protocols", () => {
  const base = { id: "p_test", protocol: "openai", apiKey: "", baseUrl: "", model: "glm-5.3-flash" };
  for (const studyMaxOutputTokens of [1024, 2048, 4096])
    expect(parseProviders([{ ...base, studyMaxOutputTokens }])[0].studyMaxOutputTokens).toBe(studyMaxOutputTokens);
  for (const studyMaxOutputTokens of [0, -1, 4097, 1024.5, NaN, Infinity, "2048"])
    expect(parseProviders([{ ...base, studyMaxOutputTokens }])[0].studyMaxOutputTokens).toBeUndefined();
  expect(currentComparisonRuntime()?.maxOutputTokens).toBe(4096);
});
