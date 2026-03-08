import { platform } from '../platform';
// Settings > Extras tab (STT, Streaming, ClaudeCode, VRChat, SelfGrowth)
import type { Settings } from '../types';
import { t } from '../locales';
import { syncSliders } from './shared';
import { getBroadcastState } from './tab-general';

// STT DOM
let sttEnabledInput: HTMLInputElement;
let sttEngineSelect: HTMLSelectElement;
let sttWhisperModelGroup: HTMLDivElement;
let sttWhisperModelSelect: HTMLSelectElement;
let sttAutoSendInput: HTMLInputElement;
let sttAlwaysOnInput: HTMLInputElement;
let sttLangSelect: HTMLSelectElement;

// Streaming DOM
let streamingEnabledInput: HTMLInputElement;
let streamingDetailsDiv: HTMLDivElement;
let streamingSubtitleEnabledInput: HTMLInputElement;
let streamingSubtitleFontsizeInput: HTMLInputElement;
let streamingSubtitleFontsizeNumInput: HTMLInputElement;
let streamingSubtitleFadeInput: HTMLInputElement;
let streamingCommentSourceSelect: HTMLSelectElement;
let streamingYoutubeSettingsDiv: HTMLDivElement;
let streamingOnecommeSettingsDiv: HTMLDivElement;
let streamingYoutubeVideoIdInput: HTMLInputElement;
let streamingYoutubeTestBtn: HTMLButtonElement;
let streamingYoutubeStatusSpan: HTMLSpanElement;
let streamingOnecommePortInput: HTMLInputElement;
let streamingOnecommeTestBtn: HTMLButtonElement;
let streamingOnecommeStatusSpan: HTMLSpanElement;
let streamingFilterHashInput: HTMLInputElement;

// ClaudeCode DOM
let claudecodeEnabledInput: HTMLInputElement;

// External API DOM
let externalApiEnabledInput: HTMLInputElement;
let externalApiPortInput: HTMLInputElement;
let externalApiDetailsDiv: HTMLDivElement;

// Web Server DOM
let webServerEnabledInput: HTMLInputElement;
let webServerPortInput: HTMLInputElement;
let webServerDetailsDiv: HTMLDivElement;
let webServerUrlHint: HTMLDivElement;

// VRChat DOM
let vrchatEnabledInput: HTMLInputElement;
let vrchatDetailsDiv: HTMLDivElement;
let vrchatHostInput: HTMLInputElement;
let vrchatPortInput: HTMLInputElement;
let vrchatChatboxEnabledInput: HTMLInputElement;
let vrchatChatboxSoundInput: HTMLInputElement;
let vrchatExpressionSyncInput: HTMLInputElement;
let vrchatExpressionParamTypeSelect: HTMLSelectElement;
let vrchatMapHappyInput: HTMLInputElement;
let vrchatMapSadInput: HTMLInputElement;
let vrchatMapAnnoyedInput: HTMLInputElement;
let vrchatMapSurprisedInput: HTMLInputElement;
let vrchatMapThinkingInput: HTMLInputElement;
let vrchatMapNeutralInput: HTMLInputElement;
let vrchatTestBtn: HTMLButtonElement;
let vrchatOverlayBtn: HTMLButtonElement;
let vrchatStatusSpan: HTMLSpanElement;
let vrchatAudioDeviceSelect: HTMLSelectElement;
let vrchatRefreshDevicesBtn: HTMLButtonElement;
let vrchatAudioNotFound: HTMLDivElement;
let vrchatAudioFound: HTMLDivElement;
let vrchatAudioManual: HTMLDivElement;
let vrchatAudioIcon: HTMLSpanElement;
let vrchatAudioLabel: HTMLSpanElement;
let vrchatInstallVbcableBtn: HTMLButtonElement;
let vrchatRedetectBtn: HTMLButtonElement;
let vrchatRedetectFoundBtn: HTMLButtonElement;
let vrchatManualSelectBtn: HTMLButtonElement;
let vrchatAutoDetectBtn: HTMLButtonElement;

