import { clearVocabularyData, deleteVocabularyWords, getVocabularySnapshot } from "../background/db";
import { buildVocabularyLibrary, paginate, type PageSlice, type VocabularyEntry } from "./model";

const wordTotal = document.querySelector<HTMLElement>("#word-total")!;
const encounterTotal = document.querySelector<HTMLElement>("#encounter-total")!;
const sourceTotal = document.querySelector<HTMLElement>("#source-total")!;
const analyzedTotal = document.querySelector<HTMLElement>("#analyzed-total")!;
const resultCount = document.querySelector<HTMLElement>("#result-count")!;
const search = document.querySelector<HTMLInputElement>("#word-search")!;
const sort = document.querySelector<HTMLSelectElement>("#word-sort")!;
const selectAll = document.querySelector<HTMLInputElement>("#select-all")!;
const deleteSelected = document.querySelector<HTMLButtonElement>("#delete-selected")!;
const clearAll = document.querySelector<HTMLButtonElement>("#clear-all")!;
const rows = document.querySelector<HTMLTableSectionElement>("#word-rows")!;
const tableWrap = document.querySelector<HTMLElement>("#table-wrap")!;
const emptyState = document.querySelector<HTMLElement>("#empty-state")!;
const status = document.querySelector<HTMLElement>("#library-status")!;
const paginationNav = document.querySelector<HTMLElement>("#pagination")!;
const previousPage = document.querySelector<HTMLButtonElement>("#previous-page")!;
const nextPage = document.querySelector<HTMLButtonElement>("#next-page")!;
const pageNumbers = document.querySelector<HTMLElement>("#page-numbers")!;
const pageSummary = document.querySelector<HTMLElement>("#page-summary")!;

const PAGE_SIZE = 20;

const selected = new Set<string>();
let entries: VocabularyEntry[] = [];
let currentPage = 1;

