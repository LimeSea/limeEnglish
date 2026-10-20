import type {
  BackgroundMessage,
  SelectionPayload,
  StoredAnalysis,
} from "../shared/contracts";
import { debug } from "./debug";

export type WordCardCloseReason = "outside" | "escape" | "replaced";

export class WordCard {
  readonly requestId = crypto.randomUUID();
  private readonly host: HTMLDivElement;
  private readonly card: HTMLElement;
  private readonly count: HTMLElement;
  private readonly phonetic: HTMLElement;
  private readonly meaning: HTMLElement;
  private readonly phrase: HTMLElement;
  private readonly sentence: HTMLElement;
  private readonly translation: HTMLElement;
  private readonly grammar: HTMLElement;
  private readonly status: HTMLElement;
  private readonly initialScrollX = scrollX;
  private readonly initialScrollY = scrollY;
  private closed = false;
  private readonly repositionListener = () => this.position();
  private manuallyPositioned = false;
  private dragPointerId: number | undefined;
  private dragOffsetX = 0;
  private dragOffsetY = 0;

  constructor(
    readonly payload: SelectionPayload,
    private readonly onClose: (reason: WordCardCloseReason) => void,
  ) {
    this.host = document.createElement("div");
    this.host.dataset.contextWordHelper = "host";
    Object.assign(this.host.style, { all: "initial", position: "fixed", inset: "0", zIndex: "2147483647", pointerEvents: "none" });
    const root = this.host.attachShadow({ mode: "open" });
    const style = document.createElement("style");
    style.textContent = `
      :host { all: initial; }
      * { box-sizing: border-box; }
      .card {
        --paper: #fff; --ink: #171916; --muted: #70766b; --line: #e4e7df;
        --subtle: #f5f6f2; --lime: #c9f447; --lime-soft: #f3fbdc; --danger: #b83b45; --danger-soft: #fff0f1;
        position: fixed; box-sizing: border-box; width: min(390px, calc(100vw - 20px)); max-height: min(640px, calc(100vh - 20px));
        overflow: auto; border: 1px solid var(--line); border-radius: 15px; background: var(--paper); color: var(--ink);
        box-shadow: 0 16px 48px rgba(10,14,8,.17), 0 2px 7px rgba(10,14,8,.09);
        font: 14px/1.65 Inter, ui-sans-serif, -apple-system, BlinkMacSystemFont, "Segoe UI", "Noto Sans CJK SC", "PingFang SC", "Microsoft YaHei", sans-serif;
        pointer-events: auto; scrollbar-width: thin; scrollbar-color: #c7cbc2 transparent; animation: card-in .2s cubic-bezier(.2,.8,.2,1) both;
      }
      .window-bar { position: sticky; z-index: 3; top: 0; display: flex; align-items: center; height: 36px; padding: 0 16px; border-bottom: 1px solid var(--line); background: rgba(255,255,255,.96); backdrop-filter: blur(10px); cursor: grab; touch-action: none; user-select: none; }
      .window-bar[data-dragging="true"] { cursor: grabbing; }
      .window-label { display: flex; align-items: center; gap: 7px; color: var(--muted); font-size: 10px; font-weight: 700; letter-spacing: .02em; }
      .window-label::before { content: "a"; display: grid; place-items: center; width: 19px; height: 19px; border-radius: 6px; background: var(--ink); color: var(--lime); font: 800 15px/1 Georgia, serif; letter-spacing: -.04em; }
      header { display: flex; align-items: end; gap: 14px; padding: 19px 18px 15px; }
      .word-block { min-width: 0; flex: 1; }
      .word-kicker { display: block; margin-bottom: 3px; color: var(--muted); font-size: 9px; font-weight: 650; letter-spacing: .08em; }
      h2 { margin: 0; font: 760 30px/1.15 ui-sans-serif, sans-serif; letter-spacing: -.035em; overflow-wrap: anywhere; }
      .phonetic { display: block; margin-top: 5px; color: #586448; font: 600 13px/1.3 "SFMono-Regular", Consolas, monospace; }
      .encounter { flex: 0 0 auto; margin: 0; color: var(--muted); font-size: 9px; font-weight: 650; line-height: 1.45; text-align: right; }
      .sentence-wrap { margin: 4px 18px 0; padding: 12px 0 14px; border-top: 1px solid var(--line); border-bottom: 1px solid var(--line); }
      .sentence-label { display: block; margin-bottom: 5px; color: var(--muted); font-size: 9px; font-weight: 700; letter-spacing: .06em; }
      .sentence { margin: 0; color: #4f554c; font: 12px/1.75 "SFMono-Regular", Consolas, monospace; }
      mark, .phrase-mark { padding: 1px 2px; background: var(--lime); color: var(--ink); font-weight: 800; box-decoration-break: clone; -webkit-box-decoration-break: clone; }
      .phrase-mark { background: #e8ebe3; border-bottom: 2px solid #82945a; }
      .phrase-mark strong { padding: 1px 2px; background: var(--lime); color: var(--ink); }
      .status { display: flex; align-items: center; gap: 8px; margin: 13px 18px 17px; color: var(--muted); font-size: 10px; font-weight: 600; }
      .status::before { content: ""; width: 8px; height: 8px; border: 1.5px solid #b9beb4; border-top-color: var(--ink); border-radius: 50%; animation: spin .7s linear infinite; }
      .status[data-tone="error"] { padding: 8px 10px; border-radius: 8px; background: var(--danger-soft); color: var(--danger); }
      .status[data-tone="error"]::before { width: 5px; height: 5px; border: 0; background: var(--danger); animation: none; }
      .encounter[data-tone="error"] { color: var(--danger); }
      section { margin: 0 18px; padding: 14px 0; border-bottom: 1px solid var(--line); }
      section:first-of-type { margin-bottom: 1px; padding: 14px 15px; border: 0; border-radius: 10px; background: var(--lime-soft); }
      section.grammar { margin-bottom: 5px; border-bottom: 0; }
      h3 { margin: 0 0 5px; color: var(--muted); font-size: 9px; font-weight: 700; letter-spacing: .06em; }
      section div { color: var(--ink); font-size: 20px; font-weight: 730; line-height: 1.45; white-space: pre-wrap; overflow-wrap: anywhere; }
      section.translation div, section.grammar div, section.phrase div { font-size: 13px; font-weight: 520; line-height: 1.7; }
      [hidden] { display: none; }
      @keyframes card-in { from { opacity: 0; transform: translateY(7px) scale(.985); } to { opacity: 1; transform: translateY(0) scale(1); } }
      @keyframes spin { to { transform: rotate(360deg); } }
      @media (prefers-reduced-motion: reduce) { .card, .status::before { animation: none; } }
      @media (max-width: 360px) { header { align-items: start; flex-wrap: wrap; } .encounter { order: 3; text-align: left; } }
    `;
    this.card = document.createElement("article");
    this.card.className = "card";
    this.card.setAttribute("role", "dialog");
    this.card.setAttribute("aria-label", `${payload.surface} 语境词卡`);

    const windowBar = document.createElement("div");
    windowBar.className = "window-bar";
    const windowLabel = document.createElement("span");
    windowLabel.className = "window-label";
    windowLabel.textContent = "limeEnglish";
    windowBar.setAttribute("aria-label", "拖动词卡");
    windowBar.append(windowLabel);
    windowBar.addEventListener("pointerdown", (event) => this.startDrag(event, windowBar));
    windowBar.addEventListener("pointermove", (event) => this.drag(event));
    windowBar.addEventListener("pointerup", (event) => this.stopDrag(event, windowBar));
    windowBar.addEventListener("pointercancel", (event) => this.stopDrag(event, windowBar));

    const header = document.createElement("header");
    const wordBlock = document.createElement("div");
    wordBlock.className = "word-block";
    const wordKicker = document.createElement("span");
    wordKicker.className = "word-kicker";
    wordKicker.textContent = "语境中的词";
    const heading = document.createElement("h2");
    heading.textContent = payload.surface;
    this.phonetic = document.createElement("span");
    this.phonetic.className = "phonetic";
    this.phonetic.hidden = true;
    wordBlock.append(wordKicker, heading, this.phonetic);
    this.count = document.createElement("p");
    this.count.className = "encounter";
    this.count.textContent = "正在保存…";
    header.append(wordBlock, this.count);

    const sentenceWrap = document.createElement("div");
    sentenceWrap.className = "sentence-wrap";
    const sentenceLabel = document.createElement("span");
    sentenceLabel.className = "sentence-label";
    sentenceLabel.textContent = "原句";
    this.sentence = document.createElement("p");
    this.sentence.className = "sentence";
    this.sentence.append(
      document.createTextNode(payload.sentence.slice(0, payload.targetSpan.start)),
      Object.assign(document.createElement("mark"), { textContent: payload.sentence.slice(payload.targetSpan.start, payload.targetSpan.end) }),
      document.createTextNode(payload.sentence.slice(payload.targetSpan.end)),
    );
    sentenceWrap.append(sentenceLabel, this.sentence);
    this.status = document.createElement("p");
    this.status.className = "status";
    this.status.setAttribute("role", "status");
    this.status.setAttribute("aria-live", "polite");
    this.status.textContent = "查询中…";
    this.meaning = this.section("在这里的意思", "");
    this.meaning.hidden = true;
    this.phrase = this.section("一起出现的表达", "");
    this.phrase.className = "phrase";
    this.phrase.hidden = true;
    this.translation = this.section("整句翻译", "");
    this.translation.className = "translation";
    this.translation.hidden = true;
    this.grammar = this.section("为什么这样理解", "");
    this.grammar.className = "grammar";
    this.grammar.hidden = true;
    this.card.append(windowBar, header, this.meaning, this.phrase, sentenceWrap, this.status, this.translation, this.grammar);
    root.append(style, this.card);
    document.documentElement.append(this.host);
    for (const eventName of ["pointerdown", "mousedown", "mouseup", "click", "dblclick"]) {
      this.card.addEventListener(eventName, (event) => event.stopPropagation());
    }
    addEventListener("scroll", this.repositionListener, true);
    addEventListener("resize", this.repositionListener);
    this.position();
  }

