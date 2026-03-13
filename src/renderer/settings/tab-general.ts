import { platform } from '../platform';
// Settings > General + Home tab
import type { Settings } from '../types';
import { t } from '../locales';
import { modalConfirm, showToast, showStatus } from './shared';

// DOM elements (initialized in initTab)
let themeSelect: HTMLSelectElement;
let proactiveEnabledInput: HTMLInputElement;
let proactiveOnStartupInput: HTMLInputElement;
let quietHoursEnabledInput: HTMLInputElement;
let quietHoursTimeDiv: HTMLDivElement;
let quietHoursStartSelect: HTMLSelectElement;
let quietHoursEndSelect: HTMLSelectElement;
let segmentSplitEnabledInput: HTMLInputElement;
let memorySearchEnabledInput: HTMLInputElement;
let memoryVectorEnabledInput: HTMLInputElement;
let exportDataBtn: HTMLButtonElement;
let importDataBtn: HTMLButtonElement;
let checkUpdateBtn: HTMLButtonElement;
let appVersionEl: HTMLSpanElement;
let updateResultEl: HTMLDivElement;
let broadcastModeEnabled: HTMLInputElement;
let broadcastSettingsGroup: HTMLDivElement;
let broadcastCommentSource: HTMLSelectElement;
let broadcastYoutubeGroup: HTMLDivElement;
let broadcastYoutubeId: HTMLInputElement;
let broadcastOnecommeGroup: HTMLDivElement;
let broadcastOnecommePort: HTMLInputElement;
let broadcastIdleEnabledInput: HTMLInputElement;
let broadcastIdleInterval: HTMLInputElement;
let broadcastIdleIntervalVal: HTMLSpanElement;
let broadcastTestBtn: HTMLButtonElement;
let broadcastTestResult: HTMLDivElement;
let broadcastNgWords: HTMLTextAreaElement;
let broadcastSoftblockWords: HTMLTextAreaElement;
let broadcastCustomInstructions: HTMLTextAreaElement;
let historyTurnsInput: HTMLInputElement;
let historyTurnsVal: HTMLSpanElement;
let proactiveFreqSlider: HTMLInputElement;
let proactiveFreqVal: HTMLSpanElement;
let proactiveFreqHint: HTMLDivElement;
let windowModeSelect: HTMLSelectElement;
export let originalWindowMode = 'desktop';

const PROACTIVE_LEVELS = [
  { label: 'settings.general.proactive.level0', hint: 'settings.general.proactive.level0hint' },
  { label: 'settings.general.proactive.level1', hint: 'settings.general.proactive.level1hint' },
  { label: 'settings.general.proactive.level2', hint: 'settings.general.proactive.level2hint' },
  { label: 'settings.general.proactive.level3', hint: 'settings.general.proactive.level3hint' },
];

function updateProactiveFreqLabel(level: number) {
  const entry = PROACTIVE_LEVELS[level] ?? PROACTIVE_LEVELS[1];
  if (proactiveFreqVal) proactiveFreqVal.textContent = t(entry.label);
  if (proactiveFreqHint) proactiveFreqHint.textContent = t(entry.hint);
}

function applyTheme(theme: string) {
  document.documentElement.setAttribute('data-theme', theme);
}

