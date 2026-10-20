export const PARTS_OF_SPEECH = [
  "noun", "verb", "adjective", "adverb", "pronoun", "preposition",
  "conjunction", "interjection", "determiner", "other", "unknown",
] as const;
export type PartOfSpeech = (typeof PARTS_OF_SPEECH)[number];

export interface SerializableRect {
  top: number;
  right: number;
  bottom: number;
  left: number;
  width: number;
  height: number;
}

export interface TextSpan { start: number; end: number }

export interface SelectionPayload {
  surface: string;
  normalizedSurface: string;
  sentence: string;
  contextBefore: string;
  contextAfter: string;
  paragraphBefore: string;
  paragraphAfter: string;
  targetSpan: TextSpan;
  sourceUrl: string;
  canonicalUrl: string;
  title: string;
  capturedAt: number;
  anchorRect: SerializableRect;
}

export const PHRASE_TYPES = ["phrasal_verb", "idiom", "collocation", "compound", "other"] as const;
export type PhraseType = (typeof PHRASE_TYPES)[number];

export interface PhraseAnalysis {
  text: string;
  type: PhraseType;
  meaningZh: string;
  span: TextSpan;
}

export interface AnalysisResult {
  lemma: string;
  partOfSpeech: PartOfSpeech;
  phonetic: string;
  contextualMeaningZh: string;
  phrase: PhraseAnalysis | null;
  sentenceTranslationZh: string;
  grammarAnalysisZh: string;
}

export type ProviderKind = "magpie";

export interface ProviderSettings {
  kind: "magpie";
  baseUrl: string;
  model: string;
}

export interface ProviderIdentity {
  providerId: ProviderKind;
  modelId: string;
  modelRevision: string;
}

export interface StoredAnalysis extends AnalysisResult, ProviderIdentity {
  promptVersion: string;
  generatedAt: number;
}

export interface WordRecord {
  id: string;
  displaySurface: string;
  lemma?: string;
  encounterCount: number;
  firstEncounteredAt: number;
  lastEncounteredAt: number;
}

export interface OccurrenceRecord {
  id: string;
  wordId: string;
  sentence: string;
  contextBefore: string;
  contextAfter: string;
  targetSpan: TextSpan;
  paragraphBefore: string;
  paragraphAfter: string;
  sourceUrl: string;
  canonicalUrl: string;
  title: string;
  encounterCount: number;
  firstEncounteredAt: number;
  lastEncounteredAt: number;
  analysis?: StoredAnalysis;
}

export type ModelErrorCode =
  | "MODEL_OUTPUT_INVALID"
  | "GATEWAY_UNAVAILABLE"
  | "GATEWAY_RATE_LIMITED"
  | "GATEWAY_REQUEST_FAILED";

export type ContentMessage = { type: "lookup:start"; requestId: string; payload: SelectionPayload };

export type BackgroundMessage =
  | { type: "lookup:collected"; requestId: string; word: WordRecord; occurrence: OccurrenceRecord }
  | { type: "analysis:started"; requestId: string; providerId: ProviderKind; modelId: string }
  | { type: "analysis:ready"; requestId: string; result: StoredAnalysis }
  | { type: "lookup:error"; requestId: string; area: "model" | "request"; code: string };

const object = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);
const finite = (value: unknown): value is number => typeof value === "number" && Number.isFinite(value);
const exactKeys = (value: Record<string, unknown>, keys: readonly string[]): boolean =>
  Object.keys(value).every((key) => keys.includes(key)) && keys.every((key) => key in value);

export function normalizeWord(surface: string): string {
  return surface.normalize("NFKC").toLocaleLowerCase("en-US").replaceAll("’", "'");
}

export function isProviderSettings(value: unknown): value is ProviderSettings {
  if (!object(value) || !exactKeys(value, ["kind", "baseUrl", "model"]) || value.kind !== "magpie") return false;
  if (typeof value.baseUrl !== "string" || typeof value.model !== "string" || !value.model.trim() || value.model.length > 200) return false;
  try {
    const url = new URL(value.baseUrl);
    const localHttp = url.protocol === "http:" && ["127.0.0.1", "localhost", "::1"].includes(url.hostname);
    return url.protocol === "https:" || localHttp;
  } catch { return false; }
}

export function isSelectionPayload(value: unknown): value is SelectionPayload {
  if (!object(value) || !exactKeys(value, ["surface", "normalizedSurface", "sentence", "contextBefore", "contextAfter", "paragraphBefore", "paragraphAfter", "targetSpan", "sourceUrl", "canonicalUrl", "title", "capturedAt", "anchorRect"])) return false;
  if (typeof value.surface !== "string" || typeof value.normalizedSurface !== "string" || typeof value.sentence !== "string" || value.sentence.length > 4_000) return false;
  if (typeof value.contextBefore !== "string" || typeof value.contextAfter !== "string" || value.contextBefore.length > 2_000 || value.contextAfter.length > 2_000) return false;
  if (typeof value.paragraphBefore !== "string" || typeof value.paragraphAfter !== "string" || value.paragraphBefore.length > 2_000 || value.paragraphAfter.length > 2_000 || typeof value.title !== "string" || value.title.length > 300) return false;
  if (normalizeWord(value.surface) !== value.normalizedSurface || !/^\p{Script=Latin}+(?:[’'-]\p{Script=Latin}+)*$/u.test(value.surface)) return false;
  if (!object(value.targetSpan) || !exactKeys(value.targetSpan, ["start", "end"]) || !Number.isInteger(value.targetSpan.start) || !Number.isInteger(value.targetSpan.end)) return false;
  const { start, end } = value.targetSpan as unknown as TextSpan;
  if (start < 0 || end <= start || end > value.sentence.length || value.sentence.slice(start, end) !== value.surface) return false;
  if (typeof value.sourceUrl !== "string" || typeof value.canonicalUrl !== "string" || typeof value.title !== "string" || !finite(value.capturedAt)) return false;
  try {
    const source = new URL(value.sourceUrl);
    const canonical = new URL(value.canonicalUrl);
    source.hash = "";
    if (!/^https?:$/.test(source.protocol) || source.href !== canonical.href) return false;
  } catch { return false; }
  if (!object(value.anchorRect) || !exactKeys(value.anchorRect, ["top", "right", "bottom", "left", "width", "height"]) || !Object.values(value.anchorRect).every(finite)) return false;
  return true;
}

export function isContentMessage(value: unknown): value is ContentMessage {
  return object(value)
    && value.type === "lookup:start"
    && typeof value.requestId === "string"
    && value.requestId.length >= 1
    && value.requestId.length <= 128
    && exactKeys(value, ["type", "requestId", "payload"])
    && isSelectionPayload(value.payload);
}

export function isBackgroundMessage(value: unknown): value is BackgroundMessage {
  if (!object(value) || typeof value.type !== "string" || typeof value.requestId !== "string") return false;
  return ["lookup:collected", "analysis:started", "analysis:ready", "lookup:error"].includes(value.type);
}
