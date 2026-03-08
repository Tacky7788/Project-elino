import { platform } from '../platform';
// Settings > LLM + API Keys tab
import type { Settings, LLMProvider } from '../types';
import { t } from '../locales';
import { modelRegistry, syncSliders } from './shared';

// DOM elements
let llmProviderSelect: HTMLSelectElement;
let llmModelSelect: HTMLSelectElement;
let llmMaxTokensInput: HTMLInputElement;
let llmMaxTokensNumInput: HTMLInputElement;
let apiKeyClaude: HTMLInputElement;
let apiKeyOpenai: HTMLInputElement;
let apiKeyGoogle: HTMLInputElement;
let apiKeyGroq: HTMLInputElement;
let apiKeyDeepseek: HTMLInputElement;
let apiKeyElevenlabs: HTMLInputElement;
let badgeActive: HTMLSpanElement;
let badgeElevenlabs: HTMLSpanElement;
let apikeyGroups: NodeListOf<HTMLDivElement>;
let geminiGetKeyBtn: HTMLButtonElement;
let utilityProviderSelect: HTMLSelectElement;
let utilityModelSelect: HTMLSelectElement;

// Provider → config key mapping for badge updates
const PROVIDER_KEY_MAP: Record<string, { hasKey: string; fromEnv: string }> = {
  claude:   { hasKey: 'hasAnthropicKey', fromEnv: 'anthropicFromEnv' },
  openai:   { hasKey: 'hasOpenaiKey',    fromEnv: 'openaiFromEnv' },
  gemini:   { hasKey: 'hasGoogleKey',    fromEnv: 'googleFromEnv' },
  groq:     { hasKey: 'hasGroqKey',      fromEnv: 'groqFromEnv' },
  deepseek: { hasKey: 'hasDeepseekKey',  fromEnv: 'deepseekFromEnv' },
};

let _configExtendedCache: Record<string, any> = {};

function populateModelSelect(selectEl: HTMLSelectElement, provider: string) {
  const models = modelRegistry[provider] || [];
  selectEl.innerHTML = '';
  models.forEach(m => {
    const opt = document.createElement('option');
    opt.value = m.id;
    opt.textContent = m.label + (m.multiModal ? ' 🖼️' : '');
    selectEl.appendChild(opt);
  });
}

async function updateApiKeyBadges() {
  try {
    _configExtendedCache = await platform.getConfigExtended();
    updateActiveBadge();
    const savedKeys = _configExtendedCache['savedApiKeys'] || {};
    document.querySelectorAll<HTMLInputElement>('.generic-api-key').forEach(input => {
      const key = input.dataset.configKey;
      if (key && savedKeys[key] && !input.value) {
        input.value = savedKeys[key];
      }
    });
  } catch (err) {
    console.warn('API key badge update failed:', err);
  }
}

function updateActiveBadge() {
  const provider = llmProviderSelect.value;
  const map = PROVIDER_KEY_MAP[provider];

  if (map) {
    const hasKey = !!_configExtendedCache[map.hasKey];
    const fromEnv = !!_configExtendedCache[map.fromEnv];
    if (provider === 'gemini' && _configExtendedCache['googleOAuth'] && !fromEnv) {
      badgeActive.className = 'key-badge set';
      badgeActive.textContent = 'OAuth';
    } else {
      setBadge(badgeActive, hasKey, fromEnv);
    }
  } else {
    const localProviders = ['ollama', 'vllm', 'sglang'];
    if (localProviders.includes(provider)) {
      badgeActive.className = 'key-badge set';
      badgeActive.textContent = t('settings.llm.apikey.local');
    } else {
      const savedKeys = _configExtendedCache['savedApiKeys'] || {};
      const apikeyGroup = document.getElementById(`apikey-${provider}`);
      const input = apikeyGroup?.querySelector('.generic-api-key') as HTMLInputElement | null;
      const configKey = input?.dataset.configKey || '';
      const hasKey = !!(configKey && savedKeys[configKey]);
      setBadge(badgeActive, hasKey, false);
    }
  }

  const hasElevenlabsKey = !!_configExtendedCache['hasElevenlabsKey'];
  const elevenlabsFromEnv = !!_configExtendedCache['elevenlabsFromEnv'];
  setBadge(badgeElevenlabs, hasElevenlabsKey, elevenlabsFromEnv);
}

function setBadge(badge: HTMLSpanElement, hasKey: boolean, fromEnv: boolean) {
  if (fromEnv) {
    badge.className = 'key-badge env';
    badge.textContent = t('settings.llm.apikey.env');
  } else if (hasKey) {
    badge.className = 'key-badge set';
    badge.textContent = t('settings.llm.apikey.set');
  } else {
    badge.className = 'key-badge unset';
    badge.textContent = t('settings.llm.apikey.unset');
  }
}

function showActiveApiKeyGroup(provider: string) {
  apikeyGroups.forEach(g => {
    g.style.display = g.dataset.provider === provider ? 'block' : 'none';
  });
  updateActiveBadge();
}