export async function initTab(settings: Settings): Promise<void> {
  // Get DOM elements
  themeSelect = document.getElementById('theme-select') as HTMLSelectElement;
  proactiveEnabledInput = document.getElementById('proactive-enabled') as HTMLInputElement;
  proactiveOnStartupInput = document.getElementById('proactive-on-startup') as HTMLInputElement;
  quietHoursEnabledInput = document.getElementById('quiet-hours-enabled') as HTMLInputElement;
  quietHoursTimeDiv = document.getElementById('quiet-hours-time') as HTMLDivElement;
  quietHoursStartSelect = document.getElementById('quiet-hours-start') as HTMLSelectElement;
  quietHoursEndSelect = document.getElementById('quiet-hours-end') as HTMLSelectElement;
  segmentSplitEnabledInput = document.getElementById('segment-split-enabled') as HTMLInputElement;
  memorySearchEnabledInput = document.getElementById('memory-search-enabled') as HTMLInputElement;
  memoryVectorEnabledInput = document.getElementById('memory-vector-enabled') as HTMLInputElement;
  exportDataBtn = document.getElementById('export-data-btn') as HTMLButtonElement;
  importDataBtn = document.getElementById('import-data-btn') as HTMLButtonElement;
  checkUpdateBtn = document.getElementById('check-update-btn') as HTMLButtonElement;
  appVersionEl = document.getElementById('app-version') as HTMLSpanElement;
  updateResultEl = document.getElementById('update-result') as HTMLDivElement;
  broadcastModeEnabled = document.getElementById('broadcast-mode-enabled') as HTMLInputElement;
  broadcastSettingsGroup = document.getElementById('broadcast-settings-group') as HTMLDivElement;
  broadcastCommentSource = document.getElementById('broadcast-comment-source') as HTMLSelectElement;
  broadcastYoutubeGroup = document.getElementById('broadcast-youtube-group') as HTMLDivElement;
  broadcastYoutubeId = document.getElementById('broadcast-youtube-id') as HTMLInputElement;
  broadcastOnecommeGroup = document.getElementById('broadcast-onecomme-group') as HTMLDivElement;
  broadcastOnecommePort = document.getElementById('broadcast-onecomme-port') as HTMLInputElement;
  broadcastIdleEnabledInput = document.getElementById('broadcast-idle-enabled') as HTMLInputElement;
  broadcastIdleInterval = document.getElementById('broadcast-idle-interval') as HTMLInputElement;
  broadcastIdleIntervalVal = document.getElementById('broadcast-idle-interval-val') as HTMLSpanElement;
  broadcastTestBtn = document.getElementById('broadcast-test-btn') as HTMLButtonElement;
  broadcastTestResult = document.getElementById('broadcast-test-result') as HTMLDivElement;
  broadcastNgWords = document.getElementById('broadcast-ng-words') as HTMLTextAreaElement;
  broadcastSoftblockWords = document.getElementById('broadcast-softblock-words') as HTMLTextAreaElement;
  broadcastCustomInstructions = document.getElementById('broadcast-custom-instructions') as HTMLTextAreaElement;
  historyTurnsInput = document.getElementById('history-turns') as HTMLInputElement;
  historyTurnsVal = document.getElementById('history-turns-val') as HTMLSpanElement;
  proactiveFreqSlider = document.getElementById('persona-proactive-freq') as HTMLInputElement;
  proactiveFreqVal = document.getElementById('persona-proactive-freq-val') as HTMLSpanElement;
  proactiveFreqHint = document.getElementById('persona-proactive-freq-hint') as HTMLDivElement;

  // ---- Window Mode ----
  windowModeSelect = document.getElementById('window-mode') as HTMLSelectElement;
  if (windowModeSelect) {
    windowModeSelect.value = settings.windowMode || 'desktop';
    originalWindowMode = windowModeSelect.value;
  }

  // ---- Theme ----
  const theme = settings.theme ?? 'system';
  themeSelect.value = theme;
  applyTheme(theme);
  themeSelect.addEventListener('change', () => applyTheme(themeSelect.value));

  // ---- General ----
  proactiveEnabledInput.checked = settings.proactive?.enabled ?? true;
  proactiveOnStartupInput.checked = settings.proactive?.onStartup ?? false;
  segmentSplitEnabledInput.checked = settings.chat?.segmentSplit ?? false;

  // ---- Memory toggles ----
  memorySearchEnabledInput.checked = settings.memory?.searchEnabled ?? false;
  memoryVectorEnabledInput.checked = settings.memory?.vectorSearchEnabled ?? false;

  // ---- おやすみモード ----
  for (let h = 0; h <= 23; h++) {
    const label = `${h.toString().padStart(2, '0')}:00`;
    const optStart = document.createElement('option');
    optStart.value = String(h);
    optStart.textContent = label;
    quietHoursStartSelect.appendChild(optStart);
    const optEnd = document.createElement('option');
    optEnd.value = String(h);
    optEnd.textContent = label;
    quietHoursEndSelect.appendChild(optEnd);
  }
  const quietEnabled = settings.proactive?.quietHoursEnabled ?? false;
  quietHoursEnabledInput.checked = quietEnabled;
  quietHoursTimeDiv.style.display = quietEnabled ? 'block' : 'none';
  quietHoursStartSelect.value = String(settings.proactive?.quietHoursStart ?? 23);
  quietHoursEndSelect.value = String(settings.proactive?.quietHoursEnd ?? 7);
  quietHoursEnabledInput.addEventListener('change', () => {
    quietHoursTimeDiv.style.display = quietHoursEnabledInput.checked ? 'block' : 'none';
  });

  // ---- Persona Sliders ----
  const persona = settings.persona || { proactiveFrequency: 1 };
  const level = persona.proactiveFrequency ?? 1;
  proactiveFreqSlider.value = String(level);
  updateProactiveFreqLabel(level);
  proactiveFreqSlider.addEventListener('input', () => {
    updateProactiveFreqLabel(parseInt(proactiveFreqSlider.value));
  });

  // ---- Broadcast Mode ----
  const streaming = settings.streaming;
  broadcastModeEnabled.checked = streaming?.broadcastMode ?? false;
  broadcastCommentSource.value = streaming?.commentSource || 'none';
  broadcastYoutubeId.value = streaming?.youtube?.videoId || '';
  broadcastOnecommePort.value = String(streaming?.onecomme?.port || 11180);
  broadcastIdleEnabledInput.checked = streaming?.broadcastIdle?.enabled ?? true;
  broadcastIdleInterval.value = String(streaming?.broadcastIdle?.intervalSeconds || 30);
  broadcastIdleIntervalVal.textContent = `${streaming?.broadcastIdle?.intervalSeconds || 30}${t('settings.footer.idleIntervalSuffix')}`;
  broadcastNgWords.value = (streaming?.safety?.customNgWords || []).join('\n');
  broadcastSoftblockWords.value = (streaming?.safety?.customSoftblockWords || []).join('\n');
  broadcastCustomInstructions.value = streaming?.customInstructions || '';

  const updateBroadcastVisibility = () => {
    broadcastSettingsGroup.style.display = broadcastModeEnabled.checked ? '' : 'none';
    const src = broadcastCommentSource.value;
    broadcastYoutubeGroup.style.display = src === 'youtube' ? '' : 'none';
    broadcastOnecommeGroup.style.display = src === 'onecomme' ? '' : 'none';
  };
  updateBroadcastVisibility();
  broadcastModeEnabled.addEventListener('change', updateBroadcastVisibility);
  broadcastCommentSource.addEventListener('change', updateBroadcastVisibility);
  broadcastIdleInterval.addEventListener('input', () => {
    broadcastIdleIntervalVal.textContent = `${broadcastIdleInterval.value}${t('settings.footer.idleIntervalSuffix')}`;
  });

  // 接続テスト
  broadcastTestBtn.addEventListener('click', async () => {
    broadcastTestResult.textContent = t('common.testing');
    broadcastTestResult.style.color = '';
    try {
      const src = broadcastCommentSource.value;
      let result: { success: boolean; error?: string };
      if (src === 'youtube') {
        result = await platform.streamingTestYoutube(broadcastYoutubeId.value);
      } else if (src === 'onecomme') {
        result = await platform.streamingTestOnecomme(parseInt(broadcastOnecommePort.value));
      } else {
        broadcastTestResult.textContent = t('settings.streaming.broadcast.selectSource');
        broadcastTestResult.style.color = '#e74c3c';
        return;
      }
      broadcastTestResult.textContent = result.success ? t('settings.streaming.broadcast.connectionOk') : t('settings.streaming.broadcast.failPrefix', { error: result.error || '' });
      broadcastTestResult.style.color = result.success ? '#2ecc71' : '#e74c3c';
    } catch (err: any) {
      broadcastTestResult.textContent = t('settings.streaming.broadcast.errorPrefix', { error: err.message });
      broadcastTestResult.style.color = '#e74c3c';
    }
  });

  // ---- Data Export/Import ----
  exportDataBtn.addEventListener('click', async () => {
    exportDataBtn.disabled = true;
    exportDataBtn.textContent = t('settings.general.data.exporting');
    try {
      const result = await platform.exportData();
      if (result.success) {
        showToast(t('settings.general.data.exportDone', { path: result.filePath || '' }));
      } else if (result.error !== t('settings.general.data.cancelled')) {
        showStatus(t('settings.general.data.exportFailed', { error: result.error || '' }), 'error');
      }
    } catch (e) {
      showStatus(t('settings.general.data.exportError'), 'error');
    }
    exportDataBtn.disabled = false;
    exportDataBtn.innerHTML = t('settings.general.data.exportBtn');
  });

  importDataBtn.addEventListener('click', async () => {
    if (!await modalConfirm(t('settings.general.data.importConfirm'))) return;
    importDataBtn.disabled = true;
    importDataBtn.textContent = t('settings.general.data.importing');
    try {
      const result = await platform.importData();
      if (result.success) {
        showToast(t('settings.general.data.importDone'));
        setTimeout(() => platform.restartApp(), 1500);
      } else if (result.error !== t('settings.general.data.cancelled')) {
        showStatus(t('settings.general.data.importFailed', { error: result.error || '' }), 'error');
      }
    } catch (e) {
      showStatus(t('settings.general.data.importError'), 'error');
    }
    importDataBtn.disabled = false;
    importDataBtn.innerHTML = t('settings.general.data.importBtn');
  });

  // ---- Update Check ----
  try {
    const ver = await platform.getAppVersion();
    appVersionEl.textContent = `v${ver}`;
  } catch { appVersionEl.textContent = 'v???'; }

  checkUpdateBtn.addEventListener('click', async () => {
    checkUpdateBtn.disabled = true;
    checkUpdateBtn.textContent = t('settings.general.update.checking');
    updateResultEl.textContent = '';
    try {
      const result = await platform.checkForUpdates();
      if (result.error) {
        updateResultEl.textContent = result.error;
        updateResultEl.style.color = 'var(--text-secondary)';
      } else if (result.hasUpdate) {
        updateResultEl.innerHTML = `🆕 ${t('settings.general.update.available', { version: result.latestVersion || '' })} <a href="#" id="update-link" style="color:var(--accent);">${t('settings.general.update.openRelease')}</a>`;
        const link = document.getElementById('update-link');
        if (link && result.releaseUrl) {
          link.addEventListener('click', (e) => {
            e.preventDefault();
            window.open(result.releaseUrl!, '_blank');
          });
        }
      } else {
        updateResultEl.textContent = `✅ ${t('settings.general.update.upToDate')}`;
        updateResultEl.style.color = 'var(--success)';
      }
    } catch {
      updateResultEl.textContent = t('settings.general.update.failed');
      updateResultEl.style.color = 'var(--danger)';
    }
    checkUpdateBtn.disabled = false;
    checkUpdateBtn.textContent = t('settings.general.update.check');
  });

  // ---- LLM History Turns ----
  const historyTurnsVal2 = settings.limits?.historyTurns ?? 20;
  historyTurnsInput.value = String(historyTurnsVal2);
  historyTurnsVal.textContent = String(historyTurnsVal2);
  historyTurnsInput.addEventListener('input', () => {
    historyTurnsVal.textContent = historyTurnsInput.value;
  });
}

