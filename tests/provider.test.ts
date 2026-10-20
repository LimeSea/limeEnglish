import { afterEach, describe, expect, it, vi } from "vitest";
import { PROMPT_VERSION } from "../src/background/analysis-protocol";
import { createMagpieSessionAffinity, listMagpieModels, MagpieProvider } from "../src/background/magpie-provider";
import { analysisMatchesProvider } from "../src/background/provider";
import { isProviderSettings, type AnalysisResult, type StoredAnalysis } from "../src/shared/contracts";

const baseUrl = "http://127.0.0.1:3425/v1";
const analysisPayload = {
  lemma: "bank",
  partOfSpeech: "noun",
  phonetic: "bæŋk",
  contextualMeaningZh: "河岸",
  phrase: null,
  sentenceTranslationZh: "她坐在河岸上。",
  grammarAnalysisZh: "bank 作介词 on 的宾语，构成地点状语。",
} satisfies AnalysisResult;

afterEach(() => vi.restoreAllMocks());

describe("Magpie provider", () => {
  it("uses a fresh gateway session for each user request", () => {
    const first = createMagpieSessionAffinity("occurrence-1");
    const second = createMagpieSessionAffinity("occurrence-1");
    expect(first).toMatch(/^lime-english:occurrence-1:/);
    expect(second).toMatch(/^lime-english:occurrence-1:/);
    expect(second).not.toBe(first);
  });

  it("loads the gateway model catalog without inventing local choices", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({ data: [
      { id: "group/auto-glm", magpie_label: "Auto GLM · routing group", reasoning: true },
      { id: "codex/test", display_name: "Test" },
    ] }), { status: 200 })));
    await expect(listMagpieModels(baseUrl)).resolves.toEqual([
      { id: "group/auto-glm", label: "Auto GLM · routing group", reasoning: true },
      { id: "codex/test", label: "Test", reasoning: false },
    ]);
    expect(fetch).toHaveBeenCalledWith(`${baseUrl}/models`, {
      headers: { authorization: "Bearer magpie-lime-english" },
    });
  });

  it("sends bounded analysis data, model choice, schema, and session affinity", async () => {
    const request = vi.fn().mockResolvedValue(new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify(analysisPayload) } }] }), { status: 200 }));
    vi.stubGlobal("fetch", request);
    const provider = new MagpieProvider(baseUrl, "group/auto-glm", "occurrence-1");
    const result = await provider.analyze({ surface: "bank", sentence: "She sat on the bank.", contextBefore: "", contextAfter: "", articleTitle: "A walk by the river", paragraphBefore: "They walked beside the river.", paragraphAfter: "A boat passed nearby.", targetSpan: { start: 15, end: 19 }, urlMemory: [{ lemma: "stream", partOfSpeech: "noun", contextualMeaningZh: "溪流" }] });
    expect(result.contextualMeaningZh).toBe("河岸");
    expect(result.phonetic).toBe("bæŋk");
    expect(result.providerId).toBe("magpie");
    const [url, init] = request.mock.calls[0]!;
    expect(url).toBe(`${baseUrl}/chat/completions`);
    const body = JSON.parse(String((init as RequestInit).body)) as Record<string, unknown>;
    expect(body.model).toBe("group/auto-glm");
    expect(body.response_format).toEqual(expect.objectContaining({ type: "json_schema" }));
    const messages = body.messages as Array<{ role: string; content: string }>;
    expect(JSON.parse(messages[1]!.content)).toEqual(expect.objectContaining({
      sentence: "She sat on the bank.",
      contextBefore: "",
      contextAfter: "",
      articleTitle: "A walk by the river",
      paragraphBefore: "They walked beside the river.",
      paragraphAfter: "A boat passed nearby.",
      urlMemory: [{ lemma: "stream", partOfSpeech: "noun", contextualMeaningZh: "溪流" }],
    }));
    expect((init as RequestInit).headers).toEqual(expect.objectContaining({
      authorization: "Bearer magpie-lime-english",
      "x-session-affinity": "occurrence-1",
    }));
  });

  it("maps gateway throttling to a stable code", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("limited", { status: 429 })));
    const provider = new MagpieProvider(baseUrl, "group/auto-glm", "occurrence-1");
    await expect(provider.analyze({ surface: "ran", sentence: "She ran.", contextBefore: "", contextAfter: "", articleTitle: "The race", paragraphBefore: "The race began.", paragraphAfter: "She crossed the finish line.", targetSpan: { start: 4, end: 7 }, urlMemory: [] })).rejects.toMatchObject({ code: "GATEWAY_RATE_LIMITED" });
  });
});

describe("Magpie settings and occurrence cache identity", () => {
  it("accepts local HTTP and remote HTTPS but rejects remote plaintext HTTP", () => {
    expect(isProviderSettings({ kind: "magpie", baseUrl, model: "group/auto-glm" })).toBe(true);
    expect(isProviderSettings({ kind: "magpie", baseUrl: "https://gateway.example/v1", model: "model" })).toBe(true);
    expect(isProviderSettings({ kind: "magpie", baseUrl: "http://gateway.example/v1", model: "model" })).toBe(false);
  });

  it("reuses analysis only for the same Magpie model, gateway, and prompt", () => {
    const analysis: StoredAnalysis = { ...analysisPayload, providerId: "magpie", modelId: "group/auto-glm", modelRevision: baseUrl, promptVersion: PROMPT_VERSION, generatedAt: 1 };
    expect(analysisMatchesProvider(analysis, { providerId: "magpie", modelId: "group/auto-glm", modelRevision: baseUrl }, PROMPT_VERSION)).toBe(true);
    expect(analysisMatchesProvider(analysis, { providerId: "magpie", modelId: "other", modelRevision: baseUrl }, PROMPT_VERSION)).toBe(false);
    expect(analysisMatchesProvider(analysis, { providerId: "magpie", modelId: "group/auto-glm", modelRevision: "https://other.example/v1" }, PROMPT_VERSION)).toBe(false);
    expect(analysisMatchesProvider({ ...analysis, promptVersion: "word-context-zh-v2" }, { providerId: "magpie", modelId: "group/auto-glm", modelRevision: baseUrl }, PROMPT_VERSION)).toBe(false);
  });
});
