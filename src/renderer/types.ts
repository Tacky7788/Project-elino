// Shared type definitions for renderer

export interface PhonemeEvent {
  time: number;       // 開始時刻（秒）
  duration: number;   // 持続時間（秒）
  vowel: string;      // 母音 (a, i, u, e, o, N, pau)
  mouthOpenY: number; // 口の開き 0-1
  mouthForm: number;  // 口の形 -1〜1 (負=すぼめ、正=横開き)
}

export interface Memory {
  date: string;
  goal: string;
  status: 'done' | 'partial' | 'not_started' | 'none';
  nextStep: string;
}

export interface Profile {
  mode: 'private' | 'public';
  companionName: string;
  callUser: string;
  interests?: string[];
}

export interface PersonalityReactions {
  agree: string[];
  disagree: string[];
  excited: string[];
  tease: string[];
  comfort: string[];
}

export interface Personality {
  mode?: 'simple' | 'freeEdit';      // Editing mode (default: 'simple')
  freeEditPrompt?: string;           // Raw prompt for freeEdit mode
  traits: string[];
  speechStyle: string[];
  forbidden?: string[];
  guidance?: string[];
  coreIdentity?: string[];
  identity?: string;
  weaknesses?: string[];
  quirks?: string[];
  reactions?: PersonalityReactions;
  reactionVocabulary?: Record<string, string[]>;
  exampleConversation?: string[];
  conversationExamples?: string[];
}

export interface PersonalityPreset {
  id: string;
  name: string;
  description: string;
  personality: Personality;
}

export interface MemoryV2Fact {
  key: string;
  content: string;
  addedAt: string;
  lastSeenAt: string;
  seenCount: number;
  importance: 'high' | 'medium' | 'low';
  recallScore?: number;       // 記憶減衰スコア (0-1, 低いとアーカイブ)
  emotionalContext?: {
    valence: number;          // 記憶形成時の感情価 (0-1)
    arousal: number;          // 記憶形成時の覚醒度 (0-1)
  };
  recallCount?: number;       // 想起された回数（多いほど定着）
  decayRate?: number;         // 減衰速度（低いほど忘れにくい, デフォルト1.0）
}

export interface MemoryV2Summary {
  date: string;
  content: string;
}

export interface EmotionDimensions {
  valence: number;      // 快-不快 (0-1, 0.5=中立)
  arousal: number;      // 覚醒度 (0-1, 0.5=中程度)
  dominance: number;    // 支配-受動 (0-1, 0.5=中立)
  trust: number;        // 信頼感 (0-1)
  fatigue: number;      // 会話疲労 (0-1)
  energy?: number;      // 体力 (0-1, 時間で減少)
  boredom?: number;     // 話したさ (0-1, 沈黙で増加)
  uncertainty?: number; // 確信度 (0-1, 1-competence)
  surprise?: number;    // 瞬間成分 (0-1, 50%/ターン減衰)
}

export interface AppraisalRecord {
  situation: string;
  interpretation: string;
  triggeredAt: string;
}

export interface EmotionalState {
  current: EmotionDimensions;
  recentAppraisals: AppraisalRecord[];  // 直近3件
  dailyMood: {
    date: string;
    avgValence: number;
    avgArousal: number;
  };
  traits: {
    anxietyProne: number;
    angerProne: number;
    cautious: number;
  };
  needs: {
    connection: number;
    autonomy: number;
    competence: number;
  };
  dominantEmotion?: { dimension: string; value: number; since: string } | null;
  dominantEmotionExpiry?: string | null;
  lastExpression?: string;
  lastExpressionTime?: number;
  prevEmotions?: EmotionDimensions | null;
  lastUpdated: string;
}

export interface RelationshipEpisode {
  content: string;
  date: string;
  type: 'bonding' | 'conflict' | 'milestone' | 'shared';
}

export interface MemoryV2Relationship {
  interactionCount: number;
  lastInteraction: string | null;
  firstMet: string;
  episodes?: RelationshipEpisode[];
  emotions?: EmotionalState;
}

export interface MemoryV2Topics {
  recent: string[];
  favorites: string[];
  avoided: string[];
  mentioned: Record<string, { count: number; lastMentioned: string }>;
}

export interface MemoryV2Promise {
  content: string;
  madeAt: string;
  status: 'pending' | 'fulfilled' | 'resolved' | 'deferred';
  deadline: string | null;
  fulfilledAt?: string;
  type?: 'promise' | 'open_loop';
  resolvedAt?: string | null;
  lastFollowedUp?: string | null;
  priority?: 'high' | 'medium' | 'low';
}

