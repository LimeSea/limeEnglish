import "fake-indexeddb/auto";
import { beforeEach, describe, expect, it } from "vitest";
import { attachAnalysis, clearVocabularyData, collectSelection, deleteVocabularyWords, getUrlAnalysisMemory, openContextWordDB } from "../src/background/db";
import type { SelectionPayload } from "../src/shared/contracts";

function payload(url: string, capturedAt: number): SelectionPayload {
  return {
    surface: "bank",
    normalizedSurface: "bank",
    sentence: "She sat on the bank and watched the river flow.",
    contextBefore: "Earlier sentence.",
    contextAfter: "Final sentence.",
    paragraphBefore: "They walked beside the river.",
    paragraphAfter: "A boat passed nearby.",
    targetSpan: { start: 15, end: 19 },
    sourceUrl: `${url}#section`,
    canonicalUrl: url,
    title: "Fixture",
    capturedAt,
    anchorRect: { top: 1, right: 2, bottom: 3, left: 1, width: 1, height: 2 },
  };
}

beforeEach(async () => {
  const database = await openContextWordDB();
  await Promise.all([database.clear("words"), database.clear("occurrences")]);
});
describe("selection persistence", () => {
  it("increments one occurrence for the same source and separates a different URL", async () => {
    const first = await collectSelection(payload("https://example.test/article?q=1", 100));
    const second = await collectSelection(payload("https://example.test/article?q=1", 200));
    const third = await collectSelection(payload("https://example.test/article?q=2", 300));

    expect(first.occurrence.encounterCount).toBe(1);
    expect(second.word.encounterCount).toBe(2);
    expect(second.occurrence.id).toBe(first.occurrence.id);
    expect(second.occurrence.encounterCount).toBe(2);
    expect(third.word.encounterCount).toBe(3);
    expect(third.occurrence.id).not.toBe(first.occurrence.id);
    expect(third.occurrence.encounterCount).toBe(1);

    await attachAnalysis(first.occurrence.id, {
      lemma: "bank",
      partOfSpeech: "noun",
      phonetic: "bæŋk",
      contextualMeaningZh: "河岸",
      phrase: null,
      sentenceTranslationZh: "她坐在河岸上，看着河水流淌。",
      grammarAnalysisZh: "bank 作介词 on 的宾语，构成地点状语。",
      providerId: "magpie",
      modelId: "group/auto-glm",
      modelRevision: "http://127.0.0.1:3425/v1",
      promptVersion: "word-context-zh-v5",
      generatedAt: 350,
    });
    const repeated = await collectSelection(payload("https://example.test/article?q=1", 400));
    expect(repeated.occurrence.id).toBe(first.occurrence.id);
    expect(repeated.occurrence.encounterCount).toBe(3);
    expect(repeated.occurrence.analysis?.contextualMeaningZh).toBe("河岸");
    const nearby = await collectSelection({ ...payload("https://example.test/article?q=1", 450), paragraphAfter: "The path continued downstream." });
    await expect(getUrlAnalysisMemory(nearby.occurrence.canonicalUrl, nearby.occurrence.id, { providerId: "magpie", modelId: "group/auto-glm", modelRevision: "http://127.0.0.1:3425/v1" }, "word-context-zh-v5")).resolves.toEqual([
      { lemma: "bank", partOfSpeech: "noun", contextualMeaningZh: "河岸" },
    ]);

    const database = await openContextWordDB();
    expect(await database.count("words")).toBe(1);
    expect(await database.count("occurrences")).toBe(3);
  });

  it("deletes selected words with their occurrences and can clear the whole library", async () => {
    await collectSelection(payload("https://example.test/one", 100));
    await collectSelection({
      ...payload("https://example.test/two", 200),
      surface: "river",
      normalizedSurface: "river",
      sentence: "The river moved slowly.",
      targetSpan: { start: 4, end: 9 },
    });
    const database = await openContextWordDB();

    await deleteVocabularyWords(["bank"]);
    expect(await database.get("words", "bank")).toBeUndefined();
    expect(await database.countFromIndex("occurrences", "wordId", "bank")).toBe(0);
    expect(await database.get("words", "river")).toBeDefined();

    await clearVocabularyData();
    expect(await database.count("words")).toBe(0);
    expect(await database.count("occurrences")).toBe(0);
  });
});
