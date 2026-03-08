import { platform } from '../platform';
// Settings > TTS tab (7 engines + playground)
import type { Settings } from '../types';
import { t } from '../locales';
import { syncSliders } from './shared';

// DOM elements
let ttsEnabledInput: HTMLInputElement;
let ttsEngineSelect: HTMLSelectElement;
let voicevoxSettingsDiv: HTMLDivElement;
let voicevoxUrlInput: HTMLInputElement;
let voicevoxSpeakerSelect: HTMLSelectElement;
let voicevoxSpeakerInput: HTMLInputElement;
let voicevoxRefreshSpeakersBtn: HTMLButtonElement;
let voicevoxSpeedInput: HTMLInputElement;
let voicevoxSpeedNumInput: HTMLInputElement;
let voicevoxPitchInput: HTMLInputElement;
let voicevoxPitchNumInput: HTMLInputElement;
let voicevoxIntonationInput: HTMLInputElement;
let voicevoxIntonationNumInput: HTMLInputElement;
let voicevoxStatusSpan: HTMLSpanElement;

let ttsPlaygroundPlayBtn: HTMLButtonElement;
let ttsPlaygroundStopBtn: HTMLButtonElement;
let ttsPlaygroundTextarea: HTMLTextAreaElement;
let ttsPlaygroundStatus: HTMLDivElement;

let openaiTtsSettingsDiv: HTMLDivElement;
let openaiTtsVoiceSelect: HTMLSelectElement;
let openaiTtsModelSelect: HTMLSelectElement;
let openaiTtsSpeedInput: HTMLInputElement;
let openaiTtsSpeedNumInput: HTMLInputElement;

let elevenlabsSettingsDiv: HTMLDivElement;
let elevenlabsVoiceIdInput: HTMLInputElement;
let elevenlabsModelSelect: HTMLSelectElement;
let elevenlabsStabilityInput: HTMLInputElement;
let elevenlabsStabilityNumInput: HTMLInputElement;
let elevenlabsSimilarityInput: HTMLInputElement;
let elevenlabsSimilarityNumInput: HTMLInputElement;
let elevenlabsSpeedInput: HTMLInputElement;
let elevenlabsSpeedNumInput: HTMLInputElement;

let googleTtsSettingsDiv: HTMLDivElement;
let googleTtsLanguageInput: HTMLInputElement;
let googleTtsVoiceInput: HTMLInputElement;
let googleTtsRateInput: HTMLInputElement;
let googleTtsRateNumInput: HTMLInputElement;
let googleTtsPitchInput: HTMLInputElement;
let googleTtsPitchNumInput: HTMLInputElement;
let googleTtsUseGeminiKeyInput: HTMLInputElement;

let aivisSpeechSettingsDiv: HTMLDivElement;
let aivisSpeechUrlInput: HTMLInputElement;
let aivisSpeechSpeakerSelect: HTMLSelectElement;
let aivisSpeechSpeakerInput: HTMLInputElement;
let aivisSpeechRefreshSpeakersBtn: HTMLButtonElement;
let aivisSpeechSpeedInput: HTMLInputElement;
let aivisSpeechSpeedNumInput: HTMLInputElement;
let aivisSpeechPitchInput: HTMLInputElement;
let aivisSpeechPitchNumInput: HTMLInputElement;
let aivisSpeechIntonationInput: HTMLInputElement;
let aivisSpeechIntonationNumInput: HTMLInputElement;
let aivisSpeechStatusSpan: HTMLSpanElement;

let sbv2SettingsDiv: HTMLDivElement;
let sbv2UrlInput: HTMLInputElement;
let sbv2ModelIdInput: HTMLInputElement;
let sbv2SpeakerIdInput: HTMLInputElement;
let sbv2StyleInput: HTMLInputElement;
let sbv2StyleWeightInput: HTMLInputElement;
let sbv2StyleWeightNumInput: HTMLInputElement;
let sbv2LanguageSelect: HTMLSelectElement;
let sbv2SpeedInput: HTMLInputElement;
let sbv2SpeedNumInput: HTMLInputElement;
let sbv2TestBtn: HTMLButtonElement;
let sbv2StatusSpan: HTMLSpanElement;

