import type { OccurrenceRecord, PartOfSpeech, WordRecord } from "../shared/contracts";

export interface VocabularyEntry {
  id: string;
  surface: string;
  lemma: string | undefined;
  encounterCount: number;
  sourceCount: number;
  firstEncounteredAt: number;
  lastEncounteredAt: number;
  sentence: string;
  sourceUrl: string;
  sourceTitle: string;
  contextualMeaningZh: string | undefined;
  partOfSpeech: PartOfSpeech | undefined;
  phonetic: string | undefined;
}

export interface VocabularyStats {
  wordCount: number;
  encounterCount: number;
  sourceCount: number;
  analyzedCount: number;
}

export interface VocabularyLibrary {
  entries: VocabularyEntry[];
  stats: VocabularyStats;
}

export interface PageSlice<T> {
  items: T[];
  page: number;
  pageCount: number;
  total: number;
  start: number;
  end: number;
}

export function paginate<T>(items: readonly T[], requestedPage: number, pageSize: number): PageSlice<T> {
  if (!Number.isInteger(pageSize) || pageSize < 1) throw new RangeError("pageSize must be a positive integer");
  const pageCount = Math.max(1, Math.ceil(items.length / pageSize));
  const page = Math.min(pageCount, Math.max(1, Math.trunc(requestedPage) || 1));
  const offset = (page - 1) * pageSize;
  const end = Math.min(offset + pageSize, items.length);
  return {
    items: items.slice(offset, end),
    page,
    pageCount,
    total: items.length,
    start: items.length === 0 ? 0 : offset + 1,
    end,
  };
}

export function buildVocabularyLibrary(words: readonly WordRecord[], occurrences: readonly OccurrenceRecord[]): VocabularyLibrary {
  const occurrencesByWord = new Map<string, OccurrenceRecord[]>();
  const allSources = new Set<string>();

  for (const occurrence of occurrences) {
    const group = occurrencesByWord.get(occurrence.wordId);
    if (group) group.push(occurrence);
    else occurrencesByWord.set(occurrence.wordId, [occurrence]);
    allSources.add(occurrence.canonicalUrl);
  }

  let analyzedCount = 0;
  const entries = words.map((word): VocabularyEntry => {
    const wordOccurrences = occurrencesByWord.get(word.id) ?? [];
    wordOccurrences.sort((left, right) => right.lastEncounteredAt - left.lastEncounteredAt);
    const representative = wordOccurrences.find((occurrence) => occurrence.analysis) ?? wordOccurrences[0];
    if (representative?.analysis) analyzedCount += 1;

    return {
      id: word.id,
      surface: word.displaySurface,
      lemma: word.lemma,
      encounterCount: word.encounterCount,
      sourceCount: new Set(wordOccurrences.map((occurrence) => occurrence.canonicalUrl)).size,
      firstEncounteredAt: word.firstEncounteredAt,
      lastEncounteredAt: word.lastEncounteredAt,
      sentence: representative?.sentence ?? "",
      sourceUrl: representative?.sourceUrl ?? "",
      sourceTitle: representative?.title ?? "",
      contextualMeaningZh: representative?.analysis?.contextualMeaningZh,
      partOfSpeech: representative?.analysis?.partOfSpeech,
      phonetic: representative?.analysis?.phonetic,
    };
  });

  return {
    entries,
    stats: {
      wordCount: words.length,
      encounterCount: words.reduce((total, word) => total + word.encounterCount, 0),
      sourceCount: allSources.size,
      analyzedCount,
    },
  };
}
