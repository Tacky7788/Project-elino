// チャットUI + LLMストリーミング + 要約 + プロアクティブ + 音声機能

import { platform } from './platform';
import { ttsService, TTS_AUDIO_READY_EVENT, TTS_PHONEME_READY_EVENT } from './tts-service';
import { lipSyncService } from './lip-sync-service';
import { sttService } from './stt-service';
import { t, initI18n, applyDOMTranslations } from './locales';
import type { Memory, Profile, User, Settings, State, HistoryRecord, MemoryV2 } from './types';
import './types'; // Import for global type declaration

// 型定義
type MicState = 'idle' | 'listening' | 'processing' | 'error';

const messagesDiv = document.getElementById('messages')!;
const userInput = document.getElementById('user-input') as HTMLTextAreaElement;
const sendBtn = document.getElementById('send-btn')!;
const micBtn = document.getElementById('mic-btn')!;
const fileBtn = document.getElementById('file-btn')!;
const fileInput = document.getElementById('file-input') as HTMLInputElement;
const attachmentPreview = document.getElementById('attachment-preview')!;
const attachmentName = document.getElementById('attachment-name')!;
const attachmentClear = document.getElementById('attachment-clear')!;
const agentToggleBtn = document.getElementById('agent-toggle-btn')!;

// エージェントモード管理
let isAgentMode = false;

function setAgentMode(enabled: boolean) {
  isAgentMode = enabled;
  if (agentToggleBtn) {
    agentToggleBtn.classList.toggle('active', enabled);
    agentToggleBtn.setAttribute('aria-label', enabled ? t('app.agent.ariaOn') : t('app.agent.ariaOff'));
    agentToggleBtn.title = enabled ? t('app.agent.titleOn') : t('app.agent.titleOff');
  }
  userInput.placeholder = enabled ? t('app.input.agentPlaceholder') : t('app.input.placeholder');
  if (!enabled) {
    platform.openclawResetSession?.();
  }
}

// Claude Codeモード管理（このCLIのカイトと直接会話）
let isClaudeCodeMode = false;

// マイク状態管理
let currentMicState: MicState = 'idle';

function setMicState(state: MicState) {
  currentMicState = state;
  micBtn.classList.remove('listening', 'processing', 'error');
  if (state !== 'idle') {
    micBtn.classList.add(state);
  }
  // aria-label更新
  const labels: Record<MicState, string> = {
    idle: t('app.mic.idle'),
    listening: t('app.mic.listening'),
    processing: t('app.mic.processing'),
    error: t('app.mic.error')
  };
  micBtn.setAttribute('aria-label', labels[state]);

  // モーショントリガー
  if (state === 'listening') {
    platform.sendMotionTrigger?.('listen');
  } else if (state === 'idle' || state === 'error') {
    // TTS再生中でなければidleに戻す
    if (!ttsService.isSpeaking()) {
      platform.sendMotionTrigger?.('idle');
    }
  }

  // エラー状態は2秒後に自動でidleに戻す
  if (state === 'error') {
    setTimeout(() => {
      if (currentMicState === 'error') {
        setMicState('idle');
      }
    }, 2000);
  }
}

// Settings Button - opens full settings window
const settingsBtn = document.getElementById('settings-btn')!;

settingsBtn.addEventListener('click', () => {
  platform.openSettingsWindow();
});

// エージェントモードトグル
if (agentToggleBtn) {
  agentToggleBtn.addEventListener('click', () => {
    setAgentMode(!isAgentMode);
  });
}

// テーマ管理
let mediaQueryListener: ((e: MediaQueryListEvent) => void) | null = null;

function applyTheme(theme: 'light' | 'dark' | 'system') {
  // 古いリスナーを削除
  if (mediaQueryListener) {
    window.matchMedia('(prefers-color-scheme: dark)').removeEventListener('change', mediaQueryListener);
    mediaQueryListener = null;
  }

  if (theme === 'system') {
    const mq = window.matchMedia('(prefers-color-scheme: dark)');
    document.documentElement.setAttribute('data-theme', mq.matches ? 'dark' : 'light');
    mediaQueryListener = (e) => {
      document.documentElement.setAttribute('data-theme', e.matches ? 'dark' : 'light');
    };
    mq.addEventListener('change', mediaQueryListener);
  } else {
    document.documentElement.setAttribute('data-theme', theme);
  }
}

let currentMemory: Memory | null = null;
let currentProfile: Profile | null = null;
let currentUser: User | null = null;
let currentSettings: Settings | null = null;
let currentState: State | null = null;
// メッセージ型（Claude/OpenAI マルチモーダル対応）
type MessageContent = string | Array<{ type: 'text' | 'image', text?: string, source?: { type: 'base64', media_type: string, data: string } }>;

// MessageContentを文字列に変換（履歴保存・記憶システム用）
function messageContentToString(content: MessageContent): string {
  if (typeof content === 'string') {
    return content;
  }
  // 配列の場合、テキスト部分を抽出し、画像は[Image]に置換
  return content.map(item => {
    if (item.type === 'text') {
      return item.text || '';
    } else if (item.type === 'image') {
      return '[Image]';
    }
    return '';
  }).join(' ').trim();
}

let currentMessages: Array<{ role: 'user' | 'assistant'; content: MessageContent }> = [];
let attachedFileContent: string | null = null;
let attachedFileName: string | null = null;
let attachedImageBase64: string | null = null;
let attachedImageType: string | null = null;
let isStreaming = false;
// 配信コメントキュー
let commentQueue: Array<{ author: string; text: string; platform: string; id: string }> = [];
let isProcessingComment = false;
// 現在応答中のbroadcastコメントIDs（完了時にack送信用）
let _inflightCommentIds: string[] = [];
// TTS_AUDIO_READY_EVENT リスナーの参照（重複登録防止用）
let _ttsAudioReadyHandler: EventListener | null = null;
let streamingMessageDiv: HTMLElement | null = null;
let currentAssistantText = '';
let setupMode = false;
let setupStep = 0;
// スクロール制御: ユーザーが上にスクロール中は自動スクロールしない
function shouldAutoScroll(): boolean {
  return messagesDiv.scrollTop + messagesDiv.clientHeight >= messagesDiv.scrollHeight - 100;
}
// セグメント分割表示のキャンセル用
let _segmentCancelFn: (() => void) | null = null;
let _segmentTypingEl: HTMLElement | null = null;
// インクリメンタルTTS用文バッファ

// LLMイベントリスナー（初期化時に1回だけ登録）
platform.onLLMDelta((delta) => {
  if (isStreaming && streamingMessageDiv) {
    currentAssistantText += delta;
    // CONFIG_UPDATEタグを除去してから表示
    const cleanDelta = delta.replace(/<!--CONFIG_UPDATE:.*?-->/g, '');
    if (cleanDelta) {
      streamingMessageDiv.textContent += cleanDelta;
      if (shouldAutoScroll()) messagesDiv.scrollTop = messagesDiv.scrollHeight;
    }
  }
});

