import { test, expect, chromium, type BrowserContext, type ConsoleMessage, type Page } from "@playwright/test";
import { mkdtemp } from "node:fs/promises";
import { setTimeout as delay } from "node:timers/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

let context: BrowserContext;
let page: Page;


const gatewayAffinities: string[] = [];
const gatewayAuthorizations: string[] = [];

test.beforeAll(async () => {
  const profile = await mkdtemp(join(tmpdir(), "context-word-helper-"));
  const extension = resolve("dist");
  const executablePath = process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH;
  context = await chromium.launchPersistentContext(profile, {
    ...(executablePath ? { executablePath } : { channel: "chromium" }),
    headless: true,
    args: [`--disable-extensions-except=${extension}`, `--load-extension=${extension}`],
  });
  await context.route("http://127.0.0.1:3425/v1/models", (route) => route.fulfill({
    status: 200,
    contentType: "application/json",
    body: JSON.stringify({ data: [
      { id: "group/auto-glm-5-3-flash", magpie_label: "GLM Flash · routing group", reasoning: true },
      { id: "test/manual-model", display_name: "Manual Test Model", reasoning: false },
    ] }),
  }));
  await context.route("http://127.0.0.1:3425/v1/chat/completions", async (route) => {
    gatewayAffinities.push(route.request().headers()["x-session-affinity"] ?? "");
    gatewayAuthorizations.push(route.request().headers().authorization ?? "");
    await delay(100);
    const phrase = route.request().postData()?.includes('"surface":"bank"')
      ? { text: "on the bank", type: "collocation", meaningZh: "在河岸上" }
      : null;
    const content = { lemma: "bank", partOfSpeech: "noun", phonetic: "bæŋk", contextualMeaningZh: "河岸", phrase, sentenceTranslationZh: "李博士坐在河岸上，看着河水流淌。", grammarAnalysisZh: "bank 作介词 on 的宾语，介词短语 on the bank 作地点状语。" };
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ choices: [{ message: { content: JSON.stringify(content) } }] }) });
  });
  page = context.pages()[0] ?? await context.newPage();
});

test.afterAll(async () => {
  await context.close();
});

test("captures an abbreviated sentence across inline nodes and increments the source count", async () => {
  await page.goto("http://127.0.0.1:4173/");
  await page.locator("#bank").dblclick();
  const card = page.locator("[data-context-word-helper='host'] .card");
  await expect(card).toBeVisible();
  await expect(card.locator(".sentence")).toHaveText("Dr. Lee sat on the bank and watched the river flow.");
  await expect(card.locator(".phrase-mark")).toContainText("on the bank");
  await expect(card.locator(".phrase-mark strong")).toHaveText("bank");
  await expect(card).toContainText("遇见 1 次");
  await expect(card).toContainText("查询中…");
  await expect(card).not.toContainText("词典释义");
  await expect(card.getByRole("button", { name: "重试" })).toHaveCount(0);
  await expect(card.getByRole("button", { name: "关闭词卡" })).toHaveCount(0);
  await expect(card).not.toContainText("Magpie 网关");
  await expect(card).toContainText("河岸");
  await expect(card).toContainText("on the bank · 固定搭配");
  await expect(card).toContainText("在河岸上");
  await expect(card).toContainText("/bæŋk/");
  await expect(card).toContainText("李博士坐在河岸上，看着河水流淌。");
  await expect(card).toContainText("bank 作介词 on 的宾语");

  await page.locator("#bank").dblclick();
  await expect(page.locator("[data-context-word-helper='host'] .card")).toContainText("遇见 2 次");
});

test("drags the word card by its window bar and keeps it in place while scrolling", async () => {
  await page.goto("http://127.0.0.1:4173/");
  await page.locator("#bank").dblclick();
  const card = page.locator("[data-context-word-helper='host'] .card");
  const handle = card.locator(".window-bar");
  await expect(card).toContainText("河岸");

  const before = await card.boundingBox();
  const handleBox = await handle.boundingBox();
  if (!before || !handleBox) throw new Error("Word card drag geometry is unavailable");
  const deltaX = before.x > 120 ? -80 : 80;
  await page.mouse.move(handleBox.x + 20, handleBox.y + handleBox.height / 2);
  await page.mouse.down();
  await page.mouse.move(handleBox.x + 20 + deltaX, handleBox.y + handleBox.height / 2, { steps: 5 });
  await page.mouse.up();

  const afterDrag = await card.boundingBox();
  if (!afterDrag) throw new Error("Dragged word card geometry is unavailable");
  expect(afterDrag.x).toBeCloseTo(before.x + deltaX, 0);
  expect(afterDrag.y).toBeCloseTo(before.y, 0);

  await page.mouse.wheel(0, 300);
  await expect.poll(async () => (await card.boundingBox())?.x).toBeCloseTo(afterDrag.x, 0);
  await expect.poll(async () => (await card.boundingBox())?.y).toBeCloseTo(afterDrag.y, 0);
});

