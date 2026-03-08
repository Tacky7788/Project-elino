import { platform } from './platform';
// Settings screen entry point (sidebar layout)
// Each tab's logic is in settings/tab-*.ts

import type { Settings } from './types';
import './types'; // Import for global type declaration
import { initI18n, applyDOMTranslations, switchLocale, getLocale } from './locales';
import type { Locale } from './locales';
import {
  setCurrentSettings, setModelRegistry,
  modalConfirm, showToast, showStatus, applyPreview,
} from './settings/shared';

// Tab modules
import * as tabGeneral from './settings/tab-general';
import * as tabLlm from './settings/tab-llm';
import * as tabTts from './settings/tab-tts';
import * as tabCharacter from './settings/tab-character';
import * as tabPersonality from './settings/tab-personality';
import * as tabOpenclaw from './settings/tab-openclaw';
import * as tabMemory from './settings/tab-memory';
import * as tabExtras from './settings/tab-extras';

import { t } from './locales';

// ====== DOM Elements (navigation + footer only) ======
const sidebarBtns = document.querySelectorAll<HTMLButtonElement>('.sidebar-btn');
const tabPanels = document.querySelectorAll<HTMLDivElement>('.tab-panel');
const settingsLayout = document.querySelector('.settings-layout') as HTMLDivElement;
const saveBtn = document.getElementById('save-btn') as HTMLButtonElement;
const cancelBtn = document.getElementById('cancel-btn') as HTMLButtonElement;
const resetBtn = document.getElementById('reset-btn') as HTMLButtonElement;

// ====== Navigation (Card Home + Sidebar) ======

function navigateToTab(tabId: string) {
  tabPanels.forEach(p => p.classList.remove('active'));
  const panel = document.getElementById(`tab-${tabId}`);
  if (panel) panel.classList.add('active');
  sidebarBtns.forEach(b => {
    b.classList.remove('active');
    b.setAttribute('aria-selected', 'false');
    if (b.dataset.tab === tabId) {
      b.classList.add('active');
      b.setAttribute('aria-selected', 'true');
    }
  });
  settingsLayout.classList.remove('home-mode');
  const content = document.querySelector('.content');
  if (content) content.scrollTop = 0;
  if (tabId === 'character') requestAnimationFrame(() => tabCharacter.refreshDragPadCursor());
}

function navigateToHome() {
  tabPanels.forEach(p => p.classList.remove('active'));
  const homePanel = document.getElementById('tab-home');
  if (homePanel) homePanel.classList.add('active');
  settingsLayout.classList.add('home-mode');
  sidebarBtns.forEach(b => {
    b.classList.remove('active');
    b.setAttribute('aria-selected', 'false');
  });
  const content = document.querySelector('.content');
  if (content) content.scrollTop = 0;
}

function initSidebar() {
  settingsLayout.classList.add('home-mode');

  document.querySelectorAll<HTMLDivElement>('.settings-card').forEach(card => {
    card.addEventListener('click', () => {
      const target = card.dataset.target;
      if (target) navigateToTab(target);
    });
  });

  document.querySelectorAll<HTMLButtonElement>('.back-to-home').forEach(btn => {
    btn.addEventListener('click', () => navigateToHome());
  });

  sidebarBtns.forEach(btn => {
    btn.addEventListener('click', () => {
      const tabId = btn.dataset.tab;
      if (!tabId) return;
      navigateToTab(tabId);
    });
  });
}

// ====== Save ======