// 感情状態キャッシュ（テンポ制御 + 声トーン補正用）
let cachedEmotionState: { arousal: number; energy: number; valence: number; surprise: number } | null = null;

/** セグメント間の遅延を内容に応じて計算（2.5〜8秒）、感情補正あり */
function segmentDelay(text: string, emotions?: { arousal: number; energy: number }): number {
  const t = text.trim();
  let base: number;

  // リアクション系（短い相槌・感嘆）→ 速め
  if (t.length <= 10 && !/[？?]/.test(t)) {
    base = 1200;
  }
  // ユーザーが意見を言いそうな間（質問・問いかけ語尾）→ 長め
  else if (/[？?]\s*$/.test(t) ||
      /(?:よね|かな|けど|だよね|じゃない|でしょ|と思う|どうかな)[〜～！!？?]*\s*$/.test(t)) {
    base = 3000 + Math.random() * 1000;
  }
  // 通常の発言
  else {
    base = 2000;
  }

  // 感情補正
  const emo = emotions || cachedEmotionState;
  if (emo) {
    const arousalMod = 1.0 - (emo.arousal - 0.5) * 0.4;  // 興奮時は0.8倍、落ち着き時は1.2倍
    const energyMod = emo.energy < 0.3 ? 1.3 : 1.0;       // 疲れてる時は1.3倍
    base = Math.round(base * arousalMod * energyMod);
  }

  return Math.max(1000, Math.min(base, 8000));
}

platform.onLLMDone(async () => {
  if (!isStreaming) return;

  isStreaming = false;

  // broadcastコメント応答完了 → inflightコメントをキューから削除するようmainに通知
  if (_inflightCommentIds.length > 0) {
    platform.setBrainState({ commentsDone: _inflightCommentIds });
    _inflightCommentIds = [];
  }

  // 感情状態をキャッシュ更新（テンポ制御 + 声トーン補正用）
  try {
    cachedEmotionState = await platform.getEmotionState();
    // TTSの声トーンを感情で補正
    if (cachedEmotionState) {
      ttsService.setEmotionTone(cachedEmotionState);
    }
  } catch { /* 取得失敗時は既存キャッシュを使用 */ }

  // CONFIG_UPDATEタグを除去してから保存
  const cleanText = currentAssistantText.replace(/<!--CONFIG_UPDATE:.*?-->/g, '').trim();

  // 返答を複数バブルに分割表示（間を置いて自然に）
  const segmentSplitEnabled = currentSettings?.chat?.segmentSplit === true;
  const segments = segmentSplitEnabled ? splitIntoSegments(cleanText) : [cleanText];
  const ttsEnabled = currentSettings?.tts?.enabled !== false && currentSettings?.tts?.engine !== 'none';
  // セグメントごとにTTS再生（全エンジン共通）
  const perSegmentTTS = ttsEnabled && segments.length > 1;

  if (segments.length > 1 && streamingMessageDiv) {
    // 最初のバブルを1セグメント目に縮める
    streamingMessageDiv.textContent = segments[0];
    streamingMessageDiv = null;

    // 最初のセグメントを読み上げ（再生完了まで待機）
    if (perSegmentTTS) await ttsService.speak(segments[0]);

    // 残りのセグメントを「入力中...」→メッセージ表示で遅延付き表示
    // ユーザーが途中で発言したらキャンセルされる
    for (let i = 1; i < segments.length; i++) {
      // セグメント間doNotDisturbを維持（前セグメントのonEndでfalseになるため）
      if (perSegmentTTS) platform.setBrainState({ doNotDisturb: true });

      // 入力中インジケーターを表示
      const typingWrapper = document.createElement('div');
      typingWrapper.className = 'message-wrapper assistant';
      const typingBubble = document.createElement('div');
      typingBubble.className = 'message assistant';
      typingBubble.innerHTML = '<span class="typing-indicator"><span class="dot"></span><span class="dot"></span><span class="dot"></span></span>';
      typingWrapper.appendChild(typingBubble);
      messagesDiv.appendChild(typingWrapper);
      if (shouldAutoScroll()) messagesDiv.scrollTop = messagesDiv.scrollHeight;
      _segmentTypingEl = typingWrapper;

      // キャンセル可能な待機（内容に応じて3〜7秒）
      const cancelled = await new Promise<boolean>(resolve => {
        _segmentCancelFn = () => resolve(true);
        setTimeout(() => resolve(false), segmentDelay(segments[i - 1]));
      });
      _segmentCancelFn = null;

      // キャンセルされたら入力中表示を消して残りスキップ
      if (cancelled) {
        if (typingWrapper.parentNode) messagesDiv.removeChild(typingWrapper);
        _segmentTypingEl = null;
        break;
      }

      // インジケーターを消して実際のメッセージを追加
      messagesDiv.removeChild(typingWrapper);
      _segmentTypingEl = null;
      addMessage('assistant', segments[i], false);

      // このセグメントを読み上げ（再生完了まで待機）
      if (perSegmentTTS) await ttsService.speak(segments[i]);
    }
  } else {
    streamingMessageDiv = null;
  }

  // 完成したメッセージを履歴に保存（分割せず全文で保存）
  const record: HistoryRecord = {
    ts: new Date().toISOString(),
    role: 'assistant',
    text: cleanText
  };
  await platform.appendHistory(record);

  currentMessages.push({ role: 'assistant', content: cleanText });

  // エージェントモード時はメモリ・記憶更新をスキップ（人格汚染防止）
  // ただし感情抽出のみ実行（UI演出・テンポ制御・割り込み制御用）
  if (isAgentMode) {
    // 感情のみ抽出（facts/topics/promises等は触らない）
    try {
      const lastUserMsgContent = currentMessages.filter(m => m.role === 'user').pop()?.content || '';
      const lastUserMsg = typeof lastUserMsgContent === 'string' ? lastUserMsgContent : messageContentToString(lastUserMsgContent);
      await platform.applyConversation({
        userMessage: lastUserMsg,
        assistantMessage: cleanText,
        emotionOnly: true
      });
    } catch (memErr) {
      console.warn('⚠️ [Agent] 感情抽出スキップ:', memErr);
    }
  } else {
    // Memory更新（最新の会話を記録）
    if (currentMemory) {
      currentMemory.nextStep = cleanText.slice(0, 100);
      currentMemory.date = new Date().toISOString().split('T')[0];
      await platform.saveMemory(currentMemory);
    }

    // State更新（最終アクティブ時刻）
    if (currentState) {
      currentState.lastActiveAt = new Date().toISOString();
      await platform.saveState(currentState);
    }

    // 要約チェック
    await checkAndSummarize();

    // 記憶システム: 会話後に1回だけ呼ぶ（失敗しても会話は壊さない）
    try {
      const lastUserMsgContent = currentMessages.filter(m => m.role === 'user').pop()?.content || '';
      const lastUserMsg = typeof lastUserMsgContent === 'string' ? lastUserMsgContent : messageContentToString(lastUserMsgContent);
      await platform.applyConversation({
        userMessage: lastUserMsg,
        assistantMessage: cleanText
      });
    } catch (memErr) {
      console.warn('⚠️ 記憶更新スキップ:', memErr);
    }
  }

  console.log('✅ 会話完了');

  // TTS読み上げ（設定が有効な場合）
  if (ttsEnabled && !perSegmentTTS) {
    // 通常TTS（セグメント分割なし — 全文一括読み上げ）
    speakWithLipSync(cleanText);
  } else if (!ttsEnabled) {
    // TTS無効: ここで doNotDisturb をリセット
    platform.setBrainState({ doNotDisturb: false });
    platform.sendMotionTrigger?.('idle');
  }
  // perSegmentTTS: 各セグメント表示時に読み上げ済み、最後のセグメントのonEndでdoNotDisturbリセット

  currentAssistantText = '';

  // コメントキュー処理: LLM完了後に次のコメントを処理
  isProcessingComment = false;
  setTimeout(() => processCommentQueue(), 1000);
});