// SelfGrowth DOM
let selfGrowthEnabledInput: HTMLInputElement;
let selfGrowthDetailsDiv: HTMLDivElement;
let selfGrowthConfirmInput: HTMLInputElement;
let selfGrowthTraitsInput: HTMLInputElement;
let selfGrowthSpeechInput: HTMLInputElement;
let selfGrowthReactionsInput: HTMLInputElement;
let selfGrowthHistoryDiv: HTMLDivElement;

// State
export let originalSttEngine = 'whisper';
let _detectedVbCableId: string | null = null;
let _useManualSelect = false;

function updateSttWhisperModelVisibility() {
  sttWhisperModelGroup.style.display = sttEngineSelect.value === 'whisper' ? '' : 'none';
}

function updateStreamingVisibility() {
  streamingDetailsDiv.style.display = streamingEnabledInput.checked ? 'block' : 'none';
  updateStreamingSourceVisibility();
}

function updateStreamingSourceVisibility() {
  const source = streamingCommentSourceSelect.value;
  streamingYoutubeSettingsDiv.style.display = source === 'youtube' ? 'block' : 'none';
  streamingOnecommeSettingsDiv.style.display = source === 'onecomme' ? 'block' : 'none';
}

async function testYoutubeConnection() {
  streamingYoutubeStatusSpan.textContent = t('common.testing');
  streamingYoutubeStatusSpan.style.color = 'var(--text-muted)';
  try {
    const result = await platform.streamingTestYoutube(streamingYoutubeVideoIdInput.value);
    if (result.success) {
      streamingYoutubeStatusSpan.textContent = t('settings.streaming.youtube.successLive');
      streamingYoutubeStatusSpan.style.color = 'var(--success)';
    } else {
      streamingYoutubeStatusSpan.textContent = `❌ ${result.error || t('common.failed')}`;
      streamingYoutubeStatusSpan.style.color = 'var(--danger)';
    }
  } catch (err) {
    streamingYoutubeStatusSpan.textContent = `❌ ${t('common.error')}: ${err}`;
    streamingYoutubeStatusSpan.style.color = 'var(--danger)';
  }
}

async function testOnecommeConnection() {
  streamingOnecommeStatusSpan.textContent = t('common.testing');
  streamingOnecommeStatusSpan.style.color = 'var(--text-muted)';
  try {
    const port = parseInt(streamingOnecommePortInput.value) || 11180;
    const result = await platform.streamingTestOnecomme(port);
    if (result.success) {
      streamingOnecommeStatusSpan.textContent = `✅ ${t('common.success')}`;
      streamingOnecommeStatusSpan.style.color = 'var(--success)';
    } else {
      streamingOnecommeStatusSpan.textContent = `❌ ${result.error || t('common.failed')}`;
      streamingOnecommeStatusSpan.style.color = 'var(--danger)';
    }
  } catch (err) {
    streamingOnecommeStatusSpan.textContent = `❌ ${t('common.error')}: ${err}`;
    streamingOnecommeStatusSpan.style.color = 'var(--danger)';
  }
}

function updateWebServerHint() {
  if (webServerUrlHint && webServerPortInput) {
    const port = webServerPortInput.value || '3939';
    webServerUrlHint.textContent = `http://localhost:${port} ${t('settings.webServer.urlHint')}`;
  }
}

function updateVrchatVisibility() {
  vrchatDetailsDiv.style.display = vrchatEnabledInput.checked ? 'block' : 'none';
}

async function testVrchatConnection() {
  vrchatStatusSpan.textContent = t('common.testing');
  vrchatStatusSpan.style.color = 'var(--text-muted)';
  try {
    const result = await platform.vrchatTest();
    if (result.success) {
      vrchatStatusSpan.textContent = t('settings.openclaw.vrchat.testSuccess');
      vrchatStatusSpan.style.color = 'var(--success)';
    } else {
      vrchatStatusSpan.textContent = t('settings.openclaw.vrchat.testFailed');
      vrchatStatusSpan.style.color = 'var(--danger)';
    }
  } catch (err) {
    vrchatStatusSpan.textContent = `${t('common.error')}: ${err}`;
    vrchatStatusSpan.style.color = 'var(--danger)';
  }
}

