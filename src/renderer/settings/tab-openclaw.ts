import { platform } from '../platform';
// Settings > OpenClaw tab
import type { Settings } from '../types';
import { t } from '../locales';
import { syncSliders } from './shared';

let openclawEnabledInput: HTMLInputElement;
let openclawDetailsDiv: HTMLDivElement;
let openclawGatewayUrlInput: HTMLInputElement;
let openclawTokenInput: HTMLInputElement;
let openclawAgentIdInput: HTMLInputElement;
let openclawMaxTokensInput: HTMLInputElement;
let openclawMaxTokensNumInput: HTMLInputElement;
let openclawTestBtn: HTMLButtonElement;
let openclawStatusSpan: HTMLSpanElement;

function updateOpenclawVisibility() {
  openclawDetailsDiv.style.display = openclawEnabledInput.checked ? 'block' : 'none';
}

async function testOpenclawConnection() {
  openclawStatusSpan.textContent = t('common.testing');
  openclawStatusSpan.style.color = 'var(--text-muted)';
  try {
    const result = await platform.openclawTest({
      gatewayUrl: openclawGatewayUrlInput.value || 'http://127.0.0.1:18789',
      token: openclawTokenInput.value,
      agentId: openclawAgentIdInput.value || 'main'
    });
    if (result.success) {
      openclawStatusSpan.textContent = `✅ ${t('common.success')}`;
      openclawStatusSpan.style.color = 'var(--success)';
    } else {
      openclawStatusSpan.textContent = `❌ ${result.error || t('common.failed')}`;
      openclawStatusSpan.style.color = 'var(--danger)';
    }
  } catch (err) {
    openclawStatusSpan.textContent = `❌ ${t('common.error')}: ${err}`;
    openclawStatusSpan.style.color = 'var(--danger)';
  }
}

export function initTab(settings: Settings): void {
  openclawEnabledInput = document.getElementById('openclaw-enabled') as HTMLInputElement;
  openclawDetailsDiv = document.getElementById('openclaw-details') as HTMLDivElement;
  openclawGatewayUrlInput = document.getElementById('openclaw-gateway-url') as HTMLInputElement;
  openclawTokenInput = document.getElementById('openclaw-token') as HTMLInputElement;
  openclawAgentIdInput = document.getElementById('openclaw-agent-id') as HTMLInputElement;
  openclawMaxTokensInput = document.getElementById('openclaw-max-tokens') as HTMLInputElement;
  openclawMaxTokensNumInput = document.getElementById('openclaw-max-tokens-num') as HTMLInputElement;
  openclawTestBtn = document.getElementById('openclaw-test-btn') as HTMLButtonElement;
  openclawStatusSpan = document.getElementById('openclaw-status') as HTMLSpanElement;

  openclawEnabledInput.checked = settings.openclaw?.enabled ?? false;
  openclawGatewayUrlInput.value = settings.openclaw?.gatewayUrl ?? 'http://127.0.0.1:18789';
  openclawTokenInput.value = settings.openclaw?.token ?? '';
  openclawAgentIdInput.value = settings.openclaw?.agentId ?? 'main';
  const ocMaxTokens = String(settings.openclaw?.maxTokens ?? 2048);
  openclawMaxTokensInput.value = ocMaxTokens;
  openclawMaxTokensNumInput.value = ocMaxTokens;
  updateOpenclawVisibility();
  openclawEnabledInput.addEventListener('change', updateOpenclawVisibility);
  openclawTestBtn.addEventListener('click', testOpenclawConnection);
  syncSliders('openclaw-max-tokens', 'openclaw-max-tokens-num');
}

export function collectSettings(settings: Settings): void {
  settings.openclaw = {
    enabled: openclawEnabledInput.checked,
    gatewayUrl: openclawGatewayUrlInput.value || 'http://127.0.0.1:18789',
    token: openclawTokenInput.value,
    agentId: openclawAgentIdInput.value || 'main',
    agentMode: settings.openclaw?.agentMode ?? false,
    maxTokens: parseInt(openclawMaxTokensNumInput.value) || 2048
  };
}
