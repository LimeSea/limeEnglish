import { describe, expect, it } from "vitest";
import { buildVocabularyLibrary, paginate } from "../src/library/model";
import type { OccurrenceRecord, WordRecord } from "../src/shared/contracts";

const words: WordRecord[] = [
  { id: "bank", displaySurface: "Bank", lemma: "bank", encounterCount: 3, firstEncounteredAt: 100, lastEncounteredAt: 400 },
  { id: "river", displaySurface: "river", encounterCount: 1, firstEncounteredAt: 300, lastEncounteredAt: 300 },
];

const occurrences: OccurrenceRecord[] = [
  {
    id: "bank-old",
    wordId: "bank",
    sentence: "She sat on the bank.",
    contextBefore: "",
    contextAfter: "",
    paragraphBefore: "",
    paragraphAfter: "",
    targetSpan: { start: 15, end: 19 },
    sourceUrl: "https://example.test/river#bank",
    canonicalUrl: "https://example.test/river",
    title: "A river walk",
    encounterCount: 2,
    firstEncounteredAt: 100,
    lastEncounteredAt: 200,
    analysis: {
      lemma: "bank",
      partOfSpeech: "noun",
      phonetic: "bæŋk",
      contextualMeaningZh: "河岸",
      phrase: null,
      sentenceTranslationZh: "她坐在河岸上。",
      grammarAnalysisZh: "bank 作介词 on 的宾语，构成地点状语。",
      providerId: "magpie",
      modelId: "model",
      modelRevision: "gateway",
      promptVersion: "test",
      generatedAt: 200,
    },
  },
  {
    id: "bank-new",
    wordId: "bank",
    sentence: "The bank approved the loan.",
    contextBefore: "",
    contextAfter: "",
    paragraphBefore: "",
    paragraphAfter: "",
    targetSpan: { start: 4, end: 8 },
    sourceUrl: "https://example.test/finance",
    canonicalUrl: "https://example.test/finance",
    title: "Finance",
    encounterCount: 1,
    firstEncounteredAt: 400,
    lastEncounteredAt: 400,
  },
  {
    id: "river",
    wordId: "river",
    sentence: "The river moved slowly.",
    contextBefore: "",
    contextAfter: "",
    paragraphBefore: "",
    paragraphAfter: "",
    targetSpan: { start: 4, end: 9 },
    sourceUrl: "https://example.test/river",
    canonicalUrl: "https://example.test/river",
    title: "A river walk",
    encounterCount: 1,
    firstEncounteredAt: 300,
    lastEncounteredAt: 300,
  },
];

describe("vocabulary library model", () => {
  it("aggregates counts and keeps source context aligned with an available analysis", () => {
    const library = buildVocabularyLibrary(words, occurrences);

    expect(library.stats).toEqual({ wordCount: 2, encounterCount: 4, sourceCount: 2, analyzedCount: 1 });
    expect(library.entries.find((entry) => entry.id === "bank")).toEqual(expect.objectContaining({
      surface: "Bank",
      encounterCount: 3,
      sourceCount: 2,
      sentence: "She sat on the bank.",
      sourceUrl: "https://example.test/river#bank",
      contextualMeaningZh: "河岸",
      partOfSpeech: "noun",
      phonetic: "bæŋk",
      lastEncounteredAt: 400,
    }));
  });

  it("slices full pages and clamps a stale page after deletion", () => {
    const items = Array.from({ length: 45 }, (_, index) => index + 1);

    expect(paginate(items, 2, 20)).toEqual({
      items: items.slice(20, 40),
      page: 2,
      pageCount: 3,
      total: 45,
      start: 21,
      end: 40,
    });
    expect(paginate(items, 99, 20)).toEqual(expect.objectContaining({
      items: items.slice(40),
      page: 3,
      start: 41,
      end: 45,
    }));
    expect(paginate(items.slice(0, 20), 2, 20)).toEqual(expect.objectContaining({
      page: 1,
      pageCount: 1,
      start: 1,
      end: 20,
    }));
  });
});