async function detectVbCable(): Promise<{ found: boolean; deviceId: string; label: string }> {
  try {
    const devices = await navigator.mediaDevices.enumerateDevices();
    const outputs = devices.filter(d => d.kind === 'audiooutput');
    const cable = outputs.find(d => /cable/i.test(d.label));
    if (cable) return { found: true, deviceId: cable.deviceId, label: cable.label };
    return { found: false, deviceId: '', label: '' };
  } catch { return { found: false, deviceId: '', label: '' }; }
}

async function populateAudioDevices(selectedId?: string) {
  try {
    const devices = await navigator.mediaDevices.enumerateDevices();
    const outputs = devices.filter(d => d.kind === 'audiooutput');
    vrchatAudioDeviceSelect.innerHTML = `<option value="">${t('settings.openclaw.vrchat.defaultDevice')}</option>`;
    for (const d of outputs) {
      const opt = document.createElement('option');
      opt.value = d.deviceId;
      opt.textContent = d.label || t('settings.openclaw.vrchat.deviceFallback', { id: d.deviceId.substring(0, 8) });
      if (selectedId && d.deviceId === selectedId) opt.selected = true;
      vrchatAudioDeviceSelect.appendChild(opt);
    }
  } catch { /* ignore */ }
}

async function runVbCableSetup(savedDeviceId?: string) {
  if (_useManualSelect) {
    showAudioManualMode();
    await populateAudioDevices(savedDeviceId);
    return;
  }
  vrchatAudioIcon.textContent = '...';
  vrchatAudioLabel.textContent = t('settings.openclaw.vrchat.detecting');
  vrchatAudioNotFound.style.display = 'none';
  vrchatAudioFound.style.display = 'none';
  vrchatAudioManual.style.display = 'none';

  const result = await detectVbCable();
  if (result.found) {
    _detectedVbCableId = result.deviceId;
    vrchatAudioIcon.textContent = '\u2705';
    vrchatAudioLabel.textContent = t('settings.openclaw.vrchat.vbcableFound', { label: result.label });
    vrchatAudioLabel.style.color = 'var(--success)';
    vrchatAudioNotFound.style.display = 'none';
    vrchatAudioFound.style.display = 'block';
    vrchatAudioManual.style.display = 'none';
    vrchatAudioDeviceSelect.innerHTML = '';
    const opt = document.createElement('option');
    opt.value = result.deviceId;
    opt.textContent = result.label;
    opt.selected = true;
    vrchatAudioDeviceSelect.appendChild(opt);
  } else {
    _detectedVbCableId = null;
    vrchatAudioIcon.textContent = '\u26a0\ufe0f';
    vrchatAudioLabel.textContent = t('settings.openclaw.vrchat.vbcableNotFound');
    vrchatAudioLabel.style.color = 'var(--danger)';
    vrchatAudioNotFound.style.display = 'block';
    vrchatAudioFound.style.display = 'none';
    vrchatAudioManual.style.display = 'none';
    if (savedDeviceId) {
      showAudioManualMode();
      await populateAudioDevices(savedDeviceId);
    }
  }
}

function showAudioManualMode() {
  _useManualSelect = true;
  vrchatAudioIcon.textContent = '\ud83d\udd27';
  vrchatAudioLabel.textContent = t('settings.openclaw.vrchat.manualMode');
  vrchatAudioLabel.style.color = 'var(--text-secondary)';
  vrchatAudioNotFound.style.display = 'none';
  vrchatAudioFound.style.display = 'none';
  vrchatAudioManual.style.display = 'block';
}

