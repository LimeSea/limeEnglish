import { normalizeWord, type SelectionPayload, type SerializableRect } from "../shared/contracts";

const WORD = /^\p{Script=Latin}+(?:[’'-]\p{Script=Latin}+)*$/u;
const FORBIDDEN = "input, textarea, select, button, [contenteditable]:not([contenteditable='false']), code, pre";
const BLOCK_DISPLAY: Record<string, true> = { block: true, flex: true, grid: true, "list-item": true, table: true, "table-row": true, "table-cell": true };
const PARAGRAPH = "p, li, blockquote, dd, dt";
const normalizeText = (value: string): string => value.replace(/\s+/gu, " ").trim();

type SelectionRejectionReporter = (reason: string) => void;
const ignoreSelectionRejection: SelectionRejectionReporter = () => {};

function rejectSelection(report: SelectionRejectionReporter, reason: string): undefined {
  report(reason);
  return undefined;
}

interface TextPiece { node: Text; start: number; end: number }

function isVisibleText(node: Text): boolean {
  const parent = node.parentElement;
  if (!parent || parent.closest(FORBIDDEN)) return false;
  const style = getComputedStyle(parent);
  return style.display !== "none" && style.visibility !== "hidden" && style.visibility !== "collapse" && Number(style.opacity) !== 0;
}

function nearestBlock(element: Element): Element {
  let current: Element | null = element;
  while (current && current !== document.documentElement) {
    if (BLOCK_DISPLAY[getComputedStyle(current).display]) return current;
    current = current.parentElement;
  }
  return document.body;
}

function collectText(block: Element): { text: string; pieces: TextPiece[] } {
  const walker = document.createTreeWalker(block, NodeFilter.SHOW_TEXT, {
    acceptNode: (node) => isVisibleText(node as Text) ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_REJECT,
  });
  const pieces: TextPiece[] = [];
  let text = "";
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    const value = node.nodeValue ?? "";
    pieces.push({ node: node as Text, start: text.length, end: text.length + value.length });
    text += value;
  }
  return { text, pieces };
}

function boundedParagraph(element: Element | undefined, edge: "start" | "end"): string {
  if (!element) return "";
  const text = normalizeText(collectText(element).text);
  return edge === "start" ? text.slice(0, 2_000) : text.slice(-2_000);
}

export function articleTitle(): string {
  const heading = document.querySelector("article h1, main h1, h1");
  return normalizeText(heading?.textContent ?? document.title).slice(0, 300);
}

export function adjacentParagraphs(element: Element, fallbackBlock: Element): { paragraphBefore: string; paragraphAfter: string } {
  const target = element.closest(PARAGRAPH) ?? fallbackBlock;
  const root = target.closest("article, main") ?? document.body;
  const paragraphs = [...root.querySelectorAll(PARAGRAPH)].filter((candidate) => normalizeText(collectText(candidate).text).length > 0);
  const index = paragraphs.findIndex((candidate) => candidate === target || candidate.contains(element));
  if (index < 0) return { paragraphBefore: "", paragraphAfter: "" };
  return {
    paragraphBefore: boundedParagraph(paragraphs[index - 1], "end"),
    paragraphAfter: boundedParagraph(paragraphs[index + 1], "start"),
  };
}

function documentOffset(pieces: TextPiece[], node: Node, offset: number): number | undefined {
  if (node.nodeType === Node.TEXT_NODE) {
    const piece = pieces.find((candidate) => candidate.node === node);
    return piece && offset >= 0 && offset <= piece.node.data.length ? piece.start + offset : undefined;
  }
  if (node.nodeType !== Node.ELEMENT_NODE) return undefined;
  const element = node as Element;
  const child = element.childNodes[offset];
  const first = pieces.find((piece) => child ? child === piece.node || (child instanceof Element && child.contains(piece.node)) : false);
  if (first) return first.start;
  if (offset === element.childNodes.length) {
    const contained = pieces.filter((piece) => element.contains(piece.node));
    return contained.at(-1)?.end;
  }
  return undefined;
}


export function sentenceCovering(text: string, targetStart: number, targetEnd: number): { start: number; end: number } | undefined {
  const raw = [...new Intl.Segmenter("en", { granularity: "sentence" }).segment(text)];
  const merged: Array<{ index: number; segment: string }> = [];
  for (const current of raw) {
    const previous = merged.at(-1);
    if (previous && /(?:\b(?:Mr|Mrs|Ms|Dr|Prof|Sr|Jr|St|vs|etc)|\b[A-Z])\.\s*$/u.test(previous.segment)) {
      previous.segment += current.segment;
    } else {
      merged.push({ index: current.index, segment: current.segment });
    }
  }
  const matches = merged.filter(({ index, segment }) => index <= targetStart && targetEnd <= index + segment.length);
  if (matches.length !== 1) return undefined;
  const match = matches[0]!;
  const leading = match.segment.length - match.segment.trimStart().length;
  const trailing = match.segment.length - match.segment.trimEnd().length;
  return { start: match.index + leading, end: match.index + match.segment.length - trailing };
}

export function surroundingContext(text: string, sentenceStart: number, sentenceEnd: number): { contextBefore: string; contextAfter: string } {
  return {
    contextBefore: text.slice(Math.max(0, sentenceStart - 2_000), sentenceStart).trim(),
    contextAfter: text.slice(sentenceEnd, Math.min(text.length, sentenceEnd + 2_000)).trim(),
  };
}
export function captureSelection(
  event: MouseEvent,
  reportRejection: SelectionRejectionReporter = ignoreSelectionRejection,
): SelectionPayload | undefined {
  if (!event.isTrusted) return rejectSelection(reportRejection, "untrusted-event");
  if (event.button !== 0) return rejectSelection(reportRejection, "non-primary-button");
  const selection = document.getSelection();
  if (!selection) return rejectSelection(reportRejection, "selection-unavailable");
  if (selection.rangeCount !== 1) return rejectSelection(reportRejection, "unexpected-range-count");
  if (selection.isCollapsed) return rejectSelection(reportRejection, "selection-collapsed");
  const range = selection.getRangeAt(0);
  const ancestor = range.commonAncestorContainer.nodeType === Node.ELEMENT_NODE
    ? range.commonAncestorContainer as Element
    : range.commonAncestorContainer.parentElement;
  if (!ancestor) return rejectSelection(reportRejection, "ancestor-missing");
  if (ancestor.closest(FORBIDDEN)) return rejectSelection(reportRejection, "forbidden-surface");
  const rawSurface = range.toString();
  const surface = rawSurface.trim();
  if (!WORD.test(surface)) return rejectSelection(reportRejection, "not-single-latin-word");
  const leadingWhitespace = rawSurface.length - rawSurface.trimStart().length;
  const trailingWhitespace = rawSurface.length - rawSurface.trimEnd().length;

  const startElement = range.startContainer.nodeType === Node.ELEMENT_NODE ? range.startContainer as Element : range.startContainer.parentElement;
  const endElement = range.endContainer.nodeType === Node.ELEMENT_NODE ? range.endContainer as Element : range.endContainer.parentElement;
  if (!startElement || !endElement) return rejectSelection(reportRejection, "range-element-missing");
  const block = nearestBlock(startElement);
  if (nearestBlock(endElement) !== block) return rejectSelection(reportRejection, "cross-block-selection");

  const { text, pieces } = collectText(block);
  const rawSelectionStart = documentOffset(pieces, range.startContainer, range.startOffset);
  const rawSelectionEnd = documentOffset(pieces, range.endContainer, range.endOffset);
  if (rawSelectionStart === undefined || rawSelectionEnd === undefined) return rejectSelection(reportRejection, "selection-offset-unmapped");
  if (text.slice(rawSelectionStart, rawSelectionEnd) !== rawSurface) return rejectSelection(reportRejection, "selection-text-mismatch");
  const selectionStart = rawSelectionStart + leadingWhitespace;
  const selectionEnd = rawSelectionEnd - trailingWhitespace;
  if (text.slice(selectionStart, selectionEnd) !== surface) return rejectSelection(reportRejection, "trimmed-selection-mismatch");

  const sentenceBounds = sentenceCovering(text, selectionStart, selectionEnd);
  if (!sentenceBounds) return rejectSelection(reportRejection, "sentence-not-found");
  const sentence = text.slice(sentenceBounds.start, sentenceBounds.end);
  const targetSpan = { start: selectionStart - sentenceBounds.start, end: selectionEnd - sentenceBounds.start };
  const { contextBefore, contextAfter } = surroundingContext(text, sentenceBounds.start, sentenceBounds.end);
  const { paragraphBefore, paragraphAfter } = adjacentParagraphs(startElement, block);
  if (sentence.length > 4_000) return rejectSelection(reportRejection, "sentence-too-long");
  if (sentence.slice(targetSpan.start, targetSpan.end) !== surface) return rejectSelection(reportRejection, "target-span-mismatch");

  const rect = range.getBoundingClientRect();
  const anchorRect: SerializableRect = {
    top: rect.top, right: rect.right, bottom: rect.bottom, left: rect.left,
    width: rect.width, height: rect.height,
  };
  const source = new URL(location.href);
  const sourceUrl = source.href;
  source.hash = "";
  return {
    surface,
    normalizedSurface: normalizeWord(surface),
    sentence,
    contextBefore,
    contextAfter,
    paragraphBefore,
    paragraphAfter,
    targetSpan,
    sourceUrl,
    canonicalUrl: source.href,
    title: articleTitle(),
    capturedAt: Date.now(),
    anchorRect,
  };
}
