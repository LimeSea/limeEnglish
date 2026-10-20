import { getVocabularySnapshot } from "../background/db";
import { buildVocabularyLibrary } from "../library/model";
import type { OccurrenceRecord } from "../shared/contracts";

const title = document.querySelector<HTMLElement>("#detail-title")!;
const meta = document.querySelector<HTMLElement>("#detail-meta")!;
const phonetic = document.querySelector<HTMLElement>("#detail-phonetic")!;
const status = document.querySelector<HTMLElement>("#word-status")!;
const contexts = document.querySelector<HTMLElement>("#detail-contexts")!;

const dateFormatter = new Intl.DateTimeFormat("zh-CN", {
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

function appendText(parent: HTMLElement, tag: "span" | "strong" | "p", text: string, className?: string): HTMLElement {
  const element = document.createElement(tag);
  element.textContent = text;
  if (className) element.className = className;
  parent.append(element);
  return element;
}

function createContext(occurrence: OccurrenceRecord): HTMLElement {
  const context = document.createElement("section");
  context.className = "detail-context";

  const source = document.createElement("div");
  source.className = "detail-source";
  const sourceCopy = document.createElement("div");
  appendText(sourceCopy, "strong", occurrence.title || "未命名页面");
  if (occurrence.sourceUrl) {
    const link = document.createElement("a");
    link.href = occurrence.sourceUrl;
    link.target = "_blank";
    link.rel = "noopener noreferrer";
    link.textContent = "查看原文 ↗";
    sourceCopy.append(link);
  }
  const time = document.createElement("time");
  time.dateTime = new Date(occurrence.lastEncounteredAt).toISOString();
  time.textContent = dateFormatter.format(occurrence.lastEncounteredAt);
  if (occurrence.encounterCount > 1) {
    const encounters = document.createElement("span");
    encounters.className = "detail-encounters";
    encounters.textContent = `遇见 ${occurrence.encounterCount} 次`;
    time.append(encounters);
  }
  source.append(sourceCopy, time);

  const sentence = document.createElement("p");
  sentence.className = "detail-sentence";
  const start = Math.max(0, Math.min(occurrence.targetSpan.start, occurrence.sentence.length));
  const end = Math.max(start, Math.min(occurrence.targetSpan.end, occurrence.sentence.length));
  sentence.append(
    document.createTextNode(occurrence.sentence.slice(0, start)),
    Object.assign(document.createElement("mark"), { textContent: occurrence.sentence.slice(start, end) }),
    document.createTextNode(occurrence.sentence.slice(end)),
  );
  context.append(source, sentence);

  if (occurrence.analysis) {
    const analysis = document.createElement("div");
    analysis.className = "detail-analysis";
    const meaning = document.createElement("div");
    meaning.className = "detail-meaning";
    appendText(meaning, "span", "语境义 · MEANING");
    appendText(meaning, "p", occurrence.analysis.contextualMeaningZh);
    analysis.append(meaning);
    if (occurrence.analysis.phrase) {
      const phrase = document.createElement("div");
      phrase.className = "detail-phrase";
      appendText(phrase, "span", "短语 · PHRASE");
      appendText(phrase, "p", `${occurrence.analysis.phrase.text}\n${occurrence.analysis.phrase.meaningZh}`);
      analysis.append(phrase);
    }
    const translation = document.createElement("div");
    translation.className = "detail-translation";
    appendText(translation, "span", "整句翻译 · TRANSLATION");
    appendText(translation, "p", occurrence.analysis.sentenceTranslationZh);
    analysis.append(translation);
    if (occurrence.analysis.grammarAnalysisZh) {
      const grammar = document.createElement("div");
      grammar.className = "detail-grammar";
      appendText(grammar, "span", "语法解析 · GRAMMAR");
      appendText(grammar, "p", occurrence.analysis.grammarAnalysisZh);
      analysis.append(grammar);
    }
    context.append(analysis);
  } else {
    appendText(context, "p", "这条语境暂时没有分析结果。", "detail-pending");
  }
  return context;
}

async function loadWord(): Promise<void> {
  const wordId = new URL(location.href).searchParams.get("id");
  if (!wordId) throw new Error("链接中缺少词汇标识");

  const snapshot = await getVocabularySnapshot();
  const entry = buildVocabularyLibrary(snapshot.words, snapshot.occurrences).entries.find((candidate) => candidate.id === wordId);
  if (!entry) throw new Error("这个词汇不存在或已被删除");

  const wordOccurrences = snapshot.occurrences
    .filter((occurrence) => occurrence.wordId === entry.id)
    .sort((left, right) => right.lastEncounteredAt - left.lastEncounteredAt);
  document.title = `${entry.surface} · limeEnglish`;
  title.textContent = entry.surface;
  meta.textContent = `${wordOccurrences.length} 条语境 · ${entry.sourceCount} 个来源 · 累计遇见 ${entry.encounterCount} 次`;
  if (entry.phonetic) {
    phonetic.textContent = `/${entry.phonetic}/`;
    phonetic.hidden = false;
  }
  contexts.replaceChildren(...wordOccurrences.map(createContext));
  status.hidden = true;
}

void loadWord().catch((error: unknown) => {
  title.textContent = "无法打开词汇";
  meta.textContent = "";
  status.hidden = false;
  status.dataset.tone = "error";
  status.textContent = error instanceof Error ? error.message : "读取词汇失败";
});
