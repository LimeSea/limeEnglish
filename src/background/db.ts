import { openDB, type DBSchema, type IDBPDatabase } from "idb";
import {
  normalizeWord,
  type OccurrenceRecord,
  type SelectionPayload,
  type StoredAnalysis,
  type PartOfSpeech,
  type ProviderIdentity,
  type WordRecord,
} from "../shared/contracts";


interface ContextWordDB extends DBSchema {
  words: { key: string; value: WordRecord };
  occurrences: {
    key: string;
    value: OccurrenceRecord;
    indexes: { wordId: string; canonicalUrl: string };
  };
}

export interface CollectedSelection {
  word: WordRecord;
  occurrence: OccurrenceRecord;
}

export interface VocabularySnapshot {
  words: WordRecord[];
  occurrences: OccurrenceRecord[];
}

let databasePromise: Promise<IDBPDatabase<ContextWordDB>> | undefined;

export function openContextWordDB(): Promise<IDBPDatabase<ContextWordDB>> {
  databasePromise ??= openDB<ContextWordDB>("context-word-helper", 3, {
    upgrade(database, oldVersion, _newVersion, transaction) {
      if (oldVersion < 1) {
        database.createObjectStore("words", { keyPath: "id" });
        const occurrences = database.createObjectStore("occurrences", { keyPath: "id" });
        occurrences.createIndex("wordId", "wordId", { unique: false });
      }
      if (oldVersion < 2) transaction.objectStore("occurrences").createIndex("canonicalUrl", "canonicalUrl", { unique: false });
      if (oldVersion < 3 && database.objectStoreNames.contains("dictionary" as never)) database.deleteObjectStore("dictionary" as never);
    },
  });
  return databasePromise;
}

export async function getVocabularySnapshot(): Promise<VocabularySnapshot> {
  const database = await openContextWordDB();
  const transaction = database.transaction(["words", "occurrences"], "readonly");
  const [words, occurrences] = await Promise.all([
    transaction.objectStore("words").getAll(),
    transaction.objectStore("occurrences").getAll(),
  ]);
  await transaction.done;
  return { words, occurrences };
}

export async function deleteVocabularyWords(wordIds: readonly string[]): Promise<void> {
  const ids = [...new Set(wordIds)];
  if (ids.length === 0) return;
  const database = await openContextWordDB();
  const transaction = database.transaction(["words", "occurrences"], "readwrite");
  const words = transaction.objectStore("words");
  const occurrences = transaction.objectStore("occurrences");
  const occurrenceKeys = await Promise.all(ids.map((wordId) => occurrences.index("wordId").getAllKeys(wordId)));
  await Promise.all([
    ...ids.map((wordId) => words.delete(wordId)),
    ...occurrenceKeys.flat().map((key) => occurrences.delete(key)),
  ]);
  await transaction.done;
}

export async function clearVocabularyData(): Promise<void> {
  const database = await openContextWordDB();
  const transaction = database.transaction(["words", "occurrences"], "readwrite");
  await Promise.all([
    transaction.objectStore("words").clear(),
    transaction.objectStore("occurrences").clear(),
  ]);
  await transaction.done;
}

export function resetDatabaseConnectionForTests(): void {
  databasePromise = undefined;
}

async function occurrenceId(payload: SelectionPayload, wordId: string): Promise<string> {
  const source = `${wordId}\0${payload.canonicalUrl}\0${payload.title}\0${payload.paragraphBefore}\0${payload.contextBefore}\0${payload.sentence}\0${payload.contextAfter}\0${payload.paragraphAfter}\0${payload.targetSpan.start}:${payload.targetSpan.end}`;
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(source));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

export async function collectSelection(payload: SelectionPayload): Promise<CollectedSelection> {
  const wordId = normalizeWord(payload.surface);
  const id = await occurrenceId(payload, wordId);
  const database = await openContextWordDB();
  const transaction = database.transaction(["words", "occurrences"], "readwrite");
  const words = transaction.objectStore("words");
  const occurrences = transaction.objectStore("occurrences");
  const existingWord = await words.get(wordId);
  const existingOccurrence = await occurrences.get(id);
  const word: WordRecord = existingWord ? {
    ...existingWord,
    displaySurface: payload.surface,
    encounterCount: existingWord.encounterCount + 1,
    lastEncounteredAt: payload.capturedAt,
  } : {
    id: wordId,
    displaySurface: payload.surface,
    encounterCount: 1,
    firstEncounteredAt: payload.capturedAt,
    lastEncounteredAt: payload.capturedAt,
  };
  const occurrence: OccurrenceRecord = existingOccurrence ? {
    ...existingOccurrence,
    sourceUrl: payload.sourceUrl,
    title: payload.title,
    encounterCount: existingOccurrence.encounterCount + 1,
    lastEncounteredAt: payload.capturedAt,
  } : {
    id,
    wordId,
    sentence: payload.sentence,
    contextBefore: payload.contextBefore,
    contextAfter: payload.contextAfter,
    paragraphBefore: payload.paragraphBefore,
    paragraphAfter: payload.paragraphAfter,
    targetSpan: payload.targetSpan,
    sourceUrl: payload.sourceUrl,
    canonicalUrl: payload.canonicalUrl,
    title: payload.title,
    encounterCount: 1,
    firstEncounteredAt: payload.capturedAt,
    lastEncounteredAt: payload.capturedAt,
  };
  await Promise.all([words.put(word), occurrences.put(occurrence)]);
  await transaction.done;
  return { word, occurrence };
}

export async function getUrlAnalysisMemory(canonicalUrl: string, currentOccurrenceId: string, identity: ProviderIdentity, promptVersion: string, limit = 5): Promise<Array<{ lemma: string; partOfSpeech: PartOfSpeech; contextualMeaningZh: string }>> {
  const occurrences = await (await openContextWordDB()).getAllFromIndex("occurrences", "canonicalUrl", canonicalUrl);
  return occurrences
    .filter((occurrence) => occurrence.id !== currentOccurrenceId && occurrence.analysis?.providerId === identity.providerId && occurrence.analysis.modelId === identity.modelId && occurrence.analysis.modelRevision === identity.modelRevision && occurrence.analysis.promptVersion === promptVersion)
    .sort((left, right) => right.lastEncounteredAt - left.lastEncounteredAt)
    .slice(0, limit)
    .map((occurrence) => ({
      lemma: occurrence.analysis!.lemma,
      partOfSpeech: occurrence.analysis!.partOfSpeech,
      contextualMeaningZh: occurrence.analysis!.contextualMeaningZh,
    }));
}

export async function attachAnalysis(occurrenceIdValue: string, analysis: StoredAnalysis): Promise<void> {
  const database = await openContextWordDB();
  const transaction = database.transaction("occurrences", "readwrite");
  const occurrence = await transaction.store.get(occurrenceIdValue);
  if (!occurrence) throw new Error("Occurrence not found");
  await transaction.store.put({ ...occurrence, analysis });
  await transaction.done;
}

export async function updateWordLemma(wordId: string, lemma: string): Promise<void> {
  const database = await openContextWordDB();
  const transaction = database.transaction("words", "readwrite");
  const word = await transaction.store.get(wordId);
  if (word) await transaction.store.put({ ...word, lemma });
  await transaction.done;
}
