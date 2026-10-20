import type {
  ProviderIdentity,
  StoredAnalysis,
  TextSpan,
} from "../shared/contracts";

export interface UrlMemoryEntry {
  lemma: string;
  partOfSpeech: StoredAnalysis["partOfSpeech"];
  contextualMeaningZh: string;
}

export interface LemmaInput {
  surface: string;
  sentence: string;
  contextBefore: string;
  contextAfter: string;
  articleTitle: string;
  paragraphBefore: string;
  paragraphAfter: string;
  targetSpan: TextSpan;
}

export interface AnalysisInput extends LemmaInput {
  urlMemory: UrlMemoryEntry[];
}

export interface AnalysisProvider {
  readonly identity: ProviderIdentity;
  analyze(input: AnalysisInput): Promise<StoredAnalysis>;
}

export function analysisMatchesProvider(analysis: StoredAnalysis | undefined, identity: ProviderIdentity, promptVersion: string): analysis is StoredAnalysis {
  return analysis?.providerId === identity.providerId
    && analysis.modelId === identity.modelId
    && analysis.modelRevision === identity.modelRevision
    && analysis.promptVersion === promptVersion;
}
