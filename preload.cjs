const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  getMemory: () => ipcRenderer.invoke('get-memory'),
  saveMemory: (memory) => ipcRenderer.invoke('save-memory', memory),

  // Profile
  getProfile: () => ipcRenderer.invoke('get-profile'),
  saveProfile: (profile) => ipcRenderer.invoke('save-profile', profile),

  // Personality
  getPersonality: () => ipcRenderer.invoke('get-personality'),
  savePersonality: (personality) => ipcRenderer.invoke('save-personality', personality),
  getPersonalityPresets: () => ipcRenderer.invoke('get-personality-presets'),
  applyPersonalityPreset: (presetId) => ipcRenderer.invoke('apply-personality-preset', presetId),
  getCustomPresets: () => ipcRenderer.invoke('get-custom-presets'),
  saveCustomPreset: (preset) => ipcRenderer.invoke('save-custom-preset', preset),
  deleteCustomPreset: (presetId) => ipcRenderer.invoke('delete-custom-preset', presetId),

  // User
  getUser: () => ipcRenderer.invoke('get-user'),
  saveUser: (user) => ipcRenderer.invoke('save-user', user),

  // Memory V2
  getMemoryV2: () => ipcRenderer.invoke('get-memory-v2'),
  saveMemoryV2: (memory) => ipcRenderer.invoke('save-memory-v2', memory),
  openMemoryFolder: () => ipcRenderer.invoke('memory:openFolder'),

  // State
  getState: () => ipcRenderer.invoke('get-state'),
  saveState: (state) => ipcRenderer.invoke('save-state', state),

  // Settings
  getSettings: () => ipcRenderer.invoke('get-settings'),
  saveSettings: (settings) => ipcRenderer.invoke('save-settings', settings),

  // VRChat Log
  appendVrchatLog: (record) => ipcRenderer.invoke('append-vrchat-log', record),

  // History
  appendHistory: (record) => ipcRenderer.invoke('append-history', record),
  getHistory: (limit) => ipcRenderer.invoke('get-history', limit),
  getHistoryCount: () => ipcRenderer.invoke('get-history-count'),
  summarizeHistory: () => ipcRenderer.invoke('summarize-history'),

  // Memory System
  applyConversation: (data) => ipcRenderer.invoke('memory:applyConversation', data),
  getMemoryContext: () => ipcRenderer.invoke('memory:getContext'),

  // Config
  getConfig: () => ipcRenderer.invoke('get-config'),
  saveConfig: (config) => ipcRenderer.invoke('save-config', config),
  // Config Extended (multi-provider)
  getConfigExtended: () => ipcRenderer.invoke('get-config-extended'),
  saveConfigExtended: (config) => ipcRenderer.invoke('save-config-extended', config),
  getModelRegistry: () => ipcRenderer.invoke('get-model-registry'),
  getAvailableProviders: () => ipcRenderer.invoke('get-available-providers'),

  // Google OAuth
  oauthGoogleStart: () => ipcRenderer.invoke('oauth:google-start'),
  oauthGoogleLogout: () => ipcRenderer.invoke('oauth:google-logout'),
  oauthGoogleStatus: () => ipcRenderer.invoke('oauth:google-status'),

  // STT (Whisper)
  sttTranscribe: (audioBuffer, lang, mimeType, whisperModel) => ipcRenderer.invoke('stt:transcribe', audioBuffer, lang, mimeType, whisperModel),
  sttTranscribeLocal: (pcmData, lang) => ipcRenderer.invoke('stt:transcribe-local', pcmData, lang),
  sttLocalModelStatus: () => ipcRenderer.invoke('stt:local-model-status'),

  // TTS (OpenAI)
  ttsOpenaiSynthesize: (params) => ipcRenderer.invoke('tts:openai-synthesize', params),

  // TTS (ElevenLabs)
  ttsElevenlabsSynthesize: (params) => ipcRenderer.invoke('tts:elevenlabs-synthesize', params),

  // TTS (Google Cloud TTS)
  ttsGoogleSynthesize: (params) => ipcRenderer.invoke('tts:google-synthesize', params),

  // VOICEVOX
  voicevoxCheck: () => ipcRenderer.invoke('voicevox:check'),
  voicevoxSpeakers: () => ipcRenderer.invoke('voicevox:speakers'),
  voicevoxSynthesize: (params) => ipcRenderer.invoke('voicevox:synthesize', params),
  voicevoxSynthesizeWithPhonemes: (params) => ipcRenderer.invoke('voicevox:synthesize-with-phonemes', params),

  // AivisSpeech (VOICEVOX互換)
  aivisSpeechCheck: () => ipcRenderer.invoke('aivis-speech:check'),
  aivisSpeechSpeakers: () => ipcRenderer.invoke('aivis-speech:speakers'),
  aivisSpeechSynthesize: (params) => ipcRenderer.invoke('aivis-speech:synthesize', params),
  aivisSpeechSynthesizeWithPhonemes: (params) => ipcRenderer.invoke('aivis-speech:synthesize-with-phonemes', params),

  // Style-Bert-VITS2
  styleBertVits2Check: () => ipcRenderer.invoke('style-bert-vits2:check'),
  styleBertVits2Synthesize: (params) => ipcRenderer.invoke('style-bert-vits2:synthesize', params),

  // File parsing
  parseFile: (filePath) => ipcRenderer.invoke('parse-file', filePath),

  // OpenClaw
  openclawTest: (params) => ipcRenderer.invoke('openclaw:test', params),
  openclawResetSession: () => ipcRenderer.send('openclaw:reset-session'),

  // VRChat
  vrchatConnect: (params) => ipcRenderer.invoke('vrchat:connect', params),
  vrchatDisconnect: () => ipcRenderer.invoke('vrchat:disconnect'),
  vrchatStatus: () => ipcRenderer.invoke('vrchat:status'),
  vrchatTest: () => ipcRenderer.invoke('vrchat:test'),
  vrchatChatbox: (message) => ipcRenderer.invoke('vrchat:chatbox', message),
  vrchatOpenOverlay: () => ipcRenderer.invoke('vrchat:open-overlay'),
  vrchatCloseOverlay: () => ipcRenderer.invoke('vrchat:close-overlay'),
  vrchatInstallVbcable: () => ipcRenderer.invoke('vrchat:install-vbcable'),
  vrchatStartListener: () => ipcRenderer.invoke('vrchat:start-listener'),
  vrchatStopListener: () => ipcRenderer.invoke('vrchat:stop-listener'),
  vrchatListenerStatus: () => ipcRenderer.invoke('vrchat:listener-status'),
  vrchatFindProcess: () => ipcRenderer.invoke('vrchat:find-process'),
  onVrchatListenerTranscript: (cb) => ipcRenderer.on('vrchat-listener-transcript', (_e, text) => cb(text)),
  onVrchatListenerState: (cb) => ipcRenderer.on('vrchat-listener-state', (_e, state) => cb(state)),

  // Shell
  openExternal: (url) => ipcRenderer.invoke('open-external', url),

  // External API: ClaudeCode等からの音声読み上げリクエスト
  onExternalSpeak: (callback) => {
    ipcRenderer.removeAllListeners('external:speak');
    ipcRenderer.on('external:speak', (_, text) => callback(text));
  },

  // External API: 設定変更を通知
  updateExternalApi: (config) => ipcRenderer.send('external-api:update', config),

  // External message (from VR overlay etc.)
  onExternalMessage: (callback) => {
    ipcRenderer.removeAllListeners('external-message');
    ipcRenderer.on('external-message', (_, data) => callback(data));
  },

  // VR Overlay
  vrOverlaySend: (text) => ipcRenderer.send('vr-overlay:send', text),
  onVrOverlayMessage: (callback) => {
    ipcRenderer.removeAllListeners('vr-overlay:message');
    ipcRenderer.on('vr-overlay:message', (_, data) => callback(data));
  },
  onVrOverlayDelta: (callback) => {
    ipcRenderer.removeAllListeners('vr-overlay:delta');
    ipcRenderer.on('vr-overlay:delta', (_, delta) => callback(delta));
  },
  onVrOverlayDone: (callback) => {
    ipcRenderer.removeAllListeners('vr-overlay:done');
    ipcRenderer.on('vr-overlay:done', () => callback());
  },

  // Claude Code Bridge
  claudeCodeResetSession: () => ipcRenderer.invoke('claude-code:reset-session'),

  // LLM streaming
  streamLLM: (payload) => ipcRenderer.send('llm:stream', payload),
  onLLMDelta: (callback) => {
    ipcRenderer.removeAllListeners('llm:delta');
    ipcRenderer.on('llm:delta', (_, delta) => callback(delta));
  },
  onLLMDone: (callback) => {
    ipcRenderer.removeAllListeners('llm:done');
    ipcRenderer.on('llm:done', () => callback());
  },
  onLLMError: (callback) => {
    ipcRenderer.removeAllListeners('llm:error');
    ipcRenderer.on('llm:error', (_, error) => callback(error));
  },

  // Proactive
  onProactiveTrigger: (callback) => {
    ipcRenderer.removeAllListeners('proactive-trigger');
    ipcRenderer.on('proactive-trigger', (_, payload) => callback(payload));
  },

  // Setup
  onStartSetup: (callback) => {
    ipcRenderer.removeAllListeners('start-setup');
    ipcRenderer.on('start-setup', () => callback());
  },

  // Chat Window Control
  toggleChat: () => ipcRenderer.invoke('toggle-chat'),
  openChat: () => ipcRenderer.invoke('open-chat'),
  closeChat: () => ipcRenderer.invoke('close-chat'),

  // Settings Window Control
  openSettingsWindow: () => ipcRenderer.invoke('open-settings-window'),
  closeSettingsWindow: () => ipcRenderer.invoke('close-settings-window'),
  restartApp: () => ipcRenderer.invoke('restart-app'),
  selectModelFile: () => ipcRenderer.invoke('select-model-file'),
  readModelFile: (filePath) => ipcRenderer.invoke('read-model-file', filePath),
  listModelMotions: (modelPath) => ipcRenderer.invoke('list-model-motions', modelPath),
  selectMotionFile: () => ipcRenderer.invoke('select-motion-file'),
  getModelInfo: (modelPath) => ipcRenderer.invoke('get-model-info', modelPath),
  listAllMotions: () => ipcRenderer.invoke('list-all-motions'),
  applyCharacterSettings: (settings) => ipcRenderer.invoke('apply-character-settings', settings),
  getCharacterWindowBounds: () => ipcRenderer.invoke('get-character-window-bounds'),
  getDisplays: () => ipcRenderer.invoke('get-displays'),

  // Model Presets
  getModelPresets: () => ipcRenderer.invoke('model-presets:list'),
  saveModelPreset: (preset) => ipcRenderer.invoke('model-presets:save', preset),
  deleteModelPreset: (presetId) => ipcRenderer.invoke('model-presets:delete', presetId),

  // Settings changed event (for character window)
  onSettingsChanged: (callback) => {
    ipcRenderer.removeAllListeners('settings-changed');
    ipcRenderer.on('settings-changed', (_, settings) => callback(settings));
  },

  // Config update feedback
  onConfigUpdated: (callback) => {
    ipcRenderer.removeAllListeners('config-updated');
    ipcRenderer.on('config-updated', (_, payload) => callback(payload));
  },

  // selfGrowth: 性格自動成長
  onSelfGrowthPending: (callback) => {
    ipcRenderer.removeAllListeners('self-growth-pending');
    ipcRenderer.on('self-growth-pending', (_, payload) => callback(payload));
  },
  selfGrowthApprove: (changes) => ipcRenderer.invoke('self-growth-approve', changes),

  // Lip Sync（ウィンドウ間通信）
  sendLipSync: (value, form) => ipcRenderer.send('lip-sync', value, form),
  sendMotionTrigger: (motion) => ipcRenderer.send('motion-trigger', motion),
  sendExpressionChange: (expression) => ipcRenderer.send('expression-change-send', expression),
  ttsTestSpeak: (text) => ipcRenderer.send('tts-test-speak', text),
  onTtsTestSpeak: (callback) => {
    ipcRenderer.removeAllListeners('tts-test-speak');
    ipcRenderer.on('tts-test-speak', (_, text) => callback(text));
  },
  onLipSync: (callback) => {
    ipcRenderer.removeAllListeners('lip-sync');
    ipcRenderer.on('lip-sync', (_, value, form) => callback(value, form));
  },

  // Expression Change（感情による表情変更）
  onExpressionChange: (callback) => {
    ipcRenderer.removeAllListeners('expression-change');
    ipcRenderer.on('expression-change', (_, expression) => callback(expression));
  },

  // Motion Trigger（感情遷移イベント）
  onMotionTrigger: (callback) => {
    ipcRenderer.removeAllListeners('motion-trigger');
    ipcRenderer.on('motion-trigger', (_, motion) => callback(motion));
  },

  // Settings changed full event (for chat window - STT/TTS/theme etc.)
  onSettingsChangedFull: (callback) => {
    ipcRenderer.removeAllListeners('settings-changed-full');
    ipcRenderer.on('settings-changed-full', (_, settings) => callback(settings));
  },

  // Brain state sync (Interrupt Gate)
  setBrainState: (state) => ipcRenderer.send('brain:set-state', state),

  // 感情状態取得（テンポ制御用）
  getEmotionState: () => ipcRenderer.invoke('get-emotion-state'),

  // Reflection complete event
  onReflectionComplete: (callback) => {
    ipcRenderer.removeAllListeners('reflection-complete');
    ipcRenderer.on('reflection-complete', (_, result) => callback(result));
  },

  // Slot management
  slotList: () => ipcRenderer.invoke('slot:list'),
  slotSwitch: (slotId) => ipcRenderer.invoke('slot:switch', slotId),
  slotCreate: (params) => ipcRenderer.invoke('slot:create', params),
  slotDuplicate: (params) => ipcRenderer.invoke('slot:duplicate', params),
  slotDelete: (slotId) => ipcRenderer.invoke('slot:delete', slotId),
  slotRename: (slotId, name) => ipcRenderer.invoke('slot:rename', slotId, name),

  // Slot changed event
  onSlotChanged: (callback) => {
    ipcRenderer.removeAllListeners('slot-changed');
    ipcRenderer.on('slot-changed', (_, slot) => callback(slot));
  },

  // Resource path for production (Live2D files)
  getResourcePath: () => ipcRenderer.invoke('get-resource-path'),

  // Streaming Mode
  onSubtitleUpdate: (callback) => {
    ipcRenderer.removeAllListeners('subtitle-update');
    ipcRenderer.on('subtitle-update', (_, data) => callback(data));
  },
  onCommentReceived: (callback) => {
    ipcRenderer.removeAllListeners('comment-received');
    ipcRenderer.on('comment-received', (_, comment) => callback(comment));
  },
  streamingTestOnecomme: (port) => ipcRenderer.invoke('streaming:test-onecomme', port),
  streamingTestYoutube: (videoId) => ipcRenderer.invoke('streaming:test-youtube', videoId),
  broadcastStart: () => ipcRenderer.invoke('broadcast:start'),
  broadcastStop: () => ipcRenderer.invoke('broadcast:stop'),

  // Data Export/Import
  exportData: () => ipcRenderer.invoke('export-data'),
  importData: () => ipcRenderer.invoke('import-data'),

  // Persona Export/Import
  personaExport: () => ipcRenderer.invoke('persona:export'),
  personaImport: () => ipcRenderer.invoke('persona:import'),

  // Update Check
  checkForUpdates: () => ipcRenderer.invoke('check-for-updates'),
  getAppVersion: () => ipcRenderer.invoke('get-app-version'),

  // SDK Setup
  sdkSetupOpenDownload: () => ipcRenderer.send('sdk-setup:open-download'),
  sdkSetupSkip: (dontShow) => ipcRenderer.send('sdk-setup:skip', dontShow),
  sdkSetupSelectFile: () => ipcRenderer.send('sdk-setup:select-file'),
  sdkSetupExtract: (filePath) => ipcRenderer.send('sdk-setup:extract', filePath),
  sdkSetupCopyJs: (filePath) => ipcRenderer.send('sdk-setup:copy-js', filePath),
  sdkSetupDropBuffer: (data) => ipcRenderer.send('sdk-setup:drop-buffer', data),
  onSdkSetupResult: (callback) => {
    ipcRenderer.removeAllListeners('sdk-setup:result');
    ipcRenderer.on('sdk-setup:result', (_, result) => callback(result));
  },
  onSdkSetupFileSelected: (callback) => {
    ipcRenderer.removeAllListeners('sdk-setup:file-selected');
    ipcRenderer.on('sdk-setup:file-selected', (_, filePath) => callback(filePath));
  },

  // Character window: hit-test click-through + manual drag
  setIgnoreMouseEvents: (ignore, opts) => ipcRenderer.send('set-ignore-mouse-events', ignore, opts),
  moveWindowBy: (dx, dy) => ipcRenderer.send('move-window-by', dx, dy),

  // Docked mode: window controls
  minimizeWindow: () => ipcRenderer.invoke('minimize-window'),
  hideWindow: () => ipcRenderer.invoke('hide-window'),

  // Docked mode: tab switching
  onSwitchDockedTab: (callback) => {
    ipcRenderer.removeAllListeners('switch-docked-tab');
    ipcRenderer.on('switch-docked-tab', (_, tabName) => callback(tabName));
  },
});