platform.onLLMError((error) => {
  if (!isStreaming) return;

  isStreaming = false;
  platform.setBrainState({ doNotDisturb: false });
  if (streamingMessageDiv) {
    const isAuthError = error.includes('401') || error.includes('403') || error.includes('APIキー');
    const friendlyError = isAuthError ? t('app.error.apiKeyInvalid')
      : error.includes('429') ? t('app.error.rateLimit')
      : error.includes('500') || error.includes('502') || error.includes('503') ? t('app.error.serverError')
      : t('app.error.generic');
    streamingMessageDiv.innerHTML = '';
    streamingMessageDiv.classList.add('error');
    const errorText = document.createElement('span');
    errorText.textContent = `❌ ${friendlyError}`;
    streamingMessageDiv.appendChild(errorText);
    if (isAuthError) {
      const settingsBtn = document.createElement('button');
      settingsBtn.textContent = t('app.error.openSettings');
      settingsBtn.className = 'error-settings-btn';
      settingsBtn.addEventListener('click', () => platform.openSettingsWindow());
      streamingMessageDiv.appendChild(settingsBtn);
    }
  }
  streamingMessageDiv = null;
  currentAssistantText = '';
  isProcessingComment = false;
});

// プロアクティブトリガー
platform.onProactiveTrigger(async (payload) => {
  console.log('🔔 プロアクティブトリガー:', payload);

  // エージェントモード中はプロアクティブ発言を無効化
  if (isAgentMode) {
    console.log('⏭️ プロアクティブスキップ（エージェントモード中）');
    return;
  }

  // ストリーミング中またはTTS再生中なら会話のかぶりを防止
  if (isStreaming || ttsService.isSpeaking()) {
    console.log('⏭️ プロアクティブスキップ（会話中/TTS再生中）');
    return;
  }

  // プロアクティブメッセージ生成
  isStreaming = true;
  platform.sendMotionTrigger?.('thinking');
  currentAssistantText = '';
  streamingMessageDiv = addMessage('assistant', '', false);

  // Interrupt Gate: ストリーミング開始を通知
  platform.setBrainState({ doNotDisturb: true });

  // broadcastコメント応答の場合、完了時にack送信するためIDを保持
  if (payload.context?.comments) {
    _inflightCommentIds = payload.context.comments.map((c: any) => c.id);
  }

  platform.streamLLM({
    messages: currentMessages,
    isProactive: true,
    context: payload.context
  });
});

// 設定変更フィードバック
platform.onConfigUpdated((payload) => {
  console.log('🔧 設定変更通知:', payload);
  const noticeDiv = document.createElement('div');
  noticeDiv.className = 'message system-notice';
  noticeDiv.textContent = payload.summary;
  messagesDiv.appendChild(noticeDiv);
  if (shouldAutoScroll()) messagesDiv.scrollTop = messagesDiv.scrollHeight;
});

// selfGrowth: 性格変更の確認ダイアログ
platform.onSelfGrowthPending((payload: { changes: Record<string, unknown> }) => {
  console.log('🔔 selfGrowth確認:', payload);

  const overlay = document.createElement('div');
  overlay.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.6);z-index:9999;display:flex;align-items:center;justify-content:center;';

  const dialog = document.createElement('div');
  dialog.style.cssText = 'background:#1e1e2e;border:1px solid #444;border-radius:12px;padding:20px;max-width:400px;width:90%;color:#eee;font-size:14px;';

  const title = document.createElement('h3');
  title.textContent = t('app.selfGrowth.title');
  title.style.cssText = 'margin:0 0 12px 0;font-size:16px;';

  const desc = document.createElement('div');
  desc.style.cssText = 'margin-bottom:16px;line-height:1.6;';
  const changes = payload.changes;
  const parts: string[] = [];
  if (changes.traits) parts.push(t('app.selfGrowth.traits', { values: (changes.traits as string[]).join(', ') }));
  if (changes.speechStyle) parts.push(t('app.selfGrowth.speech', { values: (changes.speechStyle as string[]).join(', ') }));
  if (changes.reactions) parts.push(t('app.selfGrowth.reactions'));
  desc.innerHTML = parts.length > 0 ? parts.join('<br>') : JSON.stringify(changes);

  const btnRow = document.createElement('div');
  btnRow.style.cssText = 'display:flex;gap:8px;justify-content:flex-end;';

  const approveBtn = document.createElement('button');
  approveBtn.textContent = t('app.selfGrowth.approve');
  approveBtn.style.cssText = 'padding:8px 16px;border:none;border-radius:6px;background:#7c3aed;color:#fff;cursor:pointer;font-size:13px;';
  approveBtn.onclick = async () => {
    await platform.selfGrowthApprove({ changes });
    overlay.remove();
  };

  const rejectBtn = document.createElement('button');
  rejectBtn.textContent = t('app.selfGrowth.reject');
  rejectBtn.style.cssText = 'padding:8px 16px;border:1px solid #555;border-radius:6px;background:transparent;color:#ccc;cursor:pointer;font-size:13px;';
  rejectBtn.onclick = () => overlay.remove();

  btnRow.append(rejectBtn, approveBtn);
  dialog.append(title, desc, btnRow);
  overlay.appendChild(dialog);
  document.body.appendChild(overlay);
});

