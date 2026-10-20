import { isProviderSettings, type ProviderSettings } from "../shared/contracts";
import { createMagpieSessionAffinity, listMagpieModels, MagpieProvider } from "../background/magpie-provider";
import { loadProviderSettings, saveProviderSettings } from "../background/settings";

const form = document.querySelector<HTMLFormElement>("#settings")!;
const gateway = document.querySelector<HTMLSelectElement>("#gateway")!;
const baseUrl = document.querySelector<HTMLInputElement>("#base-url")!;
const model = document.querySelector<HTMLSelectElement>("#model")!;
const loadModelsButton = document.querySelector<HTMLButtonElement>("#load-models")!;
const testButton = document.querySelector<HTMLButtonElement>("#test")!;
const saveButton = document.querySelector<HTMLButtonElement>("#save-settings")!;
const modelCount = document.querySelector<HTMLElement>("#model-count")!;
const modelSelection = document.querySelector<HTMLElement>("#model-selection")!;
const status = document.querySelector<HTMLElement>("#status")!;
const appVersion = document.querySelector<HTMLElement>("#app-version")!;

appVersion.textContent = `版本 ${chrome.runtime.getManifest().version}`;

function showStatus(message: string, tone: "ok" | "error" | "neutral" = "neutral"): void {
  status.textContent = message;
  status.dataset.tone = tone;
}

function settingsFromForm(): ProviderSettings | undefined {
  const candidate: unknown = { kind: gateway.value, baseUrl: baseUrl.value.trim().replace(/\/+$/, ""), model: model.value };
  return isProviderSettings(candidate) ? candidate : undefined;
}

function validBaseUrl(): string | undefined {
  const candidate: unknown = { kind: gateway.value, baseUrl: baseUrl.value.trim().replace(/\/+$/, ""), model: "placeholder" };
  return isProviderSettings(candidate) ? candidate.baseUrl : undefined;
}

function updateModelSummary(total?: number): void {
  if (total !== undefined) modelCount.textContent = `${total} 个可用`;
  const selected = model.selectedOptions[0]?.textContent;
  modelSelection.textContent = model.value && selected
    ? `将使用「${selected}」分析网页中的单词语境。`
    : "连接后，选择一个模型。";
}

async function refreshModels(preferred = model.value): Promise<void> {
  const url = validBaseUrl();
  if (!url) {
    showStatus("网关地址无效：HTTP 仅允许本机地址，远程地址必须使用 HTTPS。", "error");
    return;
  }
  loadModelsButton.disabled = true;
  testButton.disabled = true;
  showStatus("正在连接 Magpie…");
  try {
    const models = await listMagpieModels(url);
    model.replaceChildren(new Option("请选择模型", ""));
    for (const item of models) {
      const suffix = item.label === item.id ? "" : ` · ${item.id}`;
      model.add(new Option(`${item.label}${suffix}`, item.id));
    }
    model.value = models.some((item) => item.id === preferred) ? preferred : "";
    updateModelSummary(models.length);
    showStatus(`连接成功，找到 ${models.length} 个模型。请选择一个。`, "ok");
  } catch (error) {
    showStatus(error instanceof Error ? error.message : "获取模型列表失败", "error");
    modelCount.textContent = "加载失败";
    modelSelection.textContent = "无法读取模型，请检查地址后重试。";
  } finally {
    loadModelsButton.disabled = false;
    const ready = Boolean(settingsFromForm());
    testButton.disabled = !ready;
    saveButton.disabled = !ready;
  }
}

async function initialize(): Promise<void> {
  const settings = await loadProviderSettings();
  gateway.value = settings.kind;
  baseUrl.value = settings.baseUrl;
  await refreshModels(settings.model);
}

loadModelsButton.addEventListener("click", () => { void refreshModels(); });

gateway.addEventListener("change", () => {
  model.replaceChildren(new Option("请重新连接并获取模型", ""));
  modelCount.textContent = "未连接";
  modelSelection.textContent = "连接后，选择一个模型。";
  testButton.disabled = true;
  saveButton.disabled = true;
  showStatus("服务已更改，请重新连接。 ");
});

baseUrl.addEventListener("input", () => {
  model.replaceChildren(new Option("地址已更改，请重新连接", ""));
  modelCount.textContent = "未连接";
  modelSelection.textContent = "地址变更后，需要重新连接。";
  testButton.disabled = true;
  saveButton.disabled = true;
  showStatus("地址已更改，请重新连接。 ");
});

model.addEventListener("change", () => {
  const ready = Boolean(settingsFromForm());
  testButton.disabled = !ready;
  saveButton.disabled = !ready;
  updateModelSummary();
  if (ready) showStatus("模型已就绪。你可以测试，或直接保存。 ");
});

testButton.addEventListener("click", () => {
  const settings = settingsFromForm();
  if (!settings) {
    showStatus("请使用有效网关地址并从列表中选择模型。", "error");
    return;
  }
  testButton.disabled = true;
  showStatus("正在测试所选模型的结构化输出…");
  void new MagpieProvider(settings.baseUrl, settings.model, createMagpieSessionAffinity("options-test")).testConnection()
    .then(() => showStatus("连接成功，所选模型返回了有效结构。", "ok"))
    .catch((error: unknown) => showStatus(error instanceof Error ? error.message : "连接失败", "error"))
    .finally(() => { testButton.disabled = !settingsFromForm(); });
});

form.addEventListener("submit", (event) => {
  event.preventDefault();
  const settings = settingsFromForm();
  if (!settings) {
    showStatus("请使用有效网关地址并从列表中选择模型。", "error");
    return;
  }
  saveButton.disabled = true;
  showStatus("正在保存设置…");
  void saveProviderSettings(settings)
    .then(() => showStatus("已保存。现在去网页上双击一个英文单词。", "ok"))
    .catch((error: unknown) => showStatus(error instanceof Error ? error.message : "保存失败", "error"))
    .finally(() => { saveButton.disabled = !settingsFromForm(); });
});

void initialize().catch((error: unknown) => showStatus(error instanceof Error ? error.message : "读取设置失败", "error"));
