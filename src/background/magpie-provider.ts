import type { AnalysisInput, AnalysisProvider } from "./provider";
import { ANALYSIS_SYSTEM_PROMPT, ModelEngineError, PROMPT_VERSION, parseAnalysisOutput } from "./analysis-protocol";
import type { ProviderIdentity, StoredAnalysis } from "../shared/contracts";

export const DEFAULT_MAGPIE_BASE_URL = "http://127.0.0.1:3425/v1";
const MAGPIE_CLIENT_AUTHORIZATION = "Bearer magpie-lime-english";

const ANALYSIS_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["lemma", "partOfSpeech", "phonetic", "contextualMeaningZh", "phrase", "sentenceTranslationZh", "grammarAnalysisZh"],
  properties: {
    lemma: { type: "string", minLength: 1, maxLength: 128 },
    partOfSpeech: { enum: ["noun", "verb", "adjective", "adverb", "pronoun", "preposition", "conjunction", "interjection", "determiner", "other", "unknown"] },
    phonetic: { type: "string", minLength: 1, maxLength: 128 },
    contextualMeaningZh: { type: "string", minLength: 1, maxLength: 200 },
    phrase: {
      anyOf: [
        { type: "null" },
        {
          type: "object",
          additionalProperties: false,
          required: ["text", "type", "meaningZh"],
          properties: {
            text: { type: "string", minLength: 1, maxLength: 300 },
            type: { enum: ["phrasal_verb", "idiom", "collocation", "compound", "other"] },
            meaningZh: { type: "string", minLength: 1, maxLength: 300 },
          },
        },
      ],
    },
    sentenceTranslationZh: { type: "string", minLength: 1, maxLength: 1_000 },
    grammarAnalysisZh: { type: "string", minLength: 1, maxLength: 1_500 },
  },
} as const;


interface ChatMessage { role: "system" | "user"; content: string }

export interface MagpieModel {
  id: string;
  label: string;
  reasoning: boolean;
}

function responseContent(value: unknown): string | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  const choices = (value as Record<string, unknown>).choices;
  if (!Array.isArray(choices) || choices.length < 1) return undefined;
  const choice = choices[0];
  if (!choice || typeof choice !== "object" || Array.isArray(choice)) return undefined;
  const message = (choice as Record<string, unknown>).message;
  if (!message || typeof message !== "object" || Array.isArray(message)) return undefined;
  const content = (message as Record<string, unknown>).content;
  return typeof content === "string" ? content : undefined;
}

export async function listMagpieModels(baseUrl: string): Promise<MagpieModel[]> {
  let response: Response;
  try {
    response = await fetch(`${baseUrl.trim().replace(/\/+$/, "")}/models`, {
      headers: { authorization: MAGPIE_CLIENT_AUTHORIZATION },
    });
  }
  catch (error) { throw new ModelEngineError("GATEWAY_UNAVAILABLE", error instanceof Error ? error.message : "Magpie gateway unavailable"); }
  if (!response.ok) throw new ModelEngineError("GATEWAY_REQUEST_FAILED", `Magpie models HTTP ${response.status}`);
  const value: unknown = await response.json();
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new ModelEngineError("MODEL_OUTPUT_INVALID", "Invalid Magpie model catalog");
  const data = (value as Record<string, unknown>).data;
  if (!Array.isArray(data)) throw new ModelEngineError("MODEL_OUTPUT_INVALID", "Invalid Magpie model catalog");
  const models: MagpieModel[] = [];
  for (const item of data) {
    if (!item || typeof item !== "object" || Array.isArray(item)) continue;
    const record = item as Record<string, unknown>;
    if (typeof record.id !== "string" || !record.id.trim()) continue;
    const label = typeof record.magpie_label === "string" ? record.magpie_label
      : typeof record.display_name === "string" ? record.display_name
      : record.id;
    models.push({ id: record.id, label, reasoning: record.reasoning === true });
  }
  if (models.length === 0) throw new ModelEngineError("MODEL_OUTPUT_INVALID", "Magpie returned no usable models");
  return models;
}

const REQUEST_IDENTITY = "lime-english";

export function createMagpieSessionAffinity(scope: string): string {
  return `${REQUEST_IDENTITY}:${scope}:${crypto.randomUUID()}`;
}

export class MagpieProvider implements AnalysisProvider {
  readonly identity: ProviderIdentity;

  constructor(baseUrl: string, model: string, private readonly sessionAffinity: string) {
    const normalizedBaseUrl = baseUrl.trim().replace(/\/+$/, "");
    this.identity = { providerId: "magpie", modelId: model.trim(), modelRevision: normalizedBaseUrl };
  }

  private async complete(messages: ChatMessage[], schemaName: string, schema: object, maxTokens: number): Promise<string> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 45_000);
    try {
      const response = await fetch(`${this.identity.modelRevision}/chat/completions`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: MAGPIE_CLIENT_AUTHORIZATION,
          "x-session-affinity": this.sessionAffinity,
        },
        body: JSON.stringify({
          model: this.identity.modelId,
          messages,
          response_format: { type: "json_schema", json_schema: { name: schemaName, strict: true, schema } },
          reasoning_effort: "low",
          max_tokens: maxTokens,
          stream: false,
        }),
        signal: controller.signal,
      });
      if (response.status === 429) throw new ModelEngineError("GATEWAY_RATE_LIMITED", "Magpie gateway rate limit exceeded");
      if (!response.ok) throw new ModelEngineError("GATEWAY_REQUEST_FAILED", `Magpie gateway HTTP ${response.status}`);
      const content = responseContent(await response.json());
      if (!content) throw new ModelEngineError("MODEL_OUTPUT_INVALID", "Magpie returned no message content");
      return content;
    } catch (error) {
      if (error instanceof ModelEngineError) throw error;
      const message = error instanceof Error ? error.message : "Magpie gateway unavailable";
      throw new ModelEngineError("GATEWAY_UNAVAILABLE", message);
    } finally {
      clearTimeout(timeout);
    }
  }


  async analyze(input: AnalysisInput): Promise<StoredAnalysis> {
    const raw = await this.complete([
      { role: "system", content: ANALYSIS_SYSTEM_PROMPT },
      { role: "user", content: JSON.stringify(input) },
    ], "context_word_analysis", ANALYSIS_SCHEMA, 1_536);
    const result = parseAnalysisOutput(raw, input.sentence, input.targetSpan);
    if (!result) throw new ModelEngineError("MODEL_OUTPUT_INVALID", "Magpie output failed schema validation");
    return { ...result, ...this.identity, promptVersion: PROMPT_VERSION, generatedAt: Date.now() };
  }

  async testConnection(): Promise<void> {
    await this.analyze({ surface: "running", sentence: "She is running home.", contextBefore: "", contextAfter: "", articleTitle: "Morning practice", paragraphBefore: "Practice began at dawn.", paragraphAfter: "She arrived before noon.", targetSpan: { start: 7, end: 14 }, urlMemory: [] });
  }
}