// 設定ウィンドウからの全Settings変更通知（STT/TTS/テーマ等をリアルタイム反映）
platform.onSettingsChangedFull((newSettings: Settings) => {
  console.log('🔧 設定変更検出、再適用中...');
  const oldStt = currentSettings?.stt;
  currentSettings = newSettings;

  // テーマ再適用
  applyTheme((newSettings.theme as 'light' | 'dark' | 'system') ?? 'system');

  // OpenClawトグルボタンの表示制御
  if (agentToggleBtn) {
    agentToggleBtn.style.display = newSettings.openclaw?.enabled ? 'flex' : 'none';
    // OpenClawが無効化されたらエージェントモードを解除
    if (!newSettings.openclaw?.enabled && isAgentMode) {
      setAgentMode(false);
    }
  }

  // Claude Codeモード: 設定変更をリアルタイム反映
  const newClaudeCodeMode = (newSettings as any).claudeCode?.enabled ?? false;
  if (newClaudeCodeMode !== isClaudeCodeMode) {
    isClaudeCodeMode = newClaudeCodeMode;
    userInput.placeholder = isClaudeCodeMode ? t('app.input.claudeCodePlaceholder') : t('app.input.placeholder');
    if (!isClaudeCodeMode) platform.claudeCodeResetSession();
  }

  // TTS再適用
  initTTSAndLipSync();

  // STT再適用
  const sttChanged = JSON.stringify(oldStt) !== JSON.stringify(newSettings.stt);
  if (sttChanged) {
    sttService.abort();
    sttService.setConfig({
      enabled: newSettings.stt?.enabled ?? true,
      engine: newSettings.stt?.engine ?? 'whisper',
      autoSend: newSettings.stt?.autoSend ?? false,
      alwaysOn: newSettings.stt?.alwaysOn ?? false,
      lang: newSettings.stt?.lang ?? 'ja-JP',
      whisperModel: (newSettings.stt as any)?.whisperModel,
    });
    // alwaysOnが有効なら自動開始、無効なら停止のまま
    if (newSettings.stt?.alwaysOn && newSettings.stt?.enabled) {
      setTimeout(() => sttService.start(), 500);
    }
  }
  console.log('✅ 設定再適用完了');
});

// External API: ClaudeCode等からの音声読み上げリクエスト
platform.onExternalSpeak((text: string) => {
  console.log('[external:speak] engine:', ttsService.currentEngine, 'text:', text.slice(0, 30));
  ttsService.speak(text).catch((err: unknown) => console.warn('[external:speak] TTS error:', err));
});

// VRChat音声リスナー: 他プレイヤーの発言をバッチで受信→まとめてLLMに送る
let _vrchatTranscriptBuffer: string[] = [];
let _vrchatBatchTimer: ReturnType<typeof setTimeout> | null = null;
const VRCHAT_BATCH_DELAY = 4000; // 4秒間溜めてからまとめて送る

function flushVrchatTranscripts() {
  _vrchatBatchTimer = null;
  if (_vrchatTranscriptBuffer.length === 0) return;

  const lines = _vrchatTranscriptBuffer.map(t => `- ${t}`).join('\n');
  _vrchatTranscriptBuffer = [];

  // UIに表示（ユーザー発話とは別枠）
  addMessage('user', `[VRChat会話]\n${lines}`, true);

  // currentMessagesには積まない（記憶汚染防止 — 配信コメントと同じ方式）
  // context経由でsystem promptに注入する
  if (!isStreaming) {
    isStreaming = true;
    platform.sendMotionTrigger?.('thinking');
    platform.setBrainState({ doNotDisturb: true });
    currentAssistantText = '';
    streamingMessageDiv = addMessage('assistant', '', false);
    platform.streamLLM({
      messages: currentMessages,
      isProactive: false,
      context: { vrchatConversation: lines },
      useOpenClaw: false,
      useClaudeCode: false
    });
  }
}

platform.onVrchatListenerTranscript?.((text: string) => {
  console.log('[VRChat音声]', text);
  _vrchatTranscriptBuffer.push(text);

  // タイマーリセット — 新しい発言が来るたびに延長
  if (_vrchatBatchTimer) clearTimeout(_vrchatBatchTimer);
  _vrchatBatchTimer = setTimeout(flushVrchatTranscripts, VRCHAT_BATCH_DELAY);
});

// スロット切替時のリロード
platform.onSlotChanged(async (slot) => {
  console.log('🔄 スロット切替検出:', slot.name);
  // データを再読み込み
  currentProfile = await platform.getProfile();
  currentSettings = await platform.getSettings();
  currentState = await platform.getState();
  // チャット履歴をクリアして再読み込み
  messagesDiv.innerHTML = '';
  currentMessages = [];
  const history = await platform.getHistory(20);
  for (const h of history) {
    addMessage(h.role, h.text, false);
    currentMessages.push({ role: h.role, content: h.text });
  }
  // 感情キャッシュをリセット
  cachedEmotionState = null;
});

// 初回セットアップトリガー
// 設定画面からのTTSテスト（口パク・モーション連動）
(platform as any).onTtsTestSpeak?.((text: string) => {
  ttsService.speak(text);
});

platform.onStartSetup(() => {
  console.log('🎉 初回セットアップ開始');
  setupMode = true;
  setupStep = 0;
  startSetup();
});

// 初回セットアップフロー
async function startSetup() {
  // Step 0: 自己紹介（自動表示、1.5秒後にStep 1へ）
  addMessage('assistant', t('app.setup.greeting'), false);
  setTimeout(() => {
    setupStep = 1;
    addMessage('assistant', t('app.setup.askName'), false);
  }, 1500);
}

async function handleSetupInput(userText: string) {
  if (setupStep === 1) {
    // 相棒の名前を保存
    if (currentProfile) {
      currentProfile.companionName = userText;
      await platform.saveProfile(currentProfile);
      setupStep = 2;
      addMessage('assistant', t('app.setup.confirmName', { name: userText }), false);
    }
  } else if (setupStep === 2) {
    // ユーザー名を保存
    if (currentUser) {
      currentUser.name = userText;
      await platform.saveUser(currentUser);
      setupStep = 3;
      addMessage('assistant', t('app.setup.askStyle', { name: userText }), false);
    }
  } else if (setupStep === 3) {
    // 話し方を決定
    const personality = await platform.getPersonality();

    if (userText.includes('1') || userText.includes('元気')) {
      personality.traits = ['明るくてテンション高め', '興味を持ったら質問する', 'たまにボケる'];
      personality.speechStyle = ['「〜だよ！」「〜じゃん！」', '絵文字も使う', '短め（1〜2文）'];
    } else if (userText.includes('2') || userText.includes('落ち着')) {
      personality.traits = ['穏やかで優しい', 'ユーザーのことを気にかける', '落ち着いた雰囲気'];
      personality.speechStyle = ['「〜ですね」「〜だよ」', '絵文字は控えめ', '丁寧で優しい'];
    } else if (userText.includes('3') || userText.includes('クール')) {
      personality.traits = ['さっぱりしてる', '的確に答える', '無駄なことは言わない'];
      personality.speechStyle = ['「〜だな」「〜か」', '絵文字はほぼ使わない', '短く簡潔'];
    } else {
      // 自由入力の場合はそのまま traits に追加
      personality.traits = [userText];
    }

    await platform.savePersonality(personality);

    // Step 4へ進む（趣味を聞く）
    setupStep = 4;
    addMessage('assistant', t('app.setup.askInterests'), false);
  } else if (setupStep === 4) {
    // 趣味を保存（per-slot の profile.interests + 後方互換で user.interests にも）
    const interests = userText.split(/[,、\s]+/).map(s => s.trim()).filter(Boolean);
    try {
      const profile = await platform.getProfile();
      profile.interests = interests;
      await platform.saveProfile(profile);
    } catch (e) {
      console.warn('⚠️ profile.interests保存スキップ:', e);
    }
    if (currentUser) {
      currentUser.interests = interests;
      await platform.saveUser(currentUser);
    }

    // firstMetを設定
    try {
      const memoryV2 = await platform.getMemoryV2();
      if (!memoryV2.relationship) {
        memoryV2.relationship = { interactionCount: 0, lastInteraction: null, firstMet: new Date().toISOString(), episodes: [] };
      } else if (!memoryV2.relationship.firstMet) {
        memoryV2.relationship.firstMet = new Date().toISOString();
      }
      await platform.saveMemoryV2(memoryV2);
    } catch (e) {
      console.warn('⚠️ firstMet設定スキップ:', e);
    }

    // セットアップ完了
    if (currentState) {
      currentState.setupComplete = true;
      await platform.saveState(currentState);
    }

    setupMode = false;
    setupStep = 0;

    const interestsText = currentUser?.interests?.length ? currentUser.interests.join('と') : '';
    const greeting = interestsText
      ? t('app.setup.doneWithInterests', { interests: interestsText, name: currentUser?.name || '' })
      : t('app.setup.done', { name: currentUser?.name || '' });
    addMessage('assistant', greeting, false);
  }
}

