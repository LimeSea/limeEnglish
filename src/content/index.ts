import { isBackgroundMessage, type ContentMessage } from "../shared/contracts";
import { WordCard } from "./card";
import { captureSelection } from "./selection";
import { debug } from "./debug";

let port: chrome.runtime.Port | undefined;
let portUrl: string | undefined;
let current: WordCard | undefined;

function connect(): chrome.runtime.Port {
  debug("port:connecting");
  const next = chrome.runtime.connect({ name: "word-card" });
  next.onMessage.addListener((message: unknown) => {
    if (!isBackgroundMessage(message)) {
      debug("message:invalid");
      return;
    }
    if (!current) {
      debug("message:orphan", { type: message.type, requestId: message.requestId });
      return;
    }
    if (message.requestId !== current.requestId) {
      debug("message:stale", { type: message.type, requestId: message.requestId, currentRequestId: current.requestId });
      return;
    }
    if (message.type === "lookup:error") {
      debug("message:received", { type: message.type, requestId: message.requestId, area: message.area, code: message.code });
    } else {
      debug("message:received", { type: message.type, requestId: message.requestId });
    }
    current.handle(message);
  });
  next.onDisconnect.addListener(() => {
    debug("port:disconnected", { error: chrome.runtime.lastError?.message ?? null });
    if (port === next) {
      port = undefined;
      portUrl = undefined;
    }
  });
  port = next;
  portUrl = location.href;
  debug("port:connected");
  return next;
}

function send(message: ContentMessage): void {
  if (port && portUrl !== location.href) {
    debug("port:reconnecting", { reason: "url-changed" });
    port.disconnect();
    port = undefined;
    portUrl = undefined;
  }
  debug("message:sending", { type: message.type, requestId: message.requestId });
  try {
    (port ?? connect()).postMessage(message);
  } catch (error) {
    debug("message:send-retry", { type: message.type, requestId: message.requestId, error: error instanceof Error ? error.message : String(error) });
    port = undefined;
    portUrl = undefined;
    connect().postMessage(message);
  }
}

document.addEventListener("pointerdown", (event) => {
  if (!current) return;
  if (event.composedPath().some((node) => node instanceof HTMLElement && node.dataset.contextWordHelper === "host")) return;
  current.close("outside");
}, true);

document.addEventListener("mouseup", (event) => {
  if (event.detail < 2) return;
  const selection = document.getSelection();
  debug("selection:mouseup", {
    clickCount: event.detail,
    button: event.button,
    isTrusted: event.isTrusted,
    rangeCount: selection?.rangeCount ?? 0,
    collapsed: selection?.isCollapsed ?? true,
    selectedText: selection?.toString().slice(0, 80) ?? "",
    currentRequestId: current?.requestId ?? null,
  });
  if (event.composedPath().some((node) => node instanceof HTMLElement && node.dataset.contextWordHelper === "host")) {
    debug("selection:ignored-card-event");
    return;
  }
  const payload = captureSelection(event, (reason) => debug("selection:rejected", { reason }));
  if (!payload) return;
  current?.close("replaced");
  let card: WordCard;
  card = new WordCard(
    payload,
    () => {
      if (current === card) current = undefined;
    },
  );
  current = card;
  debug("card:opened", { requestId: card.requestId, surface: payload.surface });
  send({ type: "lookup:start", requestId: card.requestId, payload });
}, true);

document.addEventListener("keydown", (event) => {
  if (event.key === "Escape") current?.close("escape");
}, true);