async function saveSettings() {
  let currentSettings: Settings | null = null;
  try {
    currentSettings = await platform.getSettings();
  } catch { return; }
  if (!currentSettings) return;

  try {
    // Save API keys (separate from settings)
    await tabLlm.saveApiKeys();

    // Collect from all tabs
    tabGeneral.collectSettings(currentSettings);
    tabLlm.collectSettings(currentSettings);
    tabTts.collectSettings(currentSettings);
    await tabCharacter.collectSettings(currentSettings);
    await tabPersonality.collectSettings(currentSettings);
    tabOpenclaw.collectSettings(currentSettings);
    tabMemory.collectSettings(currentSettings);
    tabExtras.collectSettings(currentSettings);

    // Save settings
    await platform.saveSettings(currentSettings);

    // Check if restart needed
    const { resolution: newResolution, modelType: newModelType } = tabCharacter.getRestartValues();
    const newSttEngine = tabExtras.getSttEngine();
    const newTtsEngine = tabTts.getTtsEngine();
    const needsRestart = newResolution !== tabCharacter.originalResolution
      || newSttEngine !== tabExtras.originalSttEngine
      || newTtsEngine !== tabTts.originalTtsEngine
      || newModelType !== tabCharacter.originalModelType;

    if (needsRestart) {
      const reasons = [];
      if (newResolution !== tabCharacter.originalResolution) reasons.push(t('settings.footer.reason.resolution'));
      if (newSttEngine !== tabExtras.originalSttEngine) reasons.push(t('settings.footer.reason.sttEngine'));
      if (newTtsEngine !== tabTts.originalTtsEngine) reasons.push(t('settings.footer.reason.ttsEngine'));
      if (newModelType !== tabCharacter.originalModelType) reasons.push(t('settings.footer.reason.modelType'));
      const shouldRestart = await modalConfirm(t('settings.footer.restartNeeded', { reasons: reasons.join('・') }));
      if (shouldRestart) {
        await platform.restartApp();
        return;
      } else {
        showStatus(t('settings.footer.savedPendingRestart'), 'success');
        showToast(t('settings.footer.saved'));
        return;
      }
    }

    // Apply character settings in real-time
    await platform.applyCharacterSettings(currentSettings.character);

    showStatus(t('settings.footer.saveDone'), 'success');
    showToast(t('settings.footer.saved'));

    // Save button success feedback
    saveBtn.classList.add('save-success');
    setTimeout(() => saveBtn.classList.remove('save-success'), 2000);
  } catch (err) {
    console.error('❌ 保存失敗:', err);
    showStatus(t('settings.footer.saveFailed'), 'error');
  }
}

// ====== Init ======

async function init() {
  // Initialize i18n before any UI rendering
  await initI18n();
  applyDOMTranslations();

  initSidebar();

  // Language selector handler
  const languageSelect = document.getElementById('language-select') as HTMLSelectElement | null;
  if (languageSelect) {
    languageSelect.value = getLocale();
    languageSelect.addEventListener('change', async () => {
      await switchLocale(languageSelect.value as Locale);
      await tabCharacter.rerenderDynamicUI();
    });
  }

  try {
    // Fetch model registry from main process
    const registry = await platform.getModelRegistry();
    setModelRegistry(registry);

    const settings: Settings = await platform.getSettings();
    setCurrentSettings(settings);

    // Initialize all tabs
    await tabGeneral.initTab(settings);
    await tabLlm.initTab(settings);
    await tabTts.initTab(settings);
    await tabCharacter.initTab(settings);
    await tabPersonality.initTab(settings);
    tabOpenclaw.initTab(settings);
    await tabMemory.initTab(settings);
    await tabExtras.initTab(settings);

    // ---- Footer ----
    saveBtn.addEventListener('click', saveSettings);
    cancelBtn.addEventListener('click', () => platform.closeSettingsWindow());
    resetBtn.addEventListener('click', async () => {
      if (!await modalConfirm(t('settings.footer.resetConfirm'))) return;
      await tabCharacter.resetToDefaults();
      await applyPreview();
      showStatus(t('settings.footer.resetDone'), 'success');
    });

    console.log('✅ 設定読み込み完了');
  } catch (err) {
    console.error('❌ 設定読み込み失敗:', err);
    showStatus(t('settings.footer.loadFailed'), 'error');
  }
}

init();
