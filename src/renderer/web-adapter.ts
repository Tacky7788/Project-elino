// Web adapter — REST API + WebSocket でElectronAPIを再現
// バックエンド = Electronのmainプロセス（localhost）
import type { ElectronAPI } from './types';

const API_BASE = '/api';

// IPCチャンネル名でAPIを呼ぶ（web-server.cjsが自動マッピング）
async function ipc<T = any>(channel: string, body?: any): Promise<T> {
  const route = `${API_BASE}/${channel.replace(/:/g, '/')}`;
  const res = await fetch(route, {
    method: body !== undefined ? 'POST' : 'GET',
    headers: body !== undefined ? { 'Content-Type': 'application/json' } : {},
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) throw new Error(`API error: ${res.status} ${res.statusText}`);
  const ct = res.headers.get('content-type') || '';
  if (ct.includes('application/octet-stream') || ct.includes('audio/')) {
    return res.arrayBuffer() as any;
  }
  return res.json();
}

type EventCallback = (...args: any[]) => void;

class WebEventBus {
  private ws: WebSocket | null = null;
  private listeners = new Map<string, Set<EventCallback>>();
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;

  connect() {
    const proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
    this.ws = new WebSocket(`${proto}//${location.host}/ws`);

    this.ws.onmessage = (e) => {
      try {
        const { event, data } = JSON.parse(e.data);
        const cbs = this.listeners.get(event);
        if (cbs) cbs.forEach(cb => cb(data));
      } catch { /* ignore parse errors */ }
    };

    this.ws.onclose = () => {
      this.reconnectTimer = setTimeout(() => this.connect(), 3000);
    };
  }

  on(event: string, cb: EventCallback) {
    if (!this.listeners.has(event)) this.listeners.set(event, new Set());
    this.listeners.get(event)!.add(cb);
  }

  off(event: string) {
    this.listeners.delete(event);
  }

  send(event: string, data?: any) {
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify({ event, data }));
    }
  }

  destroy() {
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    this.ws?.close();
  }
}