export async function initTab(settings: Settings): Promise<void> {
  // Get DOM elements
  llmProviderSelect = document.getElementById('llm-provider') as HTMLSelectElement;
  llmModelSelect = document.getElementById('llm-model') as HTMLSelectElement;
  llmMaxTokensInput = document.getElementById('llm-max-tokens') as HTMLInputElement;
  llmMaxTokensNumInput = document.getElementById('llm-max-tokens-num') as HTMLInputElement;
  apiKeyClaude = document.getElementById('api-key-claude') as HTMLInputElement;
  apiKeyOpenai = document.getElementById('api-key-openai') as HTMLInputElement;
  apiKeyGoogle = document.getElementById('api-key-google') as HTMLInputElement;
  apiKeyGroq = document.getElementById('api-key-groq') as HTMLInputElement;
  apiKeyDeepseek = document.getElementById('api-key-deepseek') as HTMLInputElement;
  apiKeyElevenlabs = document.getElementById('api-key-elevenlabs') as HTMLInputElement;
  badgeActive = document.getElementById('badge-active') as HTMLSpanElement;
  badgeElevenlabs = document.getElementById('badge-elevenlabs') as HTMLSpanElement;
  apikeyGroups = document.querySelectorAll<HTMLDivElement>('.apikey-group');
  geminiGetKeyBtn = document.getElementById('gemini-get-key-btn') as HTMLButtonElement;
  utilityProviderSelect = document.getElementById('utility-provider') as HTMLSelectElement;
  utilityModelSelect = document.getElementById('utility-model') as HTMLSelectElement;

  // ---- LLM ----
  const provider = settings.llm?.provider ?? 'claude';
  llmProviderSelect.value = provider;
  populateModelSelect(llmModelSelect, provider);
  llmModelSelect.value = settings.llm?.model ?? '';
  if (!llmModelSelect.value && llmModelSelect.options.length > 0) {
    llmModelSelect.selectedIndex = 0;
  }

  const maxTokensVal = String(settings.llm?.maxTokens ?? 512);
  llmMaxTokensInput.value = maxTokensVal;
  llmMaxTokensNumInput.value = maxTokensVal;

  showActiveApiKeyGroup(provider);

  llmProviderSelect.addEventListener('change', () => {
    populateModelSelect(llmModelSelect, llmProviderSelect.value);
    showActiveApiKeyGroup(llmProviderSelect.value);
  });

  // Utility LLM
  const utilProvider = settings.llm?.utilityProvider ?? 'openai';
  utilityProviderSelect.value = utilProvider;
  populateModelSelect(utilityModelSelect, utilProvider);
  utilityModelSelect.value = settings.llm?.utilityModel ?? '';
  if (!utilityModelSelect.value && utilityModelSelect.options.length > 0) {
    utilityModelSelect.selectedIndex = 0;
  }
  utilityProviderSelect.addEventListener('change', () => {
    populateModelSelect(utilityModelSelect, utilityProviderSelect.value);
  });

  syncSliders('llm-max-tokens', 'llm-max-tokens-num');

  // API key badges
  await updateApiKeyBadges();

  // Gemini key button
  geminiGetKeyBtn.addEventListener('click', () => {
    window.open('https://aistudio.google.com/apikey', '_blank');
  });
}

export function collectSettings(settings: Settings): void {
  settings.llm.provider = llmProviderSelect.value as LLMProvider;
  settings.llm.model = llmModelSelect.value;
  settings.llm.maxTokens = parseInt(llmMaxTokensNumInput.value) || 512;
  settings.llm.utilityProvider = utilityProviderSelect.value as LLMProvider;
  settings.llm.utilityModel = utilityModelSelect.value;
}

/** Save API keys via saveConfigExtended (separate from settings) */
export async function saveApiKeys(): Promise<void> {
  const apiKeys: Record<string, string> = {};
  if (apiKeyClaude.value.trim()) apiKeys.anthropicApiKey = apiKeyClaude.value.trim();
  if (apiKeyOpenai.value.trim()) apiKeys.openaiApiKey = apiKeyOpenai.value.trim();
  if (apiKeyGoogle.value.trim()) apiKeys.googleApiKey = apiKeyGoogle.value.trim();
  if (apiKeyGroq.value.trim()) apiKeys.groqApiKey = apiKeyGroq.value.trim();
  if (apiKeyDeepseek.value.trim()) apiKeys.deepseekApiKey = apiKeyDeepseek.value.trim();
  if (apiKeyElevenlabs.value.trim()) apiKeys.elevenlabsApiKey = apiKeyElevenlabs.value.trim();
  // 汎用APIキー（新プロバイダー群）
  document.querySelectorAll<HTMLInputElement>('.generic-api-key').forEach(input => {
    const key = input.dataset.configKey;
    if (key && input.value.trim()) {
      apiKeys[key] = input.value.trim();
    }
  });
  if (Object.keys(apiKeys).length > 0) {
    await platform.saveConfigExtended(apiKeys);
  }

  // Update badges and clear inputs
  await updateApiKeyBadges();
  apiKeyClaude.value = '';
  apiKeyOpenai.value = '';
  apiKeyGoogle.value = '';
  apiKeyGroq.value = '';
  apiKeyDeepseek.value = '';
  apiKeyElevenlabs.value = '';
}