  private section(title: string, text: string): HTMLElement {
    const section = document.createElement("section");
    const heading = document.createElement("h3");
    heading.textContent = title;
    const body = document.createElement("div");
    body.textContent = text;
    section.append(heading, body);
    return section;
  }

  private body(section: HTMLElement): HTMLElement {
    return section.lastElementChild as HTMLElement;
  }

  private position(): void {
    const margin = 8;
    const width = this.card.offsetWidth || Math.min(380, innerWidth - 20);
    const height = this.card.offsetHeight || 260;
    if (this.manuallyPositioned) {
      const left = Number.parseFloat(this.card.style.left) || margin;
      const top = Number.parseFloat(this.card.style.top) || margin;
      this.setPosition(left, top, width, height);
      return;
    }

    const anchor = this.payload.anchorRect;
    const leftAnchor = anchor.left - (scrollX - this.initialScrollX);
    const topAnchor = anchor.top - (scrollY - this.initialScrollY);
    const bottomAnchor = anchor.bottom - (scrollY - this.initialScrollY);
    const left = Math.max(margin, Math.min(leftAnchor, innerWidth - width - margin));
    const below = bottomAnchor + margin;
    const top = below + height <= innerHeight - margin ? below : Math.max(margin, topAnchor - height - margin);
    this.setPosition(left, top, width, height);
  }