let compatTtsSettingsDiv: HTMLDivElement;
let compatTtsBaseurlInput: HTMLInputElement;
let compatTtsApikeyInput: HTMLInputElement;
let compatTtsModelInput: HTMLInputElement;
let compatTtsVoiceInput: HTMLInputElement;
let compatTtsSpeedInput: HTMLInputElement;
let compatTtsSpeedNumInput: HTMLInputElement;

// State
export let originalTtsEngine = 'none';

// VOICEVOX speaker types
interface VoicevoxStyleInfo { name: string; id: number; }
interface VoicevoxSpeakerInfo { name: string; styles: VoicevoxStyleInfo[]; }

function populateSpeakerSelect(
  selectEl: HTMLSelectElement,
  hiddenInput: HTMLInputElement,
  speakers: VoicevoxSpeakerInfo[],
  currentSpeakerId: number
) {
  selectEl.innerHTML = '';
  let found = false;
  for (const speaker of speakers) {
    for (const style of speaker.styles) {
      const opt = document.createElement('option');
      opt.value = String(style.id);
      opt.textContent = `${speaker.name}/${style.name}`;
      if (style.id === currentSpeakerId) { opt.selected = true; found = true; }
      selectEl.appendChild(opt);
    }
  }
  if (!found && selectEl.options.length > 0) selectEl.selectedIndex = 0;
  hiddenInput.value = selectEl.value;
  selectEl.onchange = () => { hiddenInput.value = selectEl.value; };
}

async function fetchVoicevoxSpeakers() {
  voicevoxStatusSpan.textContent = t('settings.tts.voicevox.fetching');
  voicevoxStatusSpan.style.color = 'var(--text-muted)';
  try {
    const result = await platform.voicevoxSpeakers();
    if (result.success && result.speakers) {
      const speakers = result.speakers as VoicevoxSpeakerInfo[];
      const currentId = parseInt(voicevoxSpeakerInput.value) || 0;
      populateSpeakerSelect(voicevoxSpeakerSelect, voicevoxSpeakerInput, speakers, currentId);
      voicevoxStatusSpan.textContent = `✅ ${t('settings.tts.voicevox.fetched', { count: speakers.length })}`;
      voicevoxStatusSpan.style.color = 'var(--success)';
    } else {
      voicevoxStatusSpan.textContent = `❌ ${result.error || t('settings.tts.voicevox.fetchFailed')}`;
      voicevoxStatusSpan.style.color = 'var(--danger)';
    }
  } catch (err) {
    voicevoxStatusSpan.textContent = `❌ ${t('common.error')}: ${err}`;
    voicevoxStatusSpan.style.color = 'var(--danger)';
  }
}

async function fetchAivisSpeechSpeakers() {
  aivisSpeechStatusSpan.textContent = t('settings.tts.aivis.fetching');
  aivisSpeechStatusSpan.style.color = 'var(--text-muted)';
  try {
    const result = await platform.aivisSpeechSpeakers();
    if (result.success && result.speakers) {
      const speakers = result.speakers as VoicevoxSpeakerInfo[];
      const currentId = parseInt(aivisSpeechSpeakerInput.value) || 0;
      populateSpeakerSelect(aivisSpeechSpeakerSelect, aivisSpeechSpeakerInput, speakers, currentId);
      aivisSpeechStatusSpan.textContent = `✅ ${t('settings.tts.aivis.fetched', { count: speakers.length })}`;
      aivisSpeechStatusSpan.style.color = 'var(--success)';
    } else {
      aivisSpeechStatusSpan.textContent = `❌ ${result.error || t('settings.tts.aivis.fetchFailed')}`;
      aivisSpeechStatusSpan.style.color = 'var(--danger)';
    }
  } catch (err) {
    aivisSpeechStatusSpan.textContent = `❌ ${t('common.error')}: ${err}`;
    aivisSpeechStatusSpan.style.color = 'var(--danger)';
  }
}

async function testStyleBertVits2Connection() {
  sbv2StatusSpan.textContent = t('common.testing');
  sbv2StatusSpan.style.color = 'var(--text-muted)';
  try {
    const result = await platform.styleBertVits2Check();
    if (result.available) {
      sbv2StatusSpan.textContent = `✅ ${t('common.success')}`;
      sbv2StatusSpan.style.color = 'var(--success)';
    } else {
      sbv2StatusSpan.textContent = `❌ ${result.error || t('common.failed')}`;
      sbv2StatusSpan.style.color = 'var(--danger)';
    }
  } catch (err) {
    sbv2StatusSpan.textContent = `❌ ${t('common.error')}: ${err}`;
    sbv2StatusSpan.style.color = 'var(--danger)';
  }
}