export interface MemoryV2Impressions {
  ofUser: string[];
  fromUser: string[];
}

export interface MemoryV2ContextPolicy {
  maxFacts: number;
  maxSummaries: number;
  maxTopics: number;
  maxPromises: number;
}

export interface NotebookEntry {
  id: string;
  type: 'note' | 'diary' | 'task';
  content: string;
  createdAt: string;
  updatedAt: string;
  status?: 'active' | 'done' | 'dropped';
  priority?: 'low' | 'normal' | 'high';
  dueAt?: string;
  tags?: string[];
}

export interface MemoryV2 {
  facts: MemoryV2Fact[];
  summaries: MemoryV2Summary[];
  relationship: MemoryV2Relationship;
  topics: MemoryV2Topics;
  promises: MemoryV2Promise[];
  impressions: MemoryV2Impressions;
  contextPolicy: MemoryV2ContextPolicy;
  archivedFacts?: MemoryV2Fact[];  // recallScore低下でアーカイブされた記憶
  notebook?: NotebookEntry[];
  updatedAt: string;
  rev: number;
}

export interface SlotInfo {
  id: string;
  name: string;
  presetBase: string;
  createdAt: string;
}

export interface QuestionBudget {
  askedLastTurn: boolean;
  consecutiveQuestions: number;
  lastQuestionAt: number | null;
  questionCooldownSec: number;
  questionCount: number;
  statementStreak: number;
}

export interface State {
  windowVisible: boolean;
  lastActiveAt: string;
  lastProactiveDate: string;
  setupComplete: boolean;
  lastMessageAt: string | null;
  lastAssistantMessageAt: string | null;
  turnCount: number;
  sessionTurnCount: number;
  questionBudget: QuestionBudget;
  lastBrainAction: { type: string; at: number } | null;
  lastReflectionDate?: string;
  rev: number;
}

export interface User {
  name: string;
  interests: string[];
  facts: string[];
  preferences: {
    talkStyle: string;
    topics: string[];
  };
  createdAt: string;
  updatedAt: string;
}

export interface EmotionMapEntry {
  motion: string;   // motion3.jsonファイル名（空=デフォルト動作）
  label: string;    // UI表示名（日本語）
  tags: string[];   // AIタグのエイリアス
}

export interface CharacterSettings {
  window: { width: number; height: number; x?: number; y?: number };
  model: {
    path: string;
    scale: number;
    x: number;
    y: number;
    anchorX: number;
    anchorY: number;
  };
  resolution: number;
  fps?: number;  // 描画フレームレート上限（デフォルト30）
  idleMotion: string;
  tapMotion: string;
  stateMotionMap?: Record<string, string>;  // state名 → motion3.jsonパス (talk, thinking等)
  modelType?: 'live2d' | 'vrm';
  physicsEnabled?: boolean;
  emotionMap?: Record<string, EmotionMapEntry>;
  vrm?: {
    cameraDistance: number;
    cameraHeight: number;
    lightIntensity: number;
    modelX?: number;
    modelY?: number;
    cameraAngleX?: number;  // 水平回転（度）-180~180, 0=正面
    cameraAngleY?: number;  // 垂直チルト（度）-60~60, 0=水平, 正=見上げ
  };
}

export interface ModelPreset {
  id: string;
  name: string;
  character: CharacterSettings;
  createdAt: string;
}

export interface CharacterRenderer {
  init(canvas: HTMLCanvasElement, settings: CharacterSettings): Promise<void>;
  setExpression(name: string): void;
  playMotion(name: string): void;
  setMouthOpen(openY: number, form?: number): void;
  reload(settings: CharacterSettings): Promise<void>;
  updateTransform(settings: CharacterSettings): void;
  destroy(): void;
  // モデルインスタンス取得（オプション）
  getModel?(): any;
  // モーション状態制御（オプション）
  setMotionState?(state: 'idle' | 'talk' | 'listen' | 'thinking' | 'sad'): void;
  setTalkIntensity?(intensity: number): void;
  // 感情タグ解析（オプション）
  parseEmotionTags?(text: string): { cleanText: string; expression: string | null };
}