// 初期化
(async () => {
  try {
    await initI18n();
    applyDOMTranslations();

    currentMemory = await platform.getMemory();
    currentProfile = await platform.getProfile();
    currentUser = await platform.getUser();
    currentSettings = await platform.getSettings();
    currentState = await platform.getState();

    // テーマ適用
    applyTheme((currentSettings.theme as 'light' | 'dark' | 'system') ?? 'system');

    // OpenClawトグルボタンの表示制御
    if (agentToggleBtn) {
      agentToggleBtn.style.display = currentSettings.openclaw?.enabled ? 'flex' : 'none';
    }

    // Claude Codeモード: 設定から自動適用
    isClaudeCodeMode = (currentSettings as any).claudeCode?.enabled ?? false;
    if (isClaudeCodeMode) {
      userInput.placeholder = t('app.input.claudeCodePlaceholder');
    }

    // セットアップ完了済みなら履歴読み込み
    if (currentState.setupComplete) {
      const history = await platform.getHistory(currentSettings.limits.historyTurns);
      history.forEach(record => {
        addMessage(record.role, record.text, false, record.ts);
        currentMessages.push({ role: record.role, content: record.text });
      });
    }

    console.log('✅ 初期化完了:', {
      profile: currentProfile,
      user: currentUser,
      settings: currentSettings,
      setupComplete: currentState.setupComplete
    });

    // TTS/LipSync初期化
    initTTSAndLipSync();

    // 配信コメント受信
    if (platform.onCommentReceived) {
      platform.onCommentReceived((comment) => {
        const maxQueue = currentSettings?.streaming?.commentFilter?.maxQueueSize || 20;
        if (commentQueue.length >= maxQueue) {
          commentQueue.shift(); // 古いコメントを破棄
        }
        commentQueue.push(comment);
        console.log(`💬 コメントキュー追加 (${commentQueue.length}件): ${comment.author}: ${comment.text}`);
        processCommentQueue();
      });
      console.log('✅ 配信コメント受信を登録');
    }

    // APIキーチェック（セキュリティ: キー自体は非表示、有無のみ確認）
    const config = await platform.getConfig();
    if (!config.hasApiKey) {
      addMessage('assistant', `⚠️ ${t('app.error.apiKeyMissing')}`);
    }
  } catch (err) {
    console.error('❌ 初期化失敗:', err);
  }
})();

// 表示名を取得
function getDisplayName(role: 'user' | 'assistant'): string {
  if (role === 'assistant') {
    if (isAgentMode) return 'Agent';
    return currentProfile?.companionName || t('app.setup.defaultName');
  }
  return currentUser?.name || 'あなた';
}

// 最後に表示した日付（日付区切り用）
let _lastDisplayedDate = '';

function formatTime(date: Date): string {
  return `${date.getHours().toString().padStart(2, '0')}:${date.getMinutes().toString().padStart(2, '0')}`;
}

function formatDateLabel(date: Date): string {
  const today = new Date();
  const yesterday = new Date(today);
  yesterday.setDate(yesterday.getDate() - 1);
  const d = date.toISOString().split('T')[0];
  if (d === today.toISOString().split('T')[0]) return t('app.date.today');
  if (d === yesterday.toISOString().split('T')[0]) return t('app.date.yesterday');
  return `${date.getMonth() + 1}/${date.getDate()}`;
}

// メッセージ追加
// LLMの返答を自然な区切りで複数メッセージに分割
function splitIntoSegments(text: string): string[] {
  const MIN_LEN = 12;
  const parts: string[] = [];
  let current = '';

  for (let i = 0; i < text.length; i++) {
    current += text[i];
    const isEnd = /[。！？\n]/.test(text[i]);
    const hasMore = i < text.length - 1;

    if (isEnd && current.trim().length >= MIN_LEN && hasMore) {
      parts.push(current.trim());
      current = '';
    }
  }
  if (current.trim()) {
    parts.push(current.trim());
  }

  return parts.length > 0 ? parts : [text];
}

function addMessage(role: 'user' | 'assistant', text: string, saveToHistory = true, timestamp?: string) {
  const now = timestamp ? new Date(timestamp) : new Date();
  const dateStr = now.toISOString().split('T')[0];

  // 日付区切り
  if (dateStr !== _lastDisplayedDate) {
    _lastDisplayedDate = dateStr;
    const separator = document.createElement('div');
    separator.className = 'date-separator';
    separator.textContent = formatDateLabel(now);
    messagesDiv.appendChild(separator);
  }

  // ラッパー（名前ラベル + 吹き出し + タイムスタンプ）
  const wrapper = document.createElement('div');
  wrapper.className = `message-wrapper ${role}`;

  const nameLabel = document.createElement('div');
  nameLabel.className = 'message-name';
  nameLabel.textContent = getDisplayName(role);
  wrapper.appendChild(nameLabel);

  const msgDiv = document.createElement('div');
  msgDiv.className = `message ${role}`;
  msgDiv.textContent = text;
  wrapper.appendChild(msgDiv);

  const timeLabel = document.createElement('div');
  timeLabel.className = 'message-time';
  timeLabel.textContent = formatTime(now);
  wrapper.appendChild(timeLabel);

  messagesDiv.appendChild(wrapper);
  messagesDiv.scrollTop = messagesDiv.scrollHeight;

  if (saveToHistory) {
    const record: HistoryRecord = {
      ts: new Date().toISOString(),
      role,
      text
    };
    platform.appendHistory(record).catch(err => {
      console.error('❌ 履歴保存失敗:', err);
    });
  }

  return msgDiv;
}

