import { isContentMessage, type BackgroundMessage, type SelectionPayload } from "../shared/contracts";
import { attachAnalysis, collectSelection, getUrlAnalysisMemory, updateWordLemma, type CollectedSelection } from "./db";
import { ModelEngineError, PROMPT_VERSION } from "./analysis-protocol";
import { createMagpieSessionAffinity, MagpieProvider } from "./magpie-provider";
import { analysisMatchesProvider, type AnalysisProvider, type UrlMemoryEntry } from "./provider";
import { loadProviderSettings } from "./settings";

interface RequestState {
  payload: SelectionPayload;
  occurrenceId: string;
  wordId: string;
  provider: AnalysisProvider;
  cachedAnalysis?: CollectedSelection["occurrence"]["analysis"];
  urlMemory: UrlMemoryEntry[];
}
function safePost(port: chrome.runtime.Port, message: BackgroundMessage): void {
  try { port.postMessage(message); } catch { /* The page may have closed; persistence still completes. */ }
}

function reusableAnalysis(state: RequestState): CollectedSelection["occurrence"]["analysis"] {
  return analysisMatchesProvider(state.cachedAnalysis, state.provider.identity, PROMPT_VERSION)
    ? state.cachedAnalysis
    : undefined;
}

async function runAnalysis(port: chrome.runtime.Port, requestId: string, state: RequestState): Promise<void> {
  const cached = reusableAnalysis(state);
  if (cached) {
    safePost(port, { type: "analysis:ready", requestId, result: cached });
    return;
  }
  safePost(port, { type: "analysis:started", requestId, providerId: state.provider.identity.providerId, modelId: state.provider.identity.modelId });
  try {
    const analysis = await state.provider.analyze({
      surface: state.payload.surface,
      sentence: state.payload.sentence,
      contextBefore: state.payload.contextBefore,
      contextAfter: state.payload.contextAfter,
      articleTitle: state.payload.title,
      paragraphBefore: state.payload.paragraphBefore,
      paragraphAfter: state.payload.paragraphAfter,
      targetSpan: state.payload.targetSpan,
      urlMemory: state.urlMemory,
    });
    await updateWordLemma(state.wordId, analysis.lemma);
    safePost(port, { type: "analysis:ready", requestId, result: analysis });
    try {
      await attachAnalysis(state.occurrenceId, analysis);
    } catch {
      safePost(port, { type: "lookup:error", requestId, area: "request", code: "ANALYSIS_SAVE_FAILED" });
    }
  } catch (error) {
    const code = error instanceof ModelEngineError ? error.code : "GATEWAY_REQUEST_FAILED";
    safePost(port, { type: "lookup:error", requestId, area: "model", code });
  }
}

function validSender(port: chrome.runtime.Port): boolean {
  if (!port.sender?.tab || typeof port.sender.url !== "string") return false;
  try { return /^https?:$/.test(new URL(port.sender.url).protocol); }
  catch { return false; }
}

chrome.runtime.onConnect.addListener((port) => {
  if (port.name !== "word-card" || !validSender(port)) {
    port.disconnect();
    return;
  }
  port.onMessage.addListener((raw: unknown) => {
    if (!isContentMessage(raw)) {
      safePost(port, { type: "lookup:error", requestId: "invalid", area: "request", code: "INVALID_REQUEST" });
      return;
    }

    const { requestId, payload } = raw;
    if (payload.sourceUrl !== port.sender?.url) {
      safePost(port, { type: "lookup:error", requestId, area: "request", code: "INVALID_REQUEST" });
      return;
    }
    void collectSelection(payload).then(async ({ word, occurrence }) => {
      safePost(port, { type: "lookup:collected", requestId, word, occurrence });
      const settings = await loadProviderSettings();
      const provider = new MagpieProvider(settings.baseUrl, settings.model, createMagpieSessionAffinity(occurrence.id));
      const urlMemory = await getUrlAnalysisMemory(payload.canonicalUrl, occurrence.id, provider.identity, PROMPT_VERSION);
      const state: RequestState = {
        payload,
        occurrenceId: occurrence.id,
        wordId: word.id,
        provider,
        urlMemory,
      };
      if (occurrence.analysis) state.cachedAnalysis = occurrence.analysis;
      void runAnalysis(port, requestId, state);
    }).catch(() => {
      safePost(port, { type: "lookup:error", requestId, area: "request", code: "COLLECTION_FAILED" });
    });
  });
});
