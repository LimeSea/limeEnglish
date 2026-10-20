import { isProviderSettings, type ProviderSettings } from "../shared/contracts";

export const PROVIDER_SETTINGS_KEY = "providerSettings";
export const DEFAULT_PROVIDER_SETTINGS: ProviderSettings = { kind: "magpie", baseUrl: "http://127.0.0.1:3425/v1", model: "group/auto-glm-5-3-flash" };

export async function loadProviderSettings(): Promise<ProviderSettings> {
  const stored = await chrome.storage.local.get(PROVIDER_SETTINGS_KEY);
  const value = stored[PROVIDER_SETTINGS_KEY];
  return isProviderSettings(value) ? value : DEFAULT_PROVIDER_SETTINGS;
}

export async function saveProviderSettings(settings: ProviderSettings): Promise<void> {
  if (!isProviderSettings(settings)) throw new Error("Invalid provider settings");
  await chrome.storage.local.set({ [PROVIDER_SETTINGS_KEY]: settings });
}