const dateFormatter = new Intl.DateTimeFormat("zh-CN", {
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

function showStatus(message: string, tone: "neutral" | "error" = "neutral"): void {
  status.textContent = message;
  status.dataset.tone = tone;
}

function filteredEntries(): VocabularyEntry[] {
  const query = search.value.trim().toLocaleLowerCase("en-US");
  const filtered = query ? entries.filter((entry) => [
    entry.surface,
    entry.lemma,
    entry.phonetic,
    entry.contextualMeaningZh,
    entry.sentence,
    entry.sourceTitle,
  ].some((value) => value?.toLocaleLowerCase("en-US").includes(query))) : [...entries];

  return filtered.sort((left, right) => {
    if (sort.value === "frequent") return right.encounterCount - left.encounterCount || right.lastEncounteredAt - left.lastEncounteredAt;
    if (sort.value === "alphabetical") return left.surface.localeCompare(right.surface, "en", { sensitivity: "base" });
    if (sort.value === "oldest") return left.firstEncounteredAt - right.firstEncounteredAt;
    return right.lastEncounteredAt - left.lastEncounteredAt;
  });
}

function updateSelectionControls(visibleEntries: readonly VocabularyEntry[]): void {
  const selectedVisible = visibleEntries.filter((entry) => selected.has(entry.id)).length;
  selectAll.checked = visibleEntries.length > 0 && selectedVisible === visibleEntries.length;
  selectAll.indeterminate = selectedVisible > 0 && selectedVisible < visibleEntries.length;
  selectAll.disabled = visibleEntries.length === 0;
  deleteSelected.disabled = selected.size === 0;
  deleteSelected.textContent = selected.size > 0 ? `删除所选（${selected.size}）` : "删除所选";
}

function appendText(parent: HTMLElement, tag: "span" | "small" | "strong" | "p", text: string, className?: string): HTMLElement {
  const element = document.createElement(tag);
  element.textContent = text;
  if (className) element.className = className;
  parent.append(element);
  return element;
}

function createRow(entry: VocabularyEntry): HTMLTableRowElement {
  const row = document.createElement("tr");

  const checkCell = row.insertCell();
  checkCell.className = "check-cell";
  checkCell.dataset.label = "选择";
  const checkbox = document.createElement("input");
  checkbox.type = "checkbox";
  checkbox.checked = selected.has(entry.id);
  checkbox.setAttribute("aria-label", `选择 ${entry.surface}`);
  checkbox.addEventListener("change", () => {
    if (checkbox.checked) selected.add(entry.id);
    else selected.delete(entry.id);
    updateSelectionControls(paginate(filteredEntries(), currentPage, PAGE_SIZE).items);
  });
  checkCell.append(checkbox);
  const wordCell = row.insertCell();
  wordCell.dataset.label = "词汇";
  const word = document.createElement("div");
  word.className = "word-cell";
  const wordLink = document.createElement("a");
  wordLink.className = "word-open";
  wordLink.href = `word.html?id=${encodeURIComponent(entry.id)}`;
  wordLink.textContent = entry.surface;
  wordLink.setAttribute("aria-label", `查看 ${entry.surface} 的全部语境`);
  word.append(wordLink);
  if (entry.phonetic) appendText(word, "span", `/${entry.phonetic}/`, "word-phonetic");
  const wordMeta = [entry.lemma && entry.lemma !== entry.surface ? entry.lemma : undefined, entry.partOfSpeech].filter(Boolean).join(" · ");
  if (wordMeta) appendText(word, "small", wordMeta);
  wordCell.append(word);

  const contextCell = row.insertCell();
  contextCell.dataset.label = "语境与释义";
  const context = document.createElement("div");
  context.className = "context-cell";
  appendText(context, "span", entry.contextualMeaningZh ?? "等待语境分析", "meaning");
  if (entry.sentence) appendText(context, "span", entry.sentence, "sentence");
  contextCell.append(context);

  const sourceCell = row.insertCell();
  sourceCell.dataset.label = "原文来源";
  const source = document.createElement("div");
  source.className = "source-cell";
  appendText(source, "span", entry.sourceTitle || "未命名页面");
  if (entry.sourceUrl) {
    const link = document.createElement("a");
    link.href = entry.sourceUrl;
    link.target = "_blank";
    link.rel = "noopener noreferrer";
    link.textContent = "查看原文 ↗";
    source.append(link);
  }
  appendText(source, "small", `${entry.sourceCount} 个来源`);
  sourceCell.append(source);

  const encounterCell = row.insertCell();
  encounterCell.className = "number-cell";
  encounterCell.dataset.label = "遇见次数";
  encounterCell.textContent = String(entry.encounterCount);

  const dateCell = row.insertCell();
  dateCell.className = "date-cell";
  dateCell.dataset.label = "最近记录";
  dateCell.textContent = dateFormatter.format(entry.lastEncounteredAt);

  return row;
}

function visiblePageNumbers(page: number, pageCount: number): number[] {
  const visibleCount = Math.min(5, pageCount);
  const start = Math.max(1, Math.min(page - 2, pageCount - visibleCount + 1));
  return Array.from({ length: visibleCount }, (_, index) => start + index);
}

function changePage(page: number): void {
  currentPage = page;
  render();
  tableWrap.scrollIntoView({ block: "start" });
}

function renderPagination(pageData: PageSlice<VocabularyEntry>): void {
  paginationNav.hidden = pageData.total === 0;
  previousPage.disabled = pageData.page === 1;
  nextPage.disabled = pageData.page === pageData.pageCount;
  pageSummary.textContent = `${pageData.start}–${pageData.end} / ${pageData.total} · 第 ${pageData.page}/${pageData.pageCount} 页`;
  pageNumbers.replaceChildren(...visiblePageNumbers(pageData.page, pageData.pageCount).map((pageNumber) => {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "page-number";
    button.textContent = String(pageNumber);
    button.setAttribute("aria-label", `第 ${pageNumber} 页`);
    if (pageNumber === pageData.page) {
      button.classList.add("active");
      button.setAttribute("aria-current", "page");
      button.disabled = true;
    } else {
      button.addEventListener("click", () => changePage(pageNumber));
    }
    return button;
  }));
}

function render(): void {
  const filtered = filteredEntries();
  const pageData = paginate(filtered, currentPage, PAGE_SIZE);
  currentPage = pageData.page;
  rows.replaceChildren(...pageData.items.map(createRow));
  resultCount.textContent = search.value.trim() ? `${filtered.length} / ${entries.length} 个词汇` : `共 ${entries.length} 个词汇`;
  const hasAnyEntries = entries.length > 0;
  const hasVisibleEntries = filtered.length > 0;
  tableWrap.hidden = !hasVisibleEntries;
  emptyState.hidden = hasAnyEntries || hasVisibleEntries;
  if (hasAnyEntries && !hasVisibleEntries) {
    emptyState.hidden = false;
    emptyState.querySelector("h3")!.textContent = "没有找到这个词";
    emptyState.querySelector("p")!.textContent = "试试更短的关键词。";
  } else if (!hasAnyEntries) {
    emptyState.querySelector("h3")!.textContent = "从第一个词开始";
    emptyState.querySelector("p")!.textContent = "去读一篇英文文章，双击让你停顿的那个词。";
  }
  clearAll.disabled = !hasAnyEntries;
  updateSelectionControls(pageData.items);
  renderPagination(pageData);
}


async function loadLibrary(): Promise<void> {
  showStatus("正在读取本机词汇记录…");
  const snapshot = await getVocabularySnapshot();
  const library = buildVocabularyLibrary(snapshot.words, snapshot.occurrences);
  entries = library.entries;
  wordTotal.textContent = String(library.stats.wordCount);
  encounterTotal.textContent = String(library.stats.encounterCount);
  sourceTotal.textContent = String(library.stats.sourceCount);
  analyzedTotal.textContent = String(library.stats.analyzedCount);
  showStatus("");
  render();
}

search.addEventListener("input", () => {
  currentPage = 1;
  render();
});
sort.addEventListener("change", () => {
  currentPage = 1;
  render();
});
previousPage.addEventListener("click", () => changePage(currentPage - 1));
nextPage.addEventListener("click", () => changePage(currentPage + 1));
selectAll.addEventListener("change", () => {
  const pageEntries = paginate(filteredEntries(), currentPage, PAGE_SIZE).items;
  for (const entry of pageEntries) {
    if (selectAll.checked) selected.add(entry.id);
    else selected.delete(entry.id);
  }
  render();
});

deleteSelected.addEventListener("click", () => {
  if (selected.size === 0) return;
  const count = selected.size;
  if (!confirm(`删除所选的 ${count} 个词汇及其全部语境记录？此操作无法撤销。`)) return;
  deleteSelected.disabled = true;
  showStatus("正在删除所选词汇…");
  void deleteVocabularyWords([...selected])
    .then(() => {
      selected.clear();
      return loadLibrary();
    })
    .catch((error: unknown) => showStatus(error instanceof Error ? error.message : "删除失败", "error"));
});

clearAll.addEventListener("click", () => {
  if (entries.length === 0) return;
  if (!confirm(`清空全部 ${entries.length} 个词汇及其语境记录？此操作无法撤销。`)) return;
  clearAll.disabled = true;
  showStatus("正在清空词汇库…");
  void clearVocabularyData()
    .then(() => {
      selected.clear();
      currentPage = 1;
      return loadLibrary();
    })
    .catch((error: unknown) => showStatus(error instanceof Error ? error.message : "清空失败", "error"));
});


void loadLibrary().catch((error: unknown) => {
  showStatus(error instanceof Error ? error.message : "读取词汇库失败", "error");
  tableWrap.hidden = true;
  emptyState.hidden = false;
});