test("reconnects the message port after SPA navigation changes the URL", async () => {
  const events: string[] = [];
  const recordDiagnostic = async (message: ConsoleMessage): Promise<void> => {
    if (!message.text().startsWith("[ContextWordHelper]")) return;
    const details = await message.args()[1]?.jsonValue() as { event?: unknown } | undefined;
    if (typeof details?.event === "string") events.push(details.event);
  };
  page.on("console", recordDiagnostic);
  try {
    await page.goto("http://127.0.0.1:4173/article");
    await page.locator("#bank").dblclick();
    await expect(page.locator("[data-context-word-helper='host'] .card")).toContainText("河岸");

    await page.evaluate(() => history.pushState({}, "", "/recipes"));
    await page.locator("#boat").dblclick();

    const card = page.locator("[data-context-word-helper='host'] .card");
    await expect(card.locator("h2")).toHaveText("boat");
    await expect(card).toContainText("河岸");
    await expect(card).not.toContainText("请求无效");
    await expect.poll(() => events).toContain("port:reconnecting");
  } finally {
    page.off("console", recordDiagnostic);
  }
});

test("captures the next word after closing when dblclick is not delivered", async () => {
  const events: string[] = [];
  const recordDiagnostic = async (message: ConsoleMessage): Promise<void> => {
    if (!message.text().startsWith("[ContextWordHelper]")) return;
    const details = await message.args()[1]?.jsonValue() as { event?: unknown } | undefined;
    if (typeof details?.event === "string") events.push(details.event);
  };
  page.on("console", recordDiagnostic);
  try {
    await page.goto("http://127.0.0.1:4173/");
    await page.locator("#bank").dblclick();
    await page.getByRole("heading", { name: "Life Along the River" }).click();
    await expect(page.locator("[data-context-word-helper='host']")).toHaveCount(0);

    await page.evaluate(() => {
      window.addEventListener("dblclick", (event) => event.stopImmediatePropagation(), true);
    });
    await page.locator("#boat").dblclick();

    const card = page.locator("[data-context-word-helper='host'] .card");
    await expect(card).toBeVisible();
    await expect(card.locator("h2")).toHaveText("boat");
    await expect.poll(() => events).toContain("selection:mouseup");
    expect(events).toContain("card:opened");
    expect(events).toContain("card:closed");
  } finally {
    page.off("console", recordDiagnostic);
  }
});

test("trims boundary whitespace included by the browser selection", async () => {
  await page.goto("http://127.0.0.1:4173/");
  await page.evaluate(() => {
    const node = document.querySelector("#possibility")?.firstChild;
    if (!(node instanceof Text)) throw new Error("Possibility text node missing");
    const range = document.createRange();
    range.setStart(node, 0);
    range.setEnd(node, node.data.length);
    const selection = document.getSelection();
    selection?.removeAllRanges();
    selection?.addRange(range);
    window.addEventListener("mousedown", (event) => event.preventDefault(), { capture: true, once: true });
  });
  const box = await page.locator("#possibility").boundingBox();
  expect(box).not.toBeNull();
  const session = await context.newCDPSession(page);
  await session.send("Input.dispatchMouseEvent", {
    type: "mousePressed",
    x: box!.x + box!.width / 2,
    y: box!.y + box!.height / 2,
    button: "left",
    buttons: 1,
    clickCount: 2,
  });
  await session.send("Input.dispatchMouseEvent", {
    type: "mouseReleased",
    x: box!.x + box!.width / 2,
    y: box!.y + box!.height / 2,
    button: "left",
    clickCount: 2,
  });
  await session.detach();

  const card = page.locator("[data-context-word-helper='host'] .card");
  await expect(card).toBeVisible();
  await expect(card.locator("h2")).toHaveText("possibility");
  await expect(card.locator(".sentence")).toHaveText("A possibility remains.");
  await expect(card.locator("mark")).toHaveText("possibility");
});

test("ignores forbidden and hidden selection surfaces", async () => {
  await page.goto("http://127.0.0.1:4173/");
  for (const selector of ["#input", "#editable", "#code"]) {
    await page.locator(selector).dblclick();
    await expect(page.locator("[data-context-word-helper='host']")).toHaveCount(0);
  }
  await expect(page.locator("#hidden")).toBeHidden();
});