export async function initTab(settings: Settings): Promise<void> {
  // STT
  sttEnabledInput = document.getElementById('stt-enabled') as HTMLInputElement;
  sttEngineSelect = document.getElementById('stt-engine') as HTMLSelectElement;
  sttWhisperModelGroup = document.getElementById('stt-whisper-model-group') as HTMLDivElement;
  sttWhisperModelSelect = document.getElementById('stt-whisper-model') as HTMLSelectElement;
  sttAutoSendInput = document.getElementById('stt-auto-send') as HTMLInputElement;
  sttAlwaysOnInput = document.getElementById('stt-always-on') as HTMLInputElement;
  sttLangSelect = document.getElementById('stt-lang') as HTMLSelectElement;

  sttEnabledInput.checked = settings.stt?.enabled ?? true;
  sttEngineSelect.value = settings.stt?.engine ?? 'whisper';
  originalSttEngine = sttEngineSelect.value;
  sttAutoSendInput.checked = settings.stt?.autoSend ?? false;
  sttAlwaysOnInput.checked = settings.stt?.alwaysOn ?? false;
  sttLangSelect.value = settings.stt?.lang ?? 'ja-JP';
  sttWhisperModelSelect.value = (settings.stt as any)?.whisperModel ?? 'whisper-1';
  updateSttWhisperModelVisibility();
  sttEngineSelect.addEventListener('change', updateSttWhisperModelVisibility);

  // Streaming
  streamingEnabledInput = document.getElementById('streaming-enabled') as HTMLInputElement;
  streamingDetailsDiv = document.getElementById('streaming-details') as HTMLDivElement;
  streamingSubtitleEnabledInput = document.getElementById('streaming-subtitle-enabled') as HTMLInputElement;
  streamingSubtitleFontsizeInput = document.getElementById('streaming-subtitle-fontsize') as HTMLInputElement;
  streamingSubtitleFontsizeNumInput = document.getElementById('streaming-subtitle-fontsize-num') as HTMLInputElement;
  streamingSubtitleFadeInput = document.getElementById('streaming-subtitle-fade') as HTMLInputElement;
  streamingCommentSourceSelect = document.getElementById('streaming-comment-source') as HTMLSelectElement;
  streamingYoutubeSettingsDiv = document.getElementById('streaming-youtube-settings') as HTMLDivElement;
  streamingOnecommeSettingsDiv = document.getElementById('streaming-onecomme-settings') as HTMLDivElement;
  streamingYoutubeVideoIdInput = document.getElementById('streaming-youtube-video-id') as HTMLInputElement;
  streamingYoutubeTestBtn = document.getElementById('streaming-youtube-test') as HTMLButtonElement;
  streamingYoutubeStatusSpan = document.getElementById('streaming-youtube-status') as HTMLSpanElement;
  streamingOnecommePortInput = document.getElementById('streaming-onecomme-port') as HTMLInputElement;
  streamingOnecommeTestBtn = document.getElementById('streaming-onecomme-test') as HTMLButtonElement;
  streamingOnecommeStatusSpan = document.getElementById('streaming-onecomme-status') as HTMLSpanElement;
  streamingFilterHashInput = document.getElementById('streaming-filter-hash') as HTMLInputElement;

  streamingEnabledInput.checked = settings.streaming?.enabled ?? false;
  streamingSubtitleEnabledInput.checked = settings.streaming?.subtitle?.enabled ?? true;
  const stFontSize = String(settings.streaming?.subtitle?.fontSize ?? 28);
  streamingSubtitleFontsizeInput.value = stFontSize;
  streamingSubtitleFontsizeNumInput.value = stFontSize;
  streamingSubtitleFadeInput.value = String(settings.streaming?.subtitle?.fadeAfterMs ?? 3000);
  streamingCommentSourceSelect.value = settings.streaming?.commentSource ?? 'none';
  streamingYoutubeVideoIdInput.value = settings.streaming?.youtube?.videoId ?? '';
  streamingOnecommePortInput.value = String(settings.streaming?.onecomme?.port ?? 11180);
  streamingFilterHashInput.checked = settings.streaming?.commentFilter?.ignoreHashPrefix ?? true;
  updateStreamingVisibility();
  streamingEnabledInput.addEventListener('change', updateStreamingVisibility);
  streamingCommentSourceSelect.addEventListener('change', updateStreamingSourceVisibility);
  streamingYoutubeTestBtn.addEventListener('click', testYoutubeConnection);
  streamingOnecommeTestBtn.addEventListener('click', testOnecommeConnection);
  syncSliders('streaming-subtitle-fontsize', 'streaming-subtitle-fontsize-num');

  // ClaudeCode
  claudecodeEnabledInput = document.getElementById('claudecode-enabled') as HTMLInputElement;
  claudecodeEnabledInput.checked = settings.claudeCode?.enabled ?? false;

  // External API
  externalApiEnabledInput = document.getElementById('external-api-enabled') as HTMLInputElement;
  externalApiPortInput = document.getElementById('external-api-port') as HTMLInputElement;
  externalApiDetailsDiv = document.getElementById('external-api-details') as HTMLDivElement;

  externalApiEnabledInput.checked = settings.externalApi?.enabled ?? false;
  externalApiPortInput.value = String(settings.externalApi?.port ?? 5174);
  externalApiDetailsDiv.style.display = externalApiEnabledInput.checked ? 'block' : 'none';

  externalApiEnabledInput.addEventListener('change', () => {
    externalApiDetailsDiv.style.display = externalApiEnabledInput.checked ? 'block' : 'none';
    platform.updateExternalApi({
      enabled: externalApiEnabledInput.checked,
      port: parseInt(externalApiPortInput.value) || 5174
    });
  });
  externalApiPortInput.addEventListener('change', () => {
    if (externalApiEnabledInput.checked) {
      platform.updateExternalApi({
        enabled: true,
        port: parseInt(externalApiPortInput.value) || 5174
      });
    }
  });

  // Web Server
  webServerEnabledInput = document.getElementById('web-server-enabled') as HTMLInputElement;
  webServerPortInput = document.getElementById('web-server-port') as HTMLInputElement;
  webServerDetailsDiv = document.getElementById('web-server-details') as HTMLDivElement;
  webServerUrlHint = document.getElementById('web-server-url-hint') as HTMLDivElement;

  if (webServerEnabledInput) {
    webServerEnabledInput.checked = (settings as any).webServer?.enabled ?? true;
    webServerPortInput.value = String((settings as any).webServer?.port ?? 3939);
    webServerDetailsDiv.style.display = webServerEnabledInput.checked ? 'block' : 'none';
    updateWebServerHint();

    webServerEnabledInput.addEventListener('change', () => {
      webServerDetailsDiv.style.display = webServerEnabledInput.checked ? 'block' : 'none';
    });
    webServerPortInput.addEventListener('change', updateWebServerHint);
  }

  // VRChat
  vrchatEnabledInput = document.getElementById('vrchat-enabled') as HTMLInputElement;
  vrchatDetailsDiv = document.getElementById('vrchat-details') as HTMLDivElement;
  vrchatHostInput = document.getElementById('vrchat-host') as HTMLInputElement;
  vrchatPortInput = document.getElementById('vrchat-port') as HTMLInputElement;
  vrchatChatboxEnabledInput = document.getElementById('vrchat-chatbox-enabled') as HTMLInputElement;
  vrchatChatboxSoundInput = document.getElementById('vrchat-chatbox-sound') as HTMLInputElement;
  vrchatExpressionSyncInput = document.getElementById('vrchat-expression-sync') as HTMLInputElement;
  vrchatExpressionParamTypeSelect = document.getElementById('vrchat-expression-param-type') as HTMLSelectElement;
  vrchatMapHappyInput = document.getElementById('vrchat-map-happy') as HTMLInputElement;
  vrchatMapSadInput = document.getElementById('vrchat-map-sad') as HTMLInputElement;
  vrchatMapAnnoyedInput = document.getElementById('vrchat-map-annoyed') as HTMLInputElement;
  vrchatMapSurprisedInput = document.getElementById('vrchat-map-surprised') as HTMLInputElement;
  vrchatMapThinkingInput = document.getElementById('vrchat-map-thinking') as HTMLInputElement;
  vrchatMapNeutralInput = document.getElementById('vrchat-map-neutral') as HTMLInputElement;
  vrchatTestBtn = document.getElementById('vrchat-test-btn') as HTMLButtonElement;
  vrchatOverlayBtn = document.getElementById('vrchat-overlay-btn') as HTMLButtonElement;
  vrchatStatusSpan = document.getElementById('vrchat-status') as HTMLSpanElement;
  vrchatAudioDeviceSelect = document.getElementById('vrchat-audio-device') as HTMLSelectElement;
  vrchatRefreshDevicesBtn = document.getElementById('vrchat-refresh-devices') as HTMLButtonElement;
  vrchatAudioNotFound = document.getElementById('vrchat-audio-not-found') as HTMLDivElement;
  vrchatAudioFound = document.getElementById('vrchat-audio-found') as HTMLDivElement;
  vrchatAudioManual = document.getElementById('vrchat-audio-manual') as HTMLDivElement;
  vrchatAudioIcon = document.getElementById('vrchat-audio-icon') as HTMLSpanElement;
  vrchatAudioLabel = document.getElementById('vrchat-audio-label') as HTMLSpanElement;
  vrchatInstallVbcableBtn = document.getElementById('vrchat-install-vbcable') as HTMLButtonElement;
  vrchatRedetectBtn = document.getElementById('vrchat-redetect-btn') as HTMLButtonElement;
  vrchatRedetectFoundBtn = document.getElementById('vrchat-redetect-found-btn') as HTMLButtonElement;
  vrchatManualSelectBtn = document.getElementById('vrchat-manual-select-btn') as HTMLButtonElement;
  vrchatAutoDetectBtn = document.getElementById('vrchat-auto-detect-btn') as HTMLButtonElement;

  const vrc = settings.vrchat ?? {} as any;
  vrchatEnabledInput.checked = vrc.enabled ?? false;
  vrchatHostInput.value = vrc.host ?? '127.0.0.1';
  vrchatPortInput.value = String(vrc.sendPort ?? 9000);
  vrchatChatboxEnabledInput.checked = vrc.chatbox?.enabled ?? true;
  vrchatChatboxSoundInput.checked = vrc.chatbox?.playSound ?? false;
  vrchatExpressionSyncInput.checked = vrc.expressionSync ?? true;
  vrchatExpressionParamTypeSelect.value = vrc.expressionParamType ?? 'bool';
  const em = vrc.expressionMap ?? {};
  vrchatMapHappyInput.value = em.happy ?? 'Expression_Happy';
  vrchatMapSadInput.value = em.sad ?? 'Expression_Sad';
  vrchatMapAnnoyedInput.value = em.annoyed ?? 'Expression_Angry';
  vrchatMapSurprisedInput.value = em.surprised ?? 'Expression_Surprised';
  vrchatMapThinkingInput.value = em.thinking ?? 'Expression_Thinking';
  vrchatMapNeutralInput.value = em.neutral ?? '';
  updateVrchatVisibility();
  runVbCableSetup(vrc.audioDeviceId);
  vrchatEnabledInput.addEventListener('change', updateVrchatVisibility);
  vrchatRefreshDevicesBtn.addEventListener('click', () => populateAudioDevices(vrchatAudioDeviceSelect.value));
  vrchatTestBtn.addEventListener('click', testVrchatConnection);
  vrchatOverlayBtn.addEventListener('click', () => { platform.vrchatOpenOverlay?.(); });
  vrchatInstallVbcableBtn.addEventListener('click', async () => {
    vrchatInstallVbcableBtn.disabled = true;
    vrchatInstallVbcableBtn.textContent = t('settings.openclaw.vrchat.downloading');
    try {
      const result = await platform.vrchatInstallVbcable();
      if (result.success) {
        vrchatInstallVbcableBtn.textContent = t('settings.openclaw.vrchat.installDone');
        await new Promise(r => setTimeout(r, 2000));
        await runVbCableSetup();
      } else {
        vrchatInstallVbcableBtn.textContent = t('settings.openclaw.vrchat.installFailed', { error: result.error || 'unknown' });
        setTimeout(() => { vrchatInstallVbcableBtn.textContent = t('settings.openclaw.vrchat.installVbcable'); vrchatInstallVbcableBtn.disabled = false; }, 3000);
      }
    } catch (err) {
      vrchatInstallVbcableBtn.textContent = t('settings.openclaw.vrchat.installError', { error: String(err) });
      setTimeout(() => { vrchatInstallVbcableBtn.textContent = t('settings.openclaw.vrchat.installVbcable'); vrchatInstallVbcableBtn.disabled = false; }, 3000);
    }
  });
  vrchatRedetectBtn.addEventListener('click', () => runVbCableSetup());
  vrchatRedetectFoundBtn.addEventListener('click', () => runVbCableSetup());
  vrchatManualSelectBtn.addEventListener('click', async () => {
    showAudioManualMode();
    await populateAudioDevices(vrchatAudioDeviceSelect.value || _detectedVbCableId || '');
  });
  vrchatAutoDetectBtn.addEventListener('click', () => { _useManualSelect = false; runVbCableSetup(); });

  // SelfGrowth
  selfGrowthEnabledInput = document.getElementById('self-growth-enabled') as HTMLInputElement;
  selfGrowthDetailsDiv = document.getElementById('self-growth-details') as HTMLDivElement;
  selfGrowthConfirmInput = document.getElementById('self-growth-confirm') as HTMLInputElement;
  selfGrowthTraitsInput = document.getElementById('self-growth-traits') as HTMLInputElement;
  selfGrowthSpeechInput = document.getElementById('self-growth-speech') as HTMLInputElement;
  selfGrowthReactionsInput = document.getElementById('self-growth-reactions') as HTMLInputElement;
  selfGrowthHistoryDiv = document.getElementById('self-growth-history') as HTMLDivElement;

  const sg = settings.selfGrowth ?? {} as Record<string, unknown>;
  selfGrowthEnabledInput.checked = (sg as any).enabled ?? false;
  selfGrowthConfirmInput.checked = (sg as any).requireConfirmation ?? true;
  selfGrowthTraitsInput.checked = (sg as any).allowTraits ?? true;
  selfGrowthSpeechInput.checked = (sg as any).allowSpeechStyle ?? true;
  selfGrowthReactionsInput.checked = (sg as any).allowReactions ?? true;
  selfGrowthDetailsDiv.style.display = selfGrowthEnabledInput.checked ? 'block' : 'none';
  selfGrowthEnabledInput.addEventListener('change', () => {
    selfGrowthDetailsDiv.style.display = selfGrowthEnabledInput.checked ? 'block' : 'none';
  });

  // selfGrowth history
  const sgHistory = (sg as any).history as Array<{ date: string; changes: Record<string, unknown> }> | undefined;
  if (sgHistory && sgHistory.length > 0) {
    selfGrowthHistoryDiv.innerHTML = '';
    for (const entry of sgHistory.slice().reverse()) {
      const row = document.createElement('div');
      row.style.cssText = 'padding: 4px 0; border-bottom: 1px solid var(--border);';
      const dateStr = new Date(entry.date).toLocaleString('ja-JP', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
      const changeParts: string[] = [];
      if (entry.changes.traits) changeParts.push(t('settings.character.selfGrowth.historyTraits', { values: (entry.changes.traits as string[]).join(', ') }));
      if (entry.changes.speechStyle) changeParts.push(t('settings.character.selfGrowth.historySpeech', { values: (entry.changes.speechStyle as string[]).join(', ') }));
      if (entry.changes.reactions) changeParts.push(t('settings.character.selfGrowth.historyReactions'));
      row.innerHTML = `<span style="color: var(--text-muted);">${dateStr}</span> ${changeParts.join(' / ') || t('settings.character.selfGrowth.historyDefault')}`;
      selfGrowthHistoryDiv.appendChild(row);
    }
  }
}

export function collectSettings(settings: Settings): void {
  // STT
  settings.stt = {
    enabled: sttEnabledInput.checked,
    engine: sttEngineSelect.value as 'web-speech' | 'whisper' | 'whisper-local',
    autoSend: sttAutoSendInput.checked,
    alwaysOn: sttAlwaysOnInput.checked,
    lang: sttLangSelect.value,
    whisperModel: sttWhisperModelSelect.value,
  } as any;

  // ClaudeCode
  settings.claudeCode = { enabled: claudecodeEnabledInput.checked };

  // External API
  settings.externalApi = {
    enabled: externalApiEnabledInput.checked,
    port: parseInt(externalApiPortInput.value) || 5174
  };

  // Web Server
  (settings as any).webServer = {
    enabled: webServerEnabledInput?.checked ?? true,
    port: parseInt(webServerPortInput?.value) || 3939
  };

  // VRChat
  settings.vrchat = {
    enabled: vrchatEnabledInput.checked,
    host: vrchatHostInput.value || '127.0.0.1',
    sendPort: parseInt(vrchatPortInput.value) || 9000,
    chatbox: { enabled: vrchatChatboxEnabledInput.checked, playSound: vrchatChatboxSoundInput.checked },
    expressionSync: vrchatExpressionSyncInput.checked,
    expressionParamType: vrchatExpressionParamTypeSelect.value as 'bool' | 'int' | 'float',
    expressionMap: {
      happy: vrchatMapHappyInput.value,
      sad: vrchatMapSadInput.value,
      annoyed: vrchatMapAnnoyedInput.value,
      surprised: vrchatMapSurprisedInput.value,
      thinking: vrchatMapThinkingInput.value,
      neutral: vrchatMapNeutralInput.value
    },
    audioDeviceId: _useManualSelect ? vrchatAudioDeviceSelect.value : (_detectedVbCableId || vrchatAudioDeviceSelect.value)
  };

  // Streaming Mode
  const bc = getBroadcastState();
  settings.streaming = {
    enabled: streamingEnabledInput.checked,
    broadcastMode: bc.broadcastModeEnabled,
    subtitle: {
      enabled: streamingSubtitleEnabledInput.checked,
      fontSize: parseInt(streamingSubtitleFontsizeNumInput.value) || 28,
      fadeAfterMs: parseInt(streamingSubtitleFadeInput.value) || 3000
    },
    commentSource: bc.broadcastModeEnabled
      ? (bc.broadcastCommentSource as 'none' | 'youtube' | 'onecomme')
      : (streamingCommentSourceSelect.value as 'none' | 'youtube' | 'onecomme'),
    youtube: {
      videoId: bc.broadcastModeEnabled ? bc.broadcastYoutubeId : streamingYoutubeVideoIdInput.value,
      pollingIntervalMs: settings.streaming?.youtube?.pollingIntervalMs ?? 5000
    },
    onecomme: {
      port: bc.broadcastModeEnabled
        ? (parseInt(bc.broadcastOnecommePort) || 11180)
        : (parseInt(streamingOnecommePortInput.value) || 11180)
    },
    commentFilter: {
      ignoreHashPrefix: streamingFilterHashInput.checked,
      maxQueueSize: settings.streaming?.commentFilter?.maxQueueSize ?? 20,
      minLengthChars: settings.streaming?.commentFilter?.minLengthChars ?? 2
    },
    broadcastIdle: {
      enabled: bc.broadcastIdleEnabled,
      intervalSeconds: parseInt(bc.broadcastIdleInterval) || 30
    },
    safety: {
      customNgWords: bc.broadcastNgWords.split('\n').map(s => s.trim()).filter(s => s.length > 0),
      customSoftblockWords: bc.broadcastSoftblockWords.split('\n').map(s => s.trim()).filter(s => s.length > 0)
    },
    customInstructions: bc.broadcastCustomInstructions
  };

  // selfGrowth
  settings.selfGrowth = {
    enabled: selfGrowthEnabledInput.checked,
    allowTraits: selfGrowthTraitsInput.checked,
    allowSpeechStyle: selfGrowthSpeechInput.checked,
    allowReactions: selfGrowthReactionsInput.checked,
    requireConfirmation: selfGrowthConfirmInput.checked
  };
}

export function getSttEngine(): string { return sttEngineSelect?.value ?? ''; }