// 視聴者コメント表示
function addViewerComment(author: string, text: string, platform: string) {
  const now = new Date();
  const dateStr = now.toISOString().split('T')[0];

  if (dateStr !== _lastDisplayedDate) {
    _lastDisplayedDate = dateStr;
    const separator = document.createElement('div');
    separator.className = 'date-separator';
    separator.textContent = formatDateLabel(now);
    messagesDiv.appendChild(separator);
  }

  const wrapper = document.createElement('div');
  wrapper.className = 'message-wrapper viewer';

  const nameLabel = document.createElement('div');
  nameLabel.className = 'message-name viewer';
  const platformIcon = platform === 'youtube' ? '▶' : '💬';
  nameLabel.textContent = `${platformIcon} ${author}`;
  wrapper.appendChild(nameLabel);

  const msgDiv = document.createElement('div');
  msgDiv.className = 'message viewer';
  msgDiv.textContent = text;
  wrapper.appendChild(msgDiv);

  const timeLabel = document.createElement('div');
  timeLabel.className = 'message-time';
  timeLabel.textContent = formatTime(now);
  wrapper.appendChild(timeLabel);

  messagesDiv.appendChild(wrapper);
  messagesDiv.scrollTop = messagesDiv.scrollHeight;
}

// コメントキュー処理
function processCommentQueue() {
  // 配信モード（broadcastMode）時はbrain-tick経由でのみ応答する
  // ここでの即時応答は非配信モード時のみ
  const isBroadcastMode = currentSettings?.streaming?.broadcastMode && currentSettings?.streaming?.enabled;
  if (isBroadcastMode) return;

  if (isProcessingComment || isStreaming || commentQueue.length === 0) return;
  if (ttsService.isSpeaking()) return;

  isProcessingComment = true;
  const comment = commentQueue.shift()!;

  // チャットに視聴者コメント表示
  addViewerComment(comment.author, comment.text, comment.platform);

  // LLMに送信（配信コメントとして — 配信プロンプトを通すためisProactive + context.commentsを使用）
  // 注意: viewerコメントはcurrentMessagesに積まない（記憶汚染防止）
  isStreaming = true;
  platform.sendMotionTrigger?.('thinking');
  platform.setBrainState({ doNotDisturb: true });
  currentAssistantText = '';
  streamingMessageDiv = addMessage('assistant', '', false);

  platform.streamLLM({
    messages: currentMessages,
    isProactive: true,
    context: {
      comments: [{ id: comment.id || `comment-${Date.now()}`, author: comment.author, text: comment.text }]
    },
    useOpenClaw: isAgentMode,
    useClaudeCode: isClaudeCodeMode
  });
}

// スラッシュコマンド処理
const AVAILABLE_MODELS = ['gpt-4o', 'gpt-4o-mini', 'gpt-4-turbo', 'gpt-3.5-turbo'];

async function handleSlashCommand(input: string) {
  const parts = input.slice(1).split(' ');
  const command = parts[0].toLowerCase();
  const args = parts.slice(1);

  switch (command) {
    case 'help':
      addMessage('assistant', `📋 ${t('app.command.help', { models: AVAILABLE_MODELS.join(', ') })}`, false);
      break;

    case 'model':
      if (args.length === 0) {
        const current = currentSettings?.llm?.model || 'gpt-4o-mini';
        addMessage('assistant', `🤖 現在のモデル: **${current}**\n利用可能: ${AVAILABLE_MODELS.join(', ')}\n変更: \`/model gpt-4o\``, false);
      } else {
        const newModel = args[0];
        if (AVAILABLE_MODELS.includes(newModel)) {
          if (currentSettings) {
            currentSettings.llm.model = newModel;
            await platform.saveSettings(currentSettings);
            addMessage('assistant', `✅ ${t('app.command.modelChanged', { model: newModel })}`, false);
          }
        } else {
          addMessage('assistant', `❌ ${t('app.command.invalidModel', { models: AVAILABLE_MODELS.join(', ') })}`, false);
        }
      }
      break;

    case 'clear':
      currentMessages = [];
      messagesDiv.innerHTML = '';
      platform.openclawResetSession?.();
      addMessage('assistant', `🗑️ ${t('app.command.cleared')}`, false);
      break;

    case 'agent':
      if (!currentSettings?.openclaw?.enabled) {
        addMessage('assistant', `⚠️ ${t('app.command.agentNotEnabled')}`, false);
      } else {
        setAgentMode(true);
        addMessage('assistant', `🔄 ${t('app.command.agentOn')}`, false);
      }
      break;

    case 'companion':
      setAgentMode(false);
      addMessage('assistant', `🔄 ${t('app.command.companionOn')}`, false);
      break;

    default:
      addMessage('assistant', `❓ ${t('app.command.unknown', { command })}`, false);
  }
}


// 添付プレビュー表示/非表示
function showAttachmentPreview(name: string) {
  attachmentName.textContent = `📎 ${name}`;
  attachmentPreview.style.display = 'flex';
}

function clearAttachment() {
  attachedFileContent = null;
  attachedFileName = null;
  attachedImageBase64 = null;
  attachedImageType = null;
  attachmentPreview.style.display = 'none';
  userInput.placeholder = t('app.input.placeholder');
}

// 添付クリアボタン
attachmentClear.addEventListener('click', () => {
  clearAttachment();
});

// ファイル読み込み処理
async function handleFileSelect(file: File) {
  const ext = file.name.split('.').pop()?.toLowerCase();
  const supportedText = ['txt', 'md', 'csv', 'json', 'log'];
  const supportedPdf = ['pdf'];
  const supportedImage = ['jpg', 'jpeg', 'png', 'gif', 'webp'];

  // 画像ファイル処理
  if (ext && supportedImage.includes(ext)) {
    const maxSize = 5 * 1024 * 1024; // 5MB
    if (file.size > maxSize) {
      addMessage('assistant', `❌ ${t('app.error.imageTooLarge')}`, false);
      return;
    }

    try {
      const reader = new FileReader();
      const base64 = await new Promise<string>((resolve, reject) => {
        reader.onload = (e) => {
          const result = e.target?.result as string;
          // data:image/png;base64,... から base64部分のみ抽出
          const base64Data = result.split(',')[1];
          resolve(base64Data);
        };
        reader.onerror = reject;
        reader.readAsDataURL(file);
      });

      attachedImageBase64 = base64;
      attachedImageType = file.type;
      showAttachmentPreview(file.name);
      userInput.placeholder = t('app.input.filePlaceholder', { name: file.name });
    } catch (err) {
      console.error('Image read error:', err);
      addMessage('assistant', `❌ ${t('app.error.imageLoadFailed')}`, false);
    }
    return;
  }

  const maxSize = file.name.endsWith('.pdf') ? 5 * 1024 * 1024 : 100 * 1024; // PDF: 5MB, Text: 100KB

  if (file.size > maxSize) {
    addMessage('assistant', `❌ ${t('app.error.fileTooLarge', { maxSize: file.name.endsWith('.pdf') ? '5MB' : '100KB' })}`, false);
    return;
  }

  if (!ext || (!supportedText.includes(ext) && !supportedPdf.includes(ext))) {
    addMessage('assistant', `❌ ${t('app.error.unsupportedFile')}`, false);
    return;
  }

  try {
    let content = '';

    if (supportedPdf.includes(ext)) {
      // PDF: main processで処理（sandboxのため）
      // ファイルパスが必要だが、sandboxではアクセスできないのでFileReader経由
      addMessage('assistant', `⚠️ ${t('app.error.pdfDesktopOnly')}`, false);
      return;
    } else {
      // テキストファイル: rendererで直接読み込み
      const reader = new FileReader();
      content = await new Promise<string>((resolve, reject) => {
        reader.onload = (e) => resolve(e.target?.result as string);
        reader.onerror = reject;
        reader.readAsText(file);
      });

      // 4000文字で切り詰め
      if (content.length > 4000) {
        content = content.slice(0, 4000) + '\n...(以下省略)';
      }
    }

    attachedFileContent = content;
    attachedFileName = file.name;
    showAttachmentPreview(file.name);
    userInput.placeholder = t('app.input.filePlaceholder', { name: file.name });
  } catch (err) {
    console.error('File read error:', err);
    addMessage('assistant', `❌ ${t('app.error.fileLoadFailed')}`, false);
  }
}