test("opens the vocabulary library from the extension options entry", async () => {
  const worker = context.serviceWorkers()[0] ?? await context.waitForEvent("serviceworker");
  const openedPage = context.waitForEvent("page");
  await worker.evaluate(() => chrome.runtime.openOptionsPage());
  const libraryPage = await openedPage;
  await expect(libraryPage.getByRole("heading", { name: "我的词汇" })).toBeVisible();
  await libraryPage.close();
});

test("loads Magpie models, manually selects one, tests it, and persists gateway settings", async () => {
  const affinityOffset = gatewayAffinities.length;
  const worker = context.serviceWorkers()[0] ?? await context.waitForEvent("serviceworker");
  const extensionId = new URL(worker.url()).host;
  const settingsPage = await context.newPage();
  await settingsPage.goto(`chrome-extension://${extensionId}/options.html`);
  await expect(settingsPage.locator("#app-version")).toHaveText("版本 0.0.1");
  await expect(settingsPage.getByLabel("网关服务")).toHaveValue("magpie");
  await expect(settingsPage.getByLabel("分析模型").locator("option")).toHaveCount(3);
  await settingsPage.getByLabel("分析模型").selectOption("test/manual-model");
  await settingsPage.getByRole("button", { name: "测试所选模型" }).click();
  await expect(settingsPage.getByRole("status")).toHaveAttribute("data-tone", "ok");
  await settingsPage.getByRole("button", { name: "测试所选模型" }).click();
  await expect(settingsPage.getByRole("status")).toHaveAttribute("data-tone", "ok");
  expect(gatewayAffinities.slice(affinityOffset)).toHaveLength(2);
  expect(gatewayAuthorizations.slice(affinityOffset)).toEqual([
    "Bearer magpie-lime-english",
    "Bearer magpie-lime-english",
  ]);
  expect(gatewayAffinities.slice(affinityOffset).every((value) => value.startsWith("lime-english:options-test:"))).toBe(true);
  expect(gatewayAffinities[affinityOffset]).not.toBe(gatewayAffinities[affinityOffset + 1]);
  await settingsPage.getByRole("button", { name: "保存设置" }).click();
  await expect(settingsPage.getByRole("status")).toHaveAttribute("data-tone", "ok");
  const stored = await settingsPage.evaluate(async () => chrome.storage.local.get("providerSettings"));
  expect(stored.providerSettings).toEqual({ kind: "magpie", baseUrl: "http://127.0.0.1:3425/v1", model: "test/manual-model" });
  await settingsPage.close();
});

test("lists captured vocabulary with source links and all contexts", async () => {
  await page.goto("http://127.0.0.1:4173/");
  await page.locator("#bank").dblclick();
  await expect(page.locator("[data-context-word-helper='host'] .card")).toContainText("河岸");

  const worker = context.serviceWorkers()[0] ?? await context.waitForEvent("serviceworker");
  const extensionId = new URL(worker.url()).host;
  const libraryPage = await context.newPage();
  await libraryPage.goto(`chrome-extension://${extensionId}/library.html`);
  await expect(libraryPage.getByRole("heading", { name: "我的词汇" })).toBeVisible();
  await libraryPage.getByLabel("搜索").fill("bank");
  const row = libraryPage.locator("#word-rows tr").filter({ hasText: "bank" }).first();
  await expect(row).toContainText("Dr. Lee sat on the bank and watched the river flow.");
  await expect(row).toContainText("/bæŋk/");
  await expect(row.getByRole("link", { name: "查看原文" })).toHaveAttribute("href", "http://127.0.0.1:4173/");

  await row.getByRole("link", { name: "查看 bank 的全部语境" }).click();
  await expect(libraryPage).toHaveURL(new RegExp(`/word\\.html\\?id=bank$`));
  await expect(libraryPage.getByRole("heading", { name: "bank" })).toBeVisible();
  await expect(libraryPage.locator("#detail-phonetic")).toHaveText("/bæŋk/");
  await expect(libraryPage.locator("body")).toContainText("Dr. Lee sat on the bank and watched the river flow.");
  await expect(libraryPage.getByRole("link", { name: "查看原文" }).first()).toHaveAttribute("href", "http://127.0.0.1:4173/");
  await expect(libraryPage.getByRole("link", { name: "返回词汇库" })).toHaveAttribute("href", "library.html");
  await libraryPage.close();
});