function updateTtsVisibility() {
  const engine = ttsEngineSelect.value;
  voicevoxSettingsDiv.style.display = engine === 'voicevox' ? 'block' : 'none';
  openaiTtsSettingsDiv.style.display = engine === 'openai' ? 'block' : 'none';
  elevenlabsSettingsDiv.style.display = engine === 'elevenlabs' ? 'block' : 'none';
  googleTtsSettingsDiv.style.display = engine === 'google-tts' ? 'block' : 'none';
  aivisSpeechSettingsDiv.style.display = engine === 'aivis-speech' ? 'block' : 'none';
  sbv2SettingsDiv.style.display = engine === 'style-bert-vits2' ? 'block' : 'none';
  compatTtsSettingsDiv.style.display = engine === 'openai-compat-tts' ? 'block' : 'none';
}

export async function initTab(settings: Settings): Promise<void> {
  // Get DOM elements
  ttsEnabledInput = document.getElementById('tts-enabled') as HTMLInputElement;
  ttsEngineSelect = document.getElementById('tts-engine') as HTMLSelectElement;
  voicevoxSettingsDiv = document.getElementById('voicevox-settings') as HTMLDivElement;
  voicevoxUrlInput = document.getElementById('voicevox-url') as HTMLInputElement;
  voicevoxSpeakerSelect = document.getElementById('voicevox-speaker-select') as HTMLSelectElement;
  voicevoxSpeakerInput = document.getElementById('voicevox-speaker') as HTMLInputElement;
  voicevoxRefreshSpeakersBtn = document.getElementById('voicevox-refresh-speakers') as HTMLButtonElement;
  voicevoxSpeedInput = document.getElementById('voicevox-speed') as HTMLInputElement;
  voicevoxSpeedNumInput = document.getElementById('voicevox-speed-num') as HTMLInputElement;
  voicevoxPitchInput = document.getElementById('voicevox-pitch') as HTMLInputElement;
  voicevoxPitchNumInput = document.getElementById('voicevox-pitch-num') as HTMLInputElement;
  voicevoxIntonationInput = document.getElementById('voicevox-intonation') as HTMLInputElement;
  voicevoxIntonationNumInput = document.getElementById('voicevox-intonation-num') as HTMLInputElement;
  voicevoxStatusSpan = document.getElementById('voicevox-status') as HTMLSpanElement;
  ttsPlaygroundPlayBtn = document.getElementById('tts-playground-play') as HTMLButtonElement;
  ttsPlaygroundStopBtn = document.getElementById('tts-playground-stop') as HTMLButtonElement;
  ttsPlaygroundTextarea = document.getElementById('tts-test-text') as HTMLTextAreaElement;
  if (!ttsPlaygroundTextarea.value) {
    ttsPlaygroundTextarea.value = t('settings.tts.playground.defaultText');
  }
  ttsPlaygroundStatus = document.getElementById('tts-playground-status') as HTMLDivElement;
  openaiTtsSettingsDiv = document.getElementById('openai-tts-settings') as HTMLDivElement;
  openaiTtsVoiceSelect = document.getElementById('openai-tts-voice') as HTMLSelectElement;
  openaiTtsModelSelect = document.getElementById('openai-tts-model') as HTMLSelectElement;
  openaiTtsSpeedInput = document.getElementById('openai-tts-speed') as HTMLInputElement;
  openaiTtsSpeedNumInput = document.getElementById('openai-tts-speed-num') as HTMLInputElement;
  elevenlabsSettingsDiv = document.getElementById('elevenlabs-settings') as HTMLDivElement;
  elevenlabsVoiceIdInput = document.getElementById('elevenlabs-voice-id') as HTMLInputElement;
  elevenlabsModelSelect = document.getElementById('elevenlabs-model') as HTMLSelectElement;
  elevenlabsStabilityInput = document.getElementById('elevenlabs-stability') as HTMLInputElement;
  elevenlabsStabilityNumInput = document.getElementById('elevenlabs-stability-num') as HTMLInputElement;
  elevenlabsSimilarityInput = document.getElementById('elevenlabs-similarity') as HTMLInputElement;
  elevenlabsSimilarityNumInput = document.getElementById('elevenlabs-similarity-num') as HTMLInputElement;
  elevenlabsSpeedInput = document.getElementById('elevenlabs-speed') as HTMLInputElement;
  elevenlabsSpeedNumInput = document.getElementById('elevenlabs-speed-num') as HTMLInputElement;
  googleTtsSettingsDiv = document.getElementById('google-tts-settings') as HTMLDivElement;
  googleTtsLanguageInput = document.getElementById('google-tts-language') as HTMLInputElement;
  googleTtsVoiceInput = document.getElementById('google-tts-voice') as HTMLInputElement;
  googleTtsRateInput = document.getElementById('google-tts-rate') as HTMLInputElement;
  googleTtsRateNumInput = document.getElementById('google-tts-rate-num') as HTMLInputElement;
  googleTtsPitchInput = document.getElementById('google-tts-pitch') as HTMLInputElement;
  googleTtsPitchNumInput = document.getElementById('google-tts-pitch-num') as HTMLInputElement;
  googleTtsUseGeminiKeyInput = document.getElementById('google-tts-use-gemini-key') as HTMLInputElement;
  aivisSpeechSettingsDiv = document.getElementById('aivis-speech-settings') as HTMLDivElement;
  aivisSpeechUrlInput = document.getElementById('aivis-speech-url') as HTMLInputElement;
  aivisSpeechSpeakerSelect = document.getElementById('aivis-speech-speaker-select') as HTMLSelectElement;
  aivisSpeechSpeakerInput = document.getElementById('aivis-speech-speaker') as HTMLInputElement;
  aivisSpeechRefreshSpeakersBtn = document.getElementById('aivis-speech-refresh-speakers') as HTMLButtonElement;
  aivisSpeechSpeedInput = document.getElementById('aivis-speech-speed') as HTMLInputElement;
  aivisSpeechSpeedNumInput = document.getElementById('aivis-speech-speed-num') as HTMLInputElement;
  aivisSpeechPitchInput = document.getElementById('aivis-speech-pitch') as HTMLInputElement;
  aivisSpeechPitchNumInput = document.getElementById('aivis-speech-pitch-num') as HTMLInputElement;
  aivisSpeechIntonationInput = document.getElementById('aivis-speech-intonation') as HTMLInputElement;
  aivisSpeechIntonationNumInput = document.getElementById('aivis-speech-intonation-num') as HTMLInputElement;
  aivisSpeechStatusSpan = document.getElementById('aivis-speech-status') as HTMLSpanElement;
  sbv2SettingsDiv = document.getElementById('style-bert-vits2-settings') as HTMLDivElement;
  sbv2UrlInput = document.getElementById('sbv2-url') as HTMLInputElement;
  sbv2ModelIdInput = document.getElementById('sbv2-model-id') as HTMLInputElement;
  sbv2SpeakerIdInput = document.getElementById('sbv2-speaker-id') as HTMLInputElement;
  sbv2StyleInput = document.getElementById('sbv2-style') as HTMLInputElement;
  sbv2StyleWeightInput = document.getElementById('sbv2-style-weight') as HTMLInputElement;
  sbv2StyleWeightNumInput = document.getElementById('sbv2-style-weight-num') as HTMLInputElement;
  sbv2LanguageSelect = document.getElementById('sbv2-language') as HTMLSelectElement;
  sbv2SpeedInput = document.getElementById('sbv2-speed') as HTMLInputElement;
  sbv2SpeedNumInput = document.getElementById('sbv2-speed-num') as HTMLInputElement;
  sbv2TestBtn = document.getElementById('sbv2-test') as HTMLButtonElement;
  sbv2StatusSpan = document.getElementById('sbv2-status') as HTMLSpanElement;
  compatTtsSettingsDiv = document.getElementById('openai-compat-tts-settings') as HTMLDivElement;
  compatTtsBaseurlInput = document.getElementById('compat-tts-baseurl') as HTMLInputElement;
  compatTtsApikeyInput = document.getElementById('compat-tts-apikey') as HTMLInputElement;
  compatTtsModelInput = document.getElementById('compat-tts-model') as HTMLInputElement;
  compatTtsVoiceInput = document.getElementById('compat-tts-voice') as HTMLInputElement;
  compatTtsSpeedInput = document.getElementById('compat-tts-speed') as HTMLInputElement;
  compatTtsSpeedNumInput = document.getElementById('compat-tts-speed-num') as HTMLInputElement;

  // ---- TTS values ----
  ttsEnabledInput.checked = settings.tts?.enabled ?? true;
  ttsEngineSelect.value = settings.tts?.engine ?? 'web-speech';
  originalTtsEngine = ttsEngineSelect.value;

  voicevoxUrlInput.value = settings.tts?.voicevox?.baseUrl ?? 'http://127.0.0.1:50021';
  voicevoxSpeakerInput.value = String(settings.tts?.voicevox?.speakerId ?? 0);
  voicevoxSpeedInput.value = String(settings.tts?.voicevox?.speed ?? 1.0);
  voicevoxSpeedNumInput.value = String(settings.tts?.voicevox?.speed ?? 1.0);
  voicevoxPitchInput.value = String(settings.tts?.voicevox?.pitch ?? 0);
  voicevoxPitchNumInput.value = String(settings.tts?.voicevox?.pitch ?? 0);
  voicevoxIntonationInput.value = String(settings.tts?.voicevox?.intonationScale ?? 1.0);
  voicevoxIntonationNumInput.value = String(settings.tts?.voicevox?.intonationScale ?? 1.0);
  if (ttsEngineSelect.value === 'voicevox') fetchVoicevoxSpeakers().catch(() => {});

  openaiTtsVoiceSelect.value = settings.tts?.openai?.voice ?? 'nova';
  openaiTtsModelSelect.value = settings.tts?.openai?.model ?? 'tts-1';
  openaiTtsSpeedInput.value = String(settings.tts?.openai?.speed ?? 1.0);
  openaiTtsSpeedNumInput.value = String(settings.tts?.openai?.speed ?? 1.0);

  elevenlabsVoiceIdInput.value = settings.tts?.elevenlabs?.voiceId ?? '';
  elevenlabsModelSelect.value = settings.tts?.elevenlabs?.model ?? 'eleven_multilingual_v2';
  elevenlabsStabilityInput.value = String(settings.tts?.elevenlabs?.stability ?? 0.5);
  elevenlabsStabilityNumInput.value = String(settings.tts?.elevenlabs?.stability ?? 0.5);
  elevenlabsSimilarityInput.value = String(settings.tts?.elevenlabs?.similarityBoost ?? 0.75);
  elevenlabsSimilarityNumInput.value = String(settings.tts?.elevenlabs?.similarityBoost ?? 0.75);
  elevenlabsSpeedInput.value = String(settings.tts?.elevenlabs?.speed ?? 1.0);
  elevenlabsSpeedNumInput.value = String(settings.tts?.elevenlabs?.speed ?? 1.0);

  googleTtsLanguageInput.value = settings.tts?.googleTts?.languageCode ?? 'ja-JP';
  googleTtsVoiceInput.value = settings.tts?.googleTts?.voiceName ?? 'ja-JP-Neural2-B';
  googleTtsRateInput.value = String(settings.tts?.googleTts?.speakingRate ?? 1.0);
  googleTtsRateNumInput.value = String(settings.tts?.googleTts?.speakingRate ?? 1.0);
  googleTtsPitchInput.value = String(settings.tts?.googleTts?.pitch ?? 0);
  googleTtsPitchNumInput.value = String(settings.tts?.googleTts?.pitch ?? 0);
  googleTtsUseGeminiKeyInput.checked = settings.tts?.googleTts?.useGeminiKey ?? true;

  aivisSpeechUrlInput.value = settings.tts?.aivisSpeech?.baseUrl ?? 'http://127.0.0.1:10101';
  aivisSpeechSpeakerInput.value = String(settings.tts?.aivisSpeech?.speakerId ?? 0);
  aivisSpeechSpeedInput.value = String(settings.tts?.aivisSpeech?.speed ?? 1.0);
  aivisSpeechSpeedNumInput.value = String(settings.tts?.aivisSpeech?.speed ?? 1.0);
  aivisSpeechPitchInput.value = String(settings.tts?.aivisSpeech?.pitch ?? 0);
  aivisSpeechPitchNumInput.value = String(settings.tts?.aivisSpeech?.pitch ?? 0);
  aivisSpeechIntonationInput.value = String(settings.tts?.aivisSpeech?.intonationScale ?? 1.0);
  aivisSpeechIntonationNumInput.value = String(settings.tts?.aivisSpeech?.intonationScale ?? 1.0);
  if (ttsEngineSelect.value === 'aivis-speech') fetchAivisSpeechSpeakers().catch(() => {});

  sbv2UrlInput.value = settings.tts?.styleBertVits2?.baseUrl ?? 'http://127.0.0.1:5000';
  sbv2ModelIdInput.value = String(settings.tts?.styleBertVits2?.modelId ?? 0);
  sbv2SpeakerIdInput.value = String(settings.tts?.styleBertVits2?.speakerId ?? 0);
  sbv2StyleInput.value = settings.tts?.styleBertVits2?.style ?? 'Neutral';
  sbv2StyleWeightInput.value = String(settings.tts?.styleBertVits2?.styleWeight ?? 5);
  sbv2StyleWeightNumInput.value = String(settings.tts?.styleBertVits2?.styleWeight ?? 5);
  sbv2LanguageSelect.value = settings.tts?.styleBertVits2?.language ?? 'JP';
  sbv2SpeedInput.value = String(settings.tts?.styleBertVits2?.speed ?? 1.0);
  sbv2SpeedNumInput.value = String(settings.tts?.styleBertVits2?.speed ?? 1.0);

  compatTtsBaseurlInput.value = settings.tts?.openaiCompatTts?.baseUrl ?? '';
  compatTtsApikeyInput.value = settings.tts?.openaiCompatTts?.apiKey ?? '';
  compatTtsModelInput.value = settings.tts?.openaiCompatTts?.model ?? 'tts-1';
  compatTtsVoiceInput.value = settings.tts?.openaiCompatTts?.voice ?? 'alloy';
  compatTtsSpeedInput.value = String(settings.tts?.openaiCompatTts?.speed ?? 1.0);
  compatTtsSpeedNumInput.value = String(settings.tts?.openaiCompatTts?.speed ?? 1.0);

  updateTtsVisibility();
  ttsEngineSelect.addEventListener('change', () => {
    updateTtsVisibility();
    if (ttsEngineSelect.value === 'voicevox') fetchVoicevoxSpeakers().catch(() => {});
    if (ttsEngineSelect.value === 'aivis-speech') fetchAivisSpeechSpeakers().catch(() => {});
  });
  voicevoxRefreshSpeakersBtn.addEventListener('click', fetchVoicevoxSpeakers);
  aivisSpeechRefreshSpeakersBtn.addEventListener('click', fetchAivisSpeechSpeakers);
  sbv2TestBtn.addEventListener('click', testStyleBertVits2Connection);

  // TTS Playground
  ttsPlaygroundPlayBtn.addEventListener('click', () => {
    const text = ttsPlaygroundTextarea.value.trim();
    if (!text) {
      ttsPlaygroundStatus.className = 'status error';
      ttsPlaygroundStatus.textContent = t('settings.tts.playground.enterText');
      return;
    }
    ttsPlaygroundStatus.className = 'status success';
    ttsPlaygroundStatus.textContent = t('settings.tts.playground.playing');
    (platform as any).ttsTestSpeak?.(text);
    setTimeout(() => { ttsPlaygroundStatus.className = 'status'; ttsPlaygroundStatus.textContent = ''; }, 5000);
  });
  ttsPlaygroundStopBtn.addEventListener('click', () => {
    (platform as any).ttsStop?.();
    ttsPlaygroundStatus.className = 'status';
    ttsPlaygroundStatus.textContent = '';
  });

  // Slider syncs
  syncSliders('voicevox-speed', 'voicevox-speed-num');
  syncSliders('voicevox-pitch', 'voicevox-pitch-num');
  syncSliders('voicevox-intonation', 'voicevox-intonation-num');
  syncSliders('openai-tts-speed', 'openai-tts-speed-num');
  syncSliders('elevenlabs-stability', 'elevenlabs-stability-num');
  syncSliders('elevenlabs-similarity', 'elevenlabs-similarity-num');
  syncSliders('elevenlabs-speed', 'elevenlabs-speed-num');
  syncSliders('google-tts-rate', 'google-tts-rate-num');
  syncSliders('google-tts-pitch', 'google-tts-pitch-num');
  syncSliders('aivis-speech-speed', 'aivis-speech-speed-num');
  syncSliders('aivis-speech-pitch', 'aivis-speech-pitch-num');
  syncSliders('aivis-speech-intonation', 'aivis-speech-intonation-num');
  syncSliders('sbv2-style-weight', 'sbv2-style-weight-num');
  syncSliders('sbv2-speed', 'sbv2-speed-num');
  syncSliders('compat-tts-speed', 'compat-tts-speed-num');
}