  private startDrag(event: PointerEvent, handle: HTMLElement): void {
    if (!event.isPrimary || (event.pointerType === "mouse" && event.button !== 0)) return;
    const rect = this.card.getBoundingClientRect();
    this.dragPointerId = event.pointerId;
    this.dragOffsetX = event.clientX - rect.left;
    this.dragOffsetY = event.clientY - rect.top;
    this.manuallyPositioned = true;
    handle.dataset.dragging = "true";
    handle.setPointerCapture(event.pointerId);
    event.preventDefault();
  }

  private drag(event: PointerEvent): void {
    if (event.pointerId !== this.dragPointerId) return;
    this.setPosition(
      event.clientX - this.dragOffsetX,
      event.clientY - this.dragOffsetY,
      this.card.offsetWidth,
      this.card.offsetHeight,
    );
  }

  private stopDrag(event: PointerEvent, handle: HTMLElement): void {
    if (event.pointerId !== this.dragPointerId) return;
    this.dragPointerId = undefined;
    delete handle.dataset.dragging;
    if (handle.hasPointerCapture(event.pointerId)) handle.releasePointerCapture(event.pointerId);
  }

  private setPosition(left: number, top: number, width: number, height: number): void {
    const margin = 8;
    this.card.style.left = `${Math.max(margin, Math.min(left, innerWidth - width - margin))}px`;
    this.card.style.top = `${Math.max(margin, Math.min(top, innerHeight - height - margin))}px`;
  }