// 送信処理
async function sendMessage() {
  if (isStreaming) return;

  const userText = userInput.value.trim();
  if (!userText && !attachedImageBase64) return;

  // セグメント分割表示中ならキャンセル（ユーザーの発言を優先）
  if (_segmentCancelFn) {
    _segmentCancelFn();
    _segmentCancelFn = null;
  }

  // TTS再生中なら停止（ユーザーが新しいメッセージを送る→キャラは黙る）
  if (ttsService.isSpeaking()) {
    ttsService.cancel();
    lipSyncService.stopTalking();
  }

  // ユーザーメッセージ表示（画像添付時は表示テキストを調整）
  const displayText = attachedImageBase64 ? `🖼️ ${userText || 'この画像について教えて'}` : userText;
  addMessage('user', displayText);
  userInput.value = '';
  autoResizeTextarea();

  // セットアップモードの場合は専用処理
  if (setupMode) {
    await handleSetupInput(userText);
    return;
  }

  // スラッシュコマンド処理
  if (userText.startsWith('/')) {
    await handleSlashCommand(userText);
    return;
  }

  // 通常モード
  // ファイルが添付されている場合、内容を含める
  let messageContent: MessageContent = userText;

  if (attachedImageBase64 && attachedImageType) {
    // 画像添付の場合はマルチモーダルメッセージ
    messageContent = [
      {
        type: 'text',
        text: userText || 'この画像について教えて'
      },
      {
        type: 'image',
        source: {
          type: 'base64',
          media_type: attachedImageType,
          data: attachedImageBase64
        }
      }
    ];
    clearAttachment();
  } else if (attachedFileContent && attachedFileName) {
    // テキストファイル添付
    messageContent = `ユーザーがファイル「${attachedFileName}」を共有しました:\n---\n${attachedFileContent}\n---\n\nユーザーの質問: ${userText}`;
    clearAttachment();
  }

  currentMessages.push({ role: 'user', content: messageContent });

  // State更新（最終アクティブ時刻 + lastMessageAt）
  if (currentState) {
    currentState.lastActiveAt = new Date().toISOString();
    currentState.lastMessageAt = currentState.lastActiveAt;
    await platform.saveState(currentState);
  }

  // ストリーミング開始
  isStreaming = true;
  platform.sendMotionTrigger?.('thinking');

  // Interrupt Gate: ストリーミング開始を通知
  platform.setBrainState({ doNotDisturb: true });
  currentAssistantText = '';
  streamingMessageDiv = addMessage('assistant', '', false);

  // LLMストリーミング開始（直近N件のみ送信）
  platform.streamLLM({
    messages: currentMessages,
    isProactive: false,
    useOpenClaw: isAgentMode,
    useClaudeCode: isClaudeCodeMode
  });
}

// 要約チェック（閾値超えたら実行）
async function checkAndSummarize() {
  if (!currentSettings) return;

  const count = await platform.getHistoryCount();
  if (count >= currentSettings.limits.summaryThreshold) {
    console.log('📝 要約実行中...');
    const result = await platform.summarizeHistory();
    if (result.success) {
      console.log('✅ 要約完了:', result.summary);
    } else {
      console.error('❌ 要約失敗:', result.reason);
    }
  }
}

sendBtn.addEventListener('click', sendMessage);
userInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && !e.shiftKey) {
    e.preventDefault();
    sendMessage();
  }
});

// textarea自動高さ調整
function autoResizeTextarea() {
  userInput.style.height = 'auto';
  userInput.style.height = Math.min(userInput.scrollHeight, 120) + 'px';
}
userInput.addEventListener('input', autoResizeTextarea);

// VRオーバーレイ等からの外部メッセージ受信
platform.onExternalMessage?.((data: { text: string; source: string }) => {
  if (isStreaming) return;
  userInput.value = data.text;
  sendMessage();
});

// ファイル添付
fileBtn.addEventListener('click', () => {
  fileInput.click();
});

fileInput.addEventListener('change', async (e) => {
  const file = (e.target as HTMLInputElement).files?.[0];
  if (file) {
    await handleFileSelect(file);
  }
  // reset input
  fileInput.value = '';
});

// ドラッグ&ドロップ対応
messagesDiv.addEventListener('dragover', (e) => {
  e.preventDefault();
  messagesDiv.style.opacity = '0.7';
});

messagesDiv.addEventListener('dragleave', () => {
  messagesDiv.style.opacity = '1';
});

messagesDiv.addEventListener('drop', async (e) => {
  e.preventDefault();
  messagesDiv.style.opacity = '1';

  const file = e.dataTransfer?.files?.[0];
  if (file) {
    await handleFileSelect(file);
  }
});

// アプリ終了時の保存 & 要約
window.addEventListener('beforeunload', async () => {
  if (currentMemory) {
    await platform.saveMemory(currentMemory);
  }
  await checkAndSummarize();
});

// TTS + リップシンク統合関数
function speakWithLipSync(text: string) {
  // 設定が無効なら何もしない
  if (currentSettings?.tts?.enabled === false) return;

  ttsService.speak(text);
}