export function collectSettings(settings: Settings): void {
  settings.tts = {
    enabled: ttsEnabledInput.checked,
    engine: ttsEngineSelect.value as any,
    webSpeech: settings.tts?.webSpeech ?? { lang: 'ja-JP', rate: 1.0, pitch: 1.0 },
    voicevox: {
      baseUrl: voicevoxUrlInput.value || 'http://127.0.0.1:50021',
      speakerId: parseInt(voicevoxSpeakerInput.value) || 0,
      speed: parseFloat(voicevoxSpeedNumInput.value) || 1.0,
      pitch: parseFloat(voicevoxPitchNumInput.value) || 0,
      intonationScale: parseFloat(voicevoxIntonationNumInput.value) ?? 1.0
    },
    openai: {
      voice: openaiTtsVoiceSelect.value || 'nova',
      model: openaiTtsModelSelect.value || 'tts-1',
      speed: parseFloat(openaiTtsSpeedNumInput.value) || 1.0
    },
    elevenlabs: {
      voiceId: elevenlabsVoiceIdInput.value || '',
      model: elevenlabsModelSelect.value || 'eleven_multilingual_v2',
      stability: parseFloat(elevenlabsStabilityNumInput.value) || 0.5,
      similarityBoost: parseFloat(elevenlabsSimilarityNumInput.value) || 0.75,
      speed: parseFloat(elevenlabsSpeedNumInput.value) || 1.0
    },
    googleTts: {
      languageCode: googleTtsLanguageInput.value || 'ja-JP',
      voiceName: googleTtsVoiceInput.value || 'ja-JP-Neural2-B',
      speakingRate: parseFloat(googleTtsRateNumInput.value) || 1.0,
      pitch: parseFloat(googleTtsPitchNumInput.value) || 0,
      useGeminiKey: googleTtsUseGeminiKeyInput.checked
    },
    aivisSpeech: {
      baseUrl: aivisSpeechUrlInput.value || 'http://127.0.0.1:10101',
      speakerId: parseInt(aivisSpeechSpeakerInput.value) || 0,
      speed: parseFloat(aivisSpeechSpeedNumInput.value) || 1.0,
      pitch: parseFloat(aivisSpeechPitchNumInput.value) || 0,
      intonationScale: parseFloat(aivisSpeechIntonationNumInput.value) ?? 1.0
    },
    styleBertVits2: {
      baseUrl: sbv2UrlInput.value || 'http://127.0.0.1:5000',
      modelId: parseInt(sbv2ModelIdInput.value) || 0,
      speakerId: parseInt(sbv2SpeakerIdInput.value) || 0,
      style: sbv2StyleInput.value || 'Neutral',
      styleWeight: parseFloat(sbv2StyleWeightNumInput.value) || 5,
      language: sbv2LanguageSelect.value || 'JP',
      speed: parseFloat(sbv2SpeedNumInput.value) || 1.0
    },
    openaiCompatTts: {
      baseUrl: compatTtsBaseurlInput.value || '',
      apiKey: compatTtsApikeyInput.value || '',
      model: compatTtsModelInput.value || 'tts-1',
      voice: compatTtsVoiceInput.value || 'alloy',
      speed: parseFloat(compatTtsSpeedNumInput.value) || 1.0
    }
  };
}

export function getTtsEngine(): string {
  return ttsEngineSelect?.value ?? '';
}