export interface StreamingSettings {
  enabled: boolean;
  broadcastMode: boolean;  // 配信モードON/OFF
  subtitle: {
    enabled: boolean;
    fontSize: number;       // px, default 28
    fadeAfterMs: number;    // ms, default 3000
  };
  commentSource: 'none' | 'youtube' | 'onecomme';
  youtube: {
    videoId: string;
    pollingIntervalMs: number; // default 5000
  };
  onecomme: {
    port: number;             // default 11180
  };
  commentFilter: {
    ignoreHashPrefix: boolean; // default true
    maxQueueSize: number;      // default 20
    minLengthChars: number;    // default 2
  };
  broadcastIdle: {
    enabled: boolean;          // アイドル時の自発発言
    intervalSeconds: number;   // default 30
  };
  safety?: {
    customNgWords: string[];
    customSoftblockWords: string[];
  };
  customInstructions?: string;
}

export interface BroadcastComment {
  id: string;
  author: string;
  text: string;
  platform: 'youtube' | 'onecomme';
  timestamp: number;
  score?: number;
}

export type LLMProvider = 'claude' | 'openai' | 'gemini' | 'groq' | 'deepseek';

export interface Settings {
  llm: {
    provider: LLMProvider;
    model: string;
    stream: boolean;
    maxTokens?: number;
    utilityProvider?: LLMProvider;
    utilityModel?: string;
  };
  limits: {
    historyTurns: number;
    summaryThreshold: number;
  };
  proactive: {
    enabled: boolean;
    onStartup: boolean;
    idleMinutes: number;
    idleChance: number;
    afterChatMinutes: number;
    afterChatChance: number;
    quietHoursEnabled?: boolean;
    quietHoursStart?: number;
    quietHoursEnd?: number;
  };
  character: CharacterSettings;
  theme?: 'light' | 'dark' | 'system';
  language?: 'ja' | 'en';
  tts?: {
    enabled: boolean;
    engine: 'web-speech' | 'voicevox' | 'openai' | 'elevenlabs' | 'google-tts' | 'aivis-speech' | 'style-bert-vits2' | 'openai-compat-tts' | 'none';
    webSpeech: { lang: string; rate: number; pitch: number };
    voicevox: { baseUrl: string; speakerId: number; speed?: number; pitch?: number; intonationScale?: number };
    openai?: { voice: string; model: string; speed: number };
    elevenlabs?: { voiceId: string; model: string; stability: number; similarityBoost: number; speed: number };
    googleTts?: { languageCode: string; voiceName: string; speakingRate: number; pitch: number; useGeminiKey: boolean };
    aivisSpeech?: { baseUrl: string; speakerId: number; speed: number; pitch: number; intonationScale?: number };
    styleBertVits2?: { baseUrl: string; modelId: number; speakerId: number; style: string; styleWeight: number; language: string; speed: number };
    openaiCompatTts?: { baseUrl: string; apiKey: string; model: string; voice: string; speed: number };
  };
  stt?: {
    enabled: boolean;
    engine: 'web-speech' | 'whisper' | 'whisper-local';
    autoSend: boolean;
    alwaysOn: boolean;
    lang: string;
  };
  lipSync?: {
    enabled: boolean;
    mode: 'simple' | 'amplitude' | 'phoneme';
  };
  activePersonalityPreset?: string;
  openclaw?: {
    enabled: boolean;
    gatewayUrl: string;
    token: string;
    agentId: string;
    agentMode: boolean;
    maxTokens?: number;
  };
  claudeCode?: {
    enabled: boolean;
  };
  externalApi?: {
    enabled: boolean;
    port: number;
  };
  streaming?: StreamingSettings;
  memory?: {
    searchEnabled?: boolean;       // 会話時に記憶を参照する（デフォルト: true）
    vectorSearchEnabled?: boolean; // セマンティック記憶ベクター検索（デフォルト: false）
  };
  chat?: {
    segmentSplit?: boolean; // メッセージを複数バブルに分割表示（デフォルト: true）
  };
  persona?: {
    proactiveFrequency: number;  // 0-100 話しかけ頻度
  };
  selfGrowth?: {
    enabled: boolean;
    allowTraits: boolean;
    allowSpeechStyle: boolean;
    allowReactions: boolean;
    requireConfirmation: boolean;
    history?: Array<{ date: string; changes: Record<string, unknown> }>;
  };
  vrchat?: {
    enabled: boolean;
    host: string;
    sendPort: number;
    chatbox: {
      enabled: boolean;
      playSound: boolean;
    };
    expressionSync: boolean;
    expressionParamType: 'bool' | 'int' | 'float';
    expressionMap: Record<string, string>;
    audioDeviceId?: string;
  };
}