  handle(message: BackgroundMessage): void {
    if (message.requestId !== this.requestId) return;
    if (message.type === "lookup:collected") {
      this.count.textContent = `遇见 ${message.occurrence.encounterCount} 次（该来源） · 总计 ${message.word.encounterCount} 次`;
    } else if (message.type === "analysis:started") {
      delete this.status.dataset.tone;
      this.status.textContent = "查询中…";
    } else if (message.type === "analysis:ready") {
      this.renderAnalysis(message.result);
    } else if (message.type === "lookup:error") {
      this.renderError(message.area, message.code);
    }
  }

  private renderAnalysis(result: StoredAnalysis): void {
    this.body(this.meaning).textContent = result.contextualMeaningZh;
    this.phonetic.textContent = `/${result.phonetic}/`;
    this.phonetic.hidden = false;
    this.body(this.translation).textContent = result.sentenceTranslationZh;
    this.body(this.grammar).textContent = result.grammarAnalysisZh;
    if (result.phrase) {
      const typeLabels: Record<typeof result.phrase.type, string> = {
        phrasal_verb: "短语动词", idiom: "习语", collocation: "固定搭配", compound: "复合表达", other: "短语",
      };
      this.body(this.phrase).textContent = `${result.phrase.text} · ${typeLabels[result.phrase.type]}\n${result.phrase.meaningZh}`;
      const phraseMark = document.createElement("span");
      phraseMark.className = "phrase-mark";
      phraseMark.append(
        document.createTextNode(result.phrase.text.slice(0, this.payload.targetSpan.start - result.phrase.span.start)),
        Object.assign(document.createElement("strong"), { textContent: this.payload.surface }),
        document.createTextNode(result.phrase.text.slice(this.payload.targetSpan.end - result.phrase.span.start)),
      );
      this.sentence.replaceChildren(
        document.createTextNode(this.payload.sentence.slice(0, result.phrase.span.start)),
        phraseMark,
        document.createTextNode(this.payload.sentence.slice(result.phrase.span.end)),
      );
      this.phrase.hidden = false;
    }
    this.meaning.hidden = false;
    this.translation.hidden = false;
    this.grammar.hidden = false;
    this.status.remove();
    this.position();
  }

  private renderError(area: "model" | "request", code: string): void {
    const messages: Record<string, string> = {
      MODEL_OUTPUT_INVALID: "模型输出格式无效",
      GATEWAY_UNAVAILABLE: "暂时无法查询",
      GATEWAY_RATE_LIMITED: "查询请求过于频繁",
      GATEWAY_REQUEST_FAILED: "查询失败",
      COLLECTION_FAILED: "保存失败",
      ANALYSIS_SAVE_FAILED: "分析已显示，但保存失败",
      INVALID_REQUEST: "请求无效",
    };
    const body = area === "model" ? this.status : this.count;
    body.dataset.tone = "error";
    body.replaceChildren(document.createTextNode(messages[code] ?? code));
  }

  close(reason: WordCardCloseReason): void {
    if (this.closed) return;
    this.closed = true;
    debug("card:closed", { requestId: this.requestId, surface: this.payload.surface, reason });
    removeEventListener("scroll", this.repositionListener, true);
    removeEventListener("resize", this.repositionListener);
    this.host.remove();
    this.onClose(reason);
  }
}