export function collectSettings(settings: Settings): void {
  settings.theme = themeSelect.value as 'light' | 'dark' | 'system';
  if (windowModeSelect) {
    settings.windowMode = windowModeSelect.value as 'desktop' | 'docked';
  }

  if (settings.proactive) {
    settings.proactive.enabled = proactiveEnabledInput.checked;
    settings.proactive.onStartup = proactiveOnStartupInput.checked;
    settings.proactive.quietHoursEnabled = quietHoursEnabledInput.checked;
    settings.proactive.quietHoursStart = parseInt(quietHoursStartSelect.value);
    settings.proactive.quietHoursEnd = parseInt(quietHoursEndSelect.value);
  }

  settings.limits = {
    historyTurns: parseInt(historyTurnsInput.value) || 20,
    summaryThreshold: settings.limits?.summaryThreshold ?? 20
  };

  settings.chat = {
    segmentSplit: segmentSplitEnabledInput.checked
  };

  settings.memory = {
    searchEnabled: memorySearchEnabledInput.checked,
    vectorSearchEnabled: memoryVectorEnabledInput.checked,
  };

  // Persona sliders
  const proactiveLevel = parseInt(proactiveFreqSlider.value) || 1;
  settings.persona = {
    proactiveFrequency: proactiveLevel
  };
}

// Export for use in save (broadcast fields used in streaming save)
export function getBroadcastState() {
  return {
    broadcastModeEnabled: broadcastModeEnabled?.checked ?? false,
    broadcastCommentSource: broadcastCommentSource?.value || 'none',
    broadcastYoutubeId: broadcastYoutubeId?.value || '',
    broadcastOnecommePort: broadcastOnecommePort?.value || '11180',
    broadcastIdleEnabled: broadcastIdleEnabledInput?.checked ?? true,
    broadcastIdleInterval: broadcastIdleInterval?.value || '30',
    broadcastNgWords: broadcastNgWords?.value || '',
    broadcastSoftblockWords: broadcastSoftblockWords?.value || '',
    broadcastCustomInstructions: broadcastCustomInstructions?.value || '',
  };
}