// TTS/LipSync設定の初期化
function initTTSAndLipSync() {
  // TTS設定適用
  if (currentSettings?.tts) {
    ttsService.setConfig({
      engine: currentSettings.tts.engine,
      webSpeech: currentSettings.tts.webSpeech,
      voicevox: currentSettings.tts.voicevox,
      openai: currentSettings.tts.openai ?? { voice: 'nova', model: 'tts-1', speed: 1.0 }
    });
  }

  // VRChat用音声: ミキサー起動（マイク+TTS→仮想デバイス）
  import('./vr-audio-mixer').then(async (mixer) => {
    const deviceId = currentSettings?.vrchat?.audioDeviceId;
    if (deviceId && currentSettings?.vrchat?.enabled) {
      await mixer.startMixer(deviceId);
    } else {
      await mixer.stopMixer();
    }
  });

  // フォールバック: ミキサーなしの場合のTTS出力デバイス
  if (currentSettings?.vrchat?.audioDeviceId) {
    ttsService.setOutputDevice(currentSettings.vrchat.audioDeviceId);
  } else {
    ttsService.setOutputDevice('');
  }

  // リップシンク設定適用
  if (currentSettings?.lipSync) {
    lipSyncService.setConfig({
      enabled: currentSettings.lipSync.enabled,
      mode: currentSettings.lipSync.mode,
      disableMouthForm: currentSettings.character?.disableMouthForm
    });
  }

  // リップシンクの口制御コールバック: 値をIPC経由でキャラウィンドウに転送
  lipSyncService.registerMouthControl((openY: number, form?: number) => {
    platform.sendLipSync(openY, form);
  });

  // TTSコールバックでリップシンク開始/停止 + Interrupt Gate同期
  // STTは一時停止しない（エコーキャンセレーション + ハルシネーションフィルタに任せる）
  ttsService.setCallbacks({
    onStart: () => {
      console.log('🔊 TTS開始');
      lipSyncService.startTalking();
      platform.setBrainState({ doNotDisturb: true });
      platform.sendMotionTrigger?.('talk');
    },
    onEnd: () => {
      console.log('🔇 TTS終了');
      lipSyncService.stopTalking();
      platform.setBrainState({ doNotDisturb: false });
      platform.sendMotionTrigger?.('idle');
    },
    onError: (error) => {
      console.error('❌ TTSエラー:', error);
      lipSyncService.stopTalking();
      platform.setBrainState({ doNotDisturb: false });
      platform.sendMotionTrigger?.('idle');
    }
  });

  // TTS音声受信 → リップシンク接続
  // PHONEME_READYがAUDIO_READYより先に発火するため、phonemeデータを保持して
  // AUDIO_READY時にまとめて処理する
  let _pendingPhonemes: import('./types').PhonemeEvent[] = [];

  if (_ttsAudioReadyHandler) {
    window.removeEventListener(TTS_AUDIO_READY_EVENT, _ttsAudioReadyHandler);
  }
  _ttsAudioReadyHandler = ((event: CustomEvent<HTMLAudioElement>) => {
    const audio = event.detail;
    // 振幅解析接続（音声ルーティング + フォールバック）
    lipSyncService.connectAudioElement(audio);
    // phonemeデータがあればセット（animateAmplitude内で自動的に使われる）
    if (_pendingPhonemes.length > 0) {
      lipSyncService.setPhonemeData(audio, _pendingPhonemes);
      _pendingPhonemes = [];
    }
  }) as EventListener;
  window.addEventListener(TTS_AUDIO_READY_EVENT, _ttsAudioReadyHandler);

  // 音素タイムライン受信 → 保持（AUDIO_READYで使う）
  window.addEventListener(TTS_PHONEME_READY_EVENT, ((event: CustomEvent<{ type: string; phonemes?: import('./types').PhonemeEvent[]; text?: string; rate?: number }>) => {
    const phonemes = event.detail.phonemes || [];
    if (phonemes.length > 0) {
      _pendingPhonemes = phonemes;
    }
  }) as EventListener);

  console.log('✅ TTS/LipSync初期化完了');
}

// STT初期化
function initSTT() {
  // 設定適用
  if (currentSettings?.stt) {
    sttService.setConfig({
      enabled: currentSettings.stt.enabled,
      engine: currentSettings.stt.engine ?? 'whisper',
      autoSend: currentSettings.stt.autoSend,
      alwaysOn: currentSettings.stt.alwaysOn ?? false,
      lang: currentSettings.stt.lang,
      whisperModel: (currentSettings.stt as any)?.whisperModel,
    });

    // alwaysOnが有効なら自動開始
    if (currentSettings.stt.alwaysOn) {
      setTimeout(() => {
        sttService.start();
      }, 1000);
    }
  }

  // alwaysOn時のマイクボタン表示更新
  function updateMicButtonAlwaysOn() {
    if (sttService.getIsAlwaysOn()) {
      micBtn.classList.add('always-on');
    } else {
      micBtn.classList.remove('always-on');
    }
  }

  // STTコールバック設定
  sttService.setCallbacks({
    onStart: () => {
      console.log('🎤 STT開始');
      setMicState('listening');
      updateMicButtonAlwaysOn();
      platform.setBrainState({ isMicListening: true });
    },
    onRecordingStop: () => {
      // 録音停止→文字起こし中 (Whisper系のみ)
      console.log('🎤 STT: 録音停止、文字起こし中...');
      setMicState('processing');
    },
    onResult: (text, isFinal) => {
      userInput.value = text;
      if (isFinal) {
        // autoSendが有効なら自動送信（isStreaming中はリトライ）
        if (currentSettings?.stt?.autoSend) {
          const attemptSend = () => {
            if (isStreaming) {
              // 前のレスポンスがまだ配信中→500ms後にリトライ
              setTimeout(attemptSend, 500);
              return;
            }
            if (userInput.value.trim()) {
              sendMessage();
            }
            setMicState('idle');
          };
          setTimeout(attemptSend, 200);
        } else {
          setMicState('idle');
        }
      }
    },
    onEnd: () => {
      console.log('🎤 STT終了');
      platform.setBrainState({ isMicListening: false });
      // listening or processing のままならidleに戻す
      // （無音でonResultが来ないケースでprocessingが残り続けるのを防止）
      if (currentMicState === 'listening' || currentMicState === 'processing') {
        setMicState('idle');
      }
      updateMicButtonAlwaysOn();
    },
    onError: (error) => {
      console.error('❌ STTエラー:', error);
      setMicState('error');
      // エラー後3秒でidleに戻す
      setTimeout(() => {
        if (currentMicState === 'error') {
          setMicState('idle');
        }
      }, 3000);
    }
  });

  // マイクボタンクリックハンドラ
  micBtn.addEventListener('click', async () => {
    if (!sttService.isSupported()) {
      addMessage('assistant', `⚠️ ${t('app.error.sttUnsupported')}`, false);
      return;
    }

    const started = await sttService.toggle();
    if (!started && currentMicState === 'listening') {
      setMicState('processing');
    }
  });

  // キーボードショートカット: Ctrl+M
  document.addEventListener('keydown', async (e) => {
    if (e.ctrlKey && e.key === 'm') {
      e.preventDefault();
      if (!sttService.isSupported()) {
        return;
      }
      await sttService.toggle();
    }
  });

  console.log('✅ STT初期化完了');
}

// 初期化時にSTTも呼び出す
setTimeout(() => {
  initSTT();
}, 100);

console.log('🎨 アプリ初期化完了');