export async function createWebAdapter(): Promise<ElectronAPI> {
  const bus = new WebEventBus();
  bus.connect();

  function onEvent(event: string, callback: EventCallback) {
    bus.off(event);
    bus.on(event, callback);
  }

  const adapter: ElectronAPI = {
    // --- Data persistence ---
    getMemory: () => ipc('get-memory'),
    saveMemory: (m) => ipc('save-memory', m),
    getProfile: () => ipc('get-profile'),
    saveProfile: (p) => ipc('save-profile', p),
    getPersonality: () => ipc('get-personality'),
    savePersonality: (p) => ipc('save-personality', p),
    getPersonalityPresets: () => ipc('get-personality-presets'),
    applyPersonalityPreset: (id) => ipc('apply-personality-preset', id),
    getCustomPresets: () => ipc('get-custom-presets'),
    saveCustomPreset: (p) => ipc('save-custom-preset', p),
    deleteCustomPreset: (id) => ipc('delete-custom-preset', id),
    getUser: () => ipc('get-user'),
    saveUser: (u) => ipc('save-user', u),
    getMemoryV2: () => ipc('get-memory-v2'),
    saveMemoryV2: (m) => ipc('save-memory-v2', m),
    openMemoryFolder: async () => { /* no-op on web */ },
    getState: () => ipc('get-state'),
    saveState: (s) => ipc('save-state', s),
    getSettings: () => ipc('get-settings'),
    saveSettings: (s) => ipc('save-settings', s),
    appendHistory: (r) => ipc('append-history', r),
    getHistory: (limit) => ipc('get-history', limit),
    getHistoryCount: () => ipc('get-history-count'),
    summarizeHistory: () => ipc('summarize-history', {}),
    applyConversation: (d) => ipc('memory:applyConversation', d),
    getMemoryContext: () => ipc('memory:getContext'),

    // --- Config ---
    getConfig: () => ipc('get-config'),
    saveConfig: (c) => ipc('save-config', c),
    getConfigExtended: () => ipc('get-config-extended'),
    saveConfigExtended: (c) => ipc('save-config-extended', c),
    getModelRegistry: () => ipc('get-model-registry'),
    getAvailableProviders: () => ipc('get-available-providers'),

    // --- Google OAuth ---
    oauthGoogleStart: () => ipc('oauth:google-start', {}),
    oauthGoogleLogout: () => ipc('oauth:google-logout', {}),
    oauthGoogleStatus: () => ipc('oauth:google-status'),

    // --- STT ---
    sttTranscribe: (buf, lang, mime, model) =>
      ipc('stt:transcribe', { audio: Array.from(new Uint8Array(buf)), lang, mimeType: mime, whisperModel: model }),
    sttTranscribeLocal: (pcm, lang) =>
      ipc('stt:transcribe-local', { audio: Array.from(new Uint8Array(pcm)), lang }),
    sttLocalModelStatus: () => ipc('stt:local-model-status'),

    // --- TTS ---
    ttsOpenaiSynthesize: (p) => ipc('tts:openai-synthesize', p),
    ttsElevenlabsSynthesize: (p) => ipc('tts:elevenlabs-synthesize', p),
    ttsGoogleSynthesize: (p) => ipc('tts:google-synthesize', p),
    voicevoxCheck: () => ipc('voicevox:check'),
    voicevoxSpeakers: () => ipc('voicevox:speakers'),
    voicevoxSynthesize: (p) => ipc('voicevox:synthesize', p),
    voicevoxSynthesizeWithPhonemes: (p) => ipc('voicevox:synthesize-with-phonemes', p),
    aivisSpeechCheck: () => ipc('aivis-speech:check'),
    aivisSpeechSpeakers: () => ipc('aivis-speech:speakers'),
    aivisSpeechSynthesize: (p) => ipc('aivis-speech:synthesize', p),
    aivisSpeechSynthesizeWithPhonemes: (p) => ipc('aivis-speech:synthesize-with-phonemes', p),
    styleBertVits2Check: () => ipc('style-bert-vits2:check'),
    styleBertVits2Synthesize: (p) => ipc('style-bert-vits2:synthesize', p),

    // --- File parsing ---
    parseFile: (filePath) => ipc('parse-file', filePath),

    // --- OpenClaw ---
    openclawTest: (p) => ipc('openclaw:test', p),
    openclawResetSession: () => { bus.send('openclaw:reset-session'); },

    // --- VRChat (no-op on web) ---
    vrchatConnect: async () => ({ success: false }),
    vrchatDisconnect: async () => ({ success: false }),
    vrchatStatus: async () => ({ connected: false }),
    vrchatTest: async () => ({ success: false }),
    vrchatChatbox: async () => ({ success: false }),
    vrchatOpenOverlay: async () => {},
    vrchatCloseOverlay: async () => {},
    vrchatInstallVbcable: async () => ({ success: false, error: 'Not available on web' }),

    // --- Shell ---
    openExternal: async (url) => { window.open(url, '_blank'); },

    // --- External API ---
    onExternalSpeak: (cb) => onEvent('external:speak', cb),
    updateExternalApi: (config) => bus.send('external-api:update', config),

    // --- External message ---
    onExternalMessage: (cb) => onEvent('external-message', cb),

    // --- VR Overlay (no-op on web) ---
    vrOverlaySend: () => {},
    onVrOverlayMessage: () => {},
    onVrOverlayDelta: () => {},
    onVrOverlayDone: () => {},

    // --- Claude Code ---
    claudeCodeResetSession: () => ipc('claude-code:reset-session', {}),

    // --- LLM streaming (WebSocket) ---
    streamLLM: (payload) => bus.send('llm:stream', payload),
    onLLMDelta: (cb) => onEvent('llm:delta', cb),
    onLLMDone: (cb) => onEvent('llm:done', cb),
    onLLMError: (cb) => onEvent('llm:error', cb),

    // --- Proactive ---
    onProactiveTrigger: (cb) => onEvent('proactive-trigger', cb),

    // --- Setup ---
    onStartSetup: (cb) => onEvent('start-setup', cb),

    // --- Window control (Web版: single page) ---
    toggleChat: () => ipc('toggle-chat'),
    openChat: () => ipc('open-chat'),
    closeChat: () => ipc('close-chat'),
    openSettingsWindow: () => ipc('open-settings-window'),
    closeSettingsWindow: () => ipc('close-settings-window'),
    restartApp: () => ipc('restart-app'),
    selectModelFile: () => ipc('select-model-file'),
    readModelFile: (p) => ipc('read-model-file', p),
    listModelMotions: (p) => ipc('list-model-motions', p),
    selectMotionFile: () => ipc('select-motion-file'),
    getModelInfo: (p) => ipc('get-model-info', p),
    listAllMotions: () => ipc('list-all-motions'),
    applyCharacterSettings: (s) => ipc('apply-character-settings', s),
    getCharacterWindowBounds: () => ipc('get-character-window-bounds'),
    getDisplays: () => ipc('get-displays'),

    // --- Model Presets ---
    getModelPresets: () => ipc('model-presets:list'),
    saveModelPreset: (p) => ipc('model-presets:save', p),
    deleteModelPreset: (id) => ipc('model-presets:delete', id),

    // --- Events ---
    onSettingsChanged: (cb) => onEvent('settings-changed', cb),
    onConfigUpdated: (cb) => onEvent('config-updated', cb),
    onSelfGrowthPending: (cb) => onEvent('self-growth-pending', cb),
    selfGrowthApprove: (changes) => ipc('self-growth-approve', changes),

    // --- Lip Sync ---
    sendLipSync: (v) => bus.send('lip-sync', v),
    sendMotionTrigger: (m) => bus.send('motion-trigger', m),
    sendExpressionChange: (e) => bus.send('expression-change', e),
    ttsTestSpeak: (t) => bus.send('tts-test-speak', t),
    onTtsTestSpeak: (cb) => onEvent('tts-test-speak', cb),
    onLipSync: (cb) => onEvent('lip-sync', cb),
    onExpressionChange: (cb) => onEvent('expression-change', cb),
    onMotionTrigger: (cb) => onEvent('motion-trigger', cb),
    onSettingsChangedFull: (cb) => onEvent('settings-changed-full', cb),

    // --- Brain ---
    setBrainState: (s) => bus.send('brain:set-state', s),
    getEmotionState: () => ipc('get-emotion-state'),

    // --- Reflection ---
    onReflectionComplete: (cb) => onEvent('reflection-complete', cb),

    // --- Slots ---
    slotList: () => ipc('slot:list'),
    slotSwitch: (id) => ipc('slot:switch', id),
    slotCreate: (p) => ipc('slot:create', p),
    slotDuplicate: (p) => ipc('slot:duplicate', p),
    slotDelete: (id) => ipc('slot:delete', id),
    slotRename: (id, name) => ipc('slot:rename', { slotId: id, name }),
    onSlotChanged: (cb) => onEvent('slot-changed', cb),

    // --- Resource path ---
    getResourcePath: () => ipc('get-resource-path'),

    // --- Streaming ---
    onSubtitleUpdate: (cb) => onEvent('subtitle-update', cb),
    onCommentReceived: (cb) => onEvent('comment-received', cb),
    streamingTestOnecomme: (port) => ipc('streaming:test-onecomme', port),
    streamingTestYoutube: (id) => ipc('streaming:test-youtube', id),
    broadcastStart: () => ipc('broadcast:start', {}),
    broadcastStop: () => ipc('broadcast:stop', {}),

    // --- Export/Import ---
    exportData: () => ipc('export-data'),
    importData: () => ipc('import-data'),

    // --- Update ---
    checkForUpdates: () => ipc('check-for-updates'),
    getAppVersion: () => ipc('get-app-version'),
  };

  return adapter;
}