export interface HistoryRecord {
  ts: string;
  role: 'user' | 'assistant';
  text: string; // 履歴保存時はテキストのみ（画像は[Image]マーカー）
}

export interface ElectronAPI {
  // Memory
  getMemory: () => Promise<Memory>;
  saveMemory: (memory: Memory) => Promise<void>;
  // Profile
  getProfile: () => Promise<Profile>;
  saveProfile: (profile: Profile) => Promise<void>;
  // Personality
  getPersonality: () => Promise<Personality>;
  savePersonality: (personality: Personality) => Promise<void>;
  getPersonalityPresets: () => Promise<PersonalityPreset[]>;
  applyPersonalityPreset: (presetId: string) => Promise<void>;
  getCustomPresets: () => Promise<PersonalityPreset[]>;
  saveCustomPreset: (preset: PersonalityPreset) => Promise<void>;
  deleteCustomPreset: (presetId: string) => Promise<void>;
  // User
  getUser: () => Promise<User>;
  saveUser: (user: User) => Promise<void>;
  // Memory V2
  getMemoryV2: () => Promise<MemoryV2>;
  saveMemoryV2: (memory: MemoryV2) => Promise<void>;
  openMemoryFolder: () => Promise<void>;
  // State
  getState: () => Promise<State>;
  saveState: (state: State) => Promise<void>;
  // Settings
  getSettings: () => Promise<Settings>;
  saveSettings: (settings: Settings) => Promise<void>;
  // History
  appendHistory: (record: HistoryRecord) => Promise<void>;
  getHistory: (limit?: number) => Promise<HistoryRecord[]>;
  getHistoryCount: () => Promise<number>;
  summarizeHistory: () => Promise<{ success: boolean; summary?: string; reason?: string }>;
  // Memory System
  applyConversation: (data: { userMessage: string; assistantMessage: string; emotionOnly?: boolean }) => Promise<{ success: boolean; reason?: string }>;
  getMemoryContext: () => Promise<{
    facts: Array<{ key: string; content: string; importance: string; seenCount: number }>;
    summaries: Array<{ date: string; content: string }>;
    topics: string[];
    promises: Array<{ content: string; status: string }>;
    relationship: { interactionCount: number; affinity: number; trust: number; mood: string; firstMet: string };
    impressions: { ofUser: string[]; fromUser: string[] };
    avoidedTopics: string[];
  }>;
  // Config
  getConfig: () => Promise<{ hasApiKey: boolean }>;
  saveConfig: (config: { openaiApiKey: string }) => Promise<void>;
  // Config Extended (multi-provider)
  getConfigExtended: () => Promise<{
    hasAnthropicKey: boolean;
    hasOpenaiKey: boolean;
    hasGoogleKey: boolean;
    hasGroqKey: boolean;
    hasDeepseekKey: boolean;
    hasElevenlabsKey: boolean;
    anthropicFromEnv: boolean;
    openaiFromEnv: boolean;
    googleFromEnv: boolean;
    groqFromEnv: boolean;
    deepseekFromEnv: boolean;
    elevenlabsFromEnv: boolean;
    googleOAuth: boolean;
    googleOAuthEmail: string;
    googleOAuthClientId: string;
    googleOAuthClientSecret: string;
  }>;
  saveConfigExtended: (config: Record<string, string>) => Promise<void>;
  getModelRegistry: () => Promise<Record<string, Array<{ id: string; label: string; multiModal: boolean }>>>;
  getAvailableProviders: () => Promise<string[]>;
  // Google OAuth
  oauthGoogleStart: () => Promise<{ success: boolean; email?: string; error?: string }>;
  oauthGoogleLogout: () => Promise<void>;
  oauthGoogleStatus: () => Promise<{ loggedIn: boolean; email?: string }>;
  // LLM
  streamLLM: (payload: { messages: Array<{ role: string; content: any }>; isProactive?: boolean; context?: unknown; useOpenClaw?: boolean; useClaudeCode?: boolean }) => void;
  claudeCodeResetSession: () => Promise<{ ok: boolean }>;
  // OpenClaw
  openclawTest: (params: { gatewayUrl: string; token: string; agentId: string }) => Promise<{ success: boolean; error?: string }>;
  // Shell
  openExternal: (url: string) => Promise<void>;
  // VRChat
  vrchatConnect: (params: { host: string; port: number }) => Promise<{ success: boolean }>;
  vrchatDisconnect: () => Promise<{ success: boolean }>;
  vrchatStatus: () => Promise<{ connected: boolean }>;
  vrchatTest: () => Promise<{ success: boolean }>;
  vrchatChatbox: (message: string) => Promise<{ success: boolean }>;
  vrchatInstallVbcable: () => Promise<{ success: boolean; error?: string }>;
  onLLMDelta: (callback: (delta: string) => void) => void;
  onLLMDone: (callback: () => void) => void;
  onLLMError: (callback: (error: string) => void) => void;
  // Proactive
  onProactiveTrigger: (callback: (payload: { trigger: string; context: unknown }) => void) => void;
  // Setup
  onStartSetup: (callback: () => void) => void;
  // Config update feedback
  onConfigUpdated: (callback: (payload: { target: string; summary: string }) => void) => void;
  // selfGrowth
  onSelfGrowthPending: (callback: (payload: { changes: Record<string, unknown> }) => void) => void;
  selfGrowthApprove: (data: { changes: Record<string, unknown> }) => Promise<{ ok: boolean; error?: string }>;
  // Chat Window Control
  toggleChat: () => Promise<void>;
  openChat: () => Promise<void>;
  closeChat: () => Promise<void>;
  // Settings Window Control
  openSettingsWindow: () => Promise<void>;
  closeSettingsWindow: () => Promise<void>;
  restartApp: () => Promise<void>;
  selectModelFile: () => Promise<string | null>;
  readModelFile: (filePath: string) => Promise<{ success: boolean; buffer?: ArrayBuffer; error?: string }>;
  applyCharacterSettings: (settings: CharacterSettings) => Promise<{ success: boolean }>;
  getCharacterWindowBounds: () => Promise<{ x: number; y: number; width: number; height: number } | null>;
  getDisplays: () => Promise<Array<{ index: number; id: number; label: string; width: number; height: number; isPrimary: boolean }>>;
  // Model Presets
  getModelPresets: () => Promise<ModelPreset[]>;
  saveModelPreset: (preset: ModelPreset) => Promise<void>;
  deleteModelPreset: (presetId: string) => Promise<void>;
  // Settings changed event (for character window)
  onSettingsChanged: (callback: (settings: CharacterSettings) => void) => void;
  // Resource path for production (Live2D files)
  getResourcePath: () => Promise<string | null>;
  // STT (Whisper)
  sttTranscribe: (audioBuffer: ArrayBuffer, lang: string, mimeType?: string, whisperModel?: string) => Promise<string>;
  sttTranscribeLocal: (pcmData: ArrayBuffer, lang: string) => Promise<string>;
  sttLocalModelStatus: () => Promise<{ loaded: boolean; loading: boolean; modelId: string }>;
  // TTS (OpenAI)
  ttsOpenaiSynthesize: (params: { text: string; voice: string; model: string; speed: number }) => Promise<ArrayBuffer>;
  // TTS (ElevenLabs)
  ttsElevenlabsSynthesize: (params: { text: string; voiceId: string; model: string; stability: number; similarityBoost: number; speed: number }) => Promise<ArrayBuffer>;
  // TTS (Google Cloud TTS)
  ttsGoogleSynthesize: (params: { text: string; languageCode: string; voiceName: string; speakingRate: number; pitch: number; useGeminiKey: boolean }) => Promise<ArrayBuffer>;
  // VOICEVOX
  voicevoxCheck: () => Promise<{ available: boolean; version?: string; error?: string }>;
  voicevoxSpeakers: () => Promise<{ success: boolean; speakers?: unknown[]; error?: string }>;
  voicevoxSynthesize: (params: { text: string; speakerId: number }) => Promise<ArrayBuffer>;
  voicevoxSynthesizeWithPhonemes: (params: { text: string; speakerId: number }) => Promise<{ audio: ArrayBuffer; phonemes: PhonemeEvent[] }>;
  // AivisSpeech (VOICEVOX互換)
  aivisSpeechCheck: () => Promise<{ available: boolean; version?: string; error?: string }>;
  aivisSpeechSpeakers: () => Promise<{ success: boolean; speakers?: unknown[]; error?: string }>;
  aivisSpeechSynthesize: (params: { text: string; speakerId: number }) => Promise<ArrayBuffer>;
  aivisSpeechSynthesizeWithPhonemes: (params: { text: string; speakerId: number }) => Promise<{ audio: ArrayBuffer; phonemes: PhonemeEvent[] }>;
  // Style-Bert-VITS2
  styleBertVits2Check: () => Promise<{ available: boolean; error?: string }>;
  styleBertVits2Synthesize: (params: { text: string; modelId: number; speakerId: number; style: string; styleWeight: number; language: string; speed: number }) => Promise<ArrayBuffer>;
  // File parsing
  parseFile: (filePath: string) => Promise<{ text: string; pageCount?: number }>;
  // Lip Sync IPC (chat → character window bridge)
  sendLipSync: (value: number) => void;
  onLipSync: (callback: (value: number) => void) => void;
  // Motion Trigger IPC (chat → character window bridge)
  sendMotionTrigger?: (motion: string) => void;
  // Expression Change IPC (emotion → character expression)
  onExpressionChange: (callback: (expression: string) => void) => void;
  // Motion Trigger IPC (emotion transition → motion)
  onMotionTrigger: (callback: (motion: string) => void) => void;
  // Settings changed full event (for chat window - STT/TTS/theme etc.)
  onSettingsChangedFull: (callback: (settings: Settings) => void) => void;
  // Brain state sync (Interrupt Gate)
  setBrainState: (state: { doNotDisturb?: boolean; isMicListening?: boolean }) => void;
  // 感情状態取得（テンポ制御用）
  getEmotionState: () => Promise<{ arousal: number; energy: number; valence: number; surprise: number }>;
  // Reflection complete event
  onReflectionComplete: (callback: (result: { summary: string; insight: string }) => void) => void;
  // Slot management
  slotList: () => Promise<{ activeSlotId: string; slots: SlotInfo[] }>;
  slotSwitch: (slotId: string) => Promise<void>;
  slotCreate: (params: { name: string; presetId: string }) => Promise<SlotInfo>;
  slotDuplicate: (params: { name: string }) => Promise<SlotInfo>;
  slotDelete: (slotId: string) => Promise<void>;
  slotRename: (slotId: string, name: string) => Promise<void>;
  // Slot changed event
  onSlotChanged: (callback: (slot: SlotInfo) => void) => void;
  // Streaming / Broadcast Mode
  onSubtitleUpdate: (callback: (data: { text: string; clear: boolean }) => void) => void;
  onCommentReceived: (callback: (comment: { author: string; text: string; platform: string; id: string }) => void) => void;
  streamingTestOnecomme: (port: number) => Promise<{ success: boolean; error?: string }>;
  streamingTestYoutube: (videoId: string) => Promise<{ success: boolean; error?: string }>;
  broadcastStart: () => Promise<void>;
  broadcastStop: () => Promise<void>;
  // Data Export/Import
  exportData: () => Promise<{ success: boolean; filePath?: string; error?: string }>;
  importData: () => Promise<{ success: boolean; error?: string }>;
  // Persona Export/Import
  personaExport: () => Promise<{ success: boolean; filePath?: string; error?: string }>;
  personaImport: () => Promise<{ success: boolean; name?: string; error?: string }>;
  // Update Check
  checkForUpdates: () => Promise<{ hasUpdate: boolean; currentVersion: string; latestVersion?: string; releaseUrl?: string; error?: string }>;
  getAppVersion: () => Promise<string>;
  // Expression/Motion test controls (settings window)
  sendExpressionChange?: (expression: string) => void;
  // TTS test
  ttsTestSpeak?: (text: string) => void;
  onTtsTestSpeak?: (callback: (text: string) => void) => void;
  // Model info
  listModelMotions?: (modelPath: string) => Promise<string[]>;
  listAllMotions?: () => Promise<string[]>;
  selectMotionFile?: () => Promise<string | null>;
  getModelInfo?: (modelPath: string) => Promise<unknown>;
  // External API
  onExternalSpeak: (callback: (text: string) => void) => void;
  updateExternalApi: (config: { enabled: boolean; port: number }) => void;
  // OpenClaw
  openclawResetSession?: () => void;
  // External message
  onExternalMessage?: (callback: (data: any) => void) => void;
  // VR Overlay
  vrOverlaySend?: (text: string) => void;
  onVrOverlayMessage?: (callback: (data: any) => void) => void;
  onVrOverlayDelta?: (callback: (delta: string) => void) => void;
  onVrOverlayDone?: (callback: () => void) => void;
  // VRChat overlay window
  vrchatOpenOverlay?: () => Promise<void>;
  vrchatCloseOverlay?: () => Promise<void>;
}

declare global {
  interface Window {
    electronAPI: ElectronAPI;
  }
}
