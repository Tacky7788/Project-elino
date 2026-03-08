import { initI18n, applyDOMTranslations } from './locales';

const messagesDiv = document.getElementById('messages')!;
const inputEl = document.getElementById('input') as HTMLInputElement;
const sendBtn = document.getElementById('send-btn')!;
const companionNameEl = document.getElementById('companion-name')!;

import { platform } from './platform';
const api = platform;
const MAX_MESSAGES = 10;

let streamingEl: HTMLDivElement | null = null;
let streamBuffer = '';

// メッセージ追加
function addMessage(role: 'user' | 'assistant', text: string) {
  const div = document.createElement('div');
  div.className = `msg ${role}`;
  div.textContent = text;
  messagesDiv.appendChild(div);

  // 古いメッセージを削除
  while (messagesDiv.children.length > MAX_MESSAGES) {
    messagesDiv.removeChild(messagesDiv.firstChild!);
  }

  messagesDiv.scrollTop = messagesDiv.scrollHeight;
  return div;
}

// 送信
function send() {
  const text = inputEl.value.trim();
  if (!text) return;
  inputEl.value = '';
  addMessage('user', text);

  // メインのチャットウィンドウに転送
  api.vrOverlaySend?.(text);
}

sendBtn.addEventListener('click', send);
inputEl.addEventListener('keydown', (e: KeyboardEvent) => {
  if (e.key === 'Enter' && !e.shiftKey) {
    e.preventDefault();
    send();
  }
});

// メインウィンドウからのメッセージ受信
api.onVrOverlayMessage?.((data: { role: string; text: string }) => {
  if (data.role === 'assistant') {
    addMessage('assistant', data.text);
  }
});

// ストリーミング受信
api.onVrOverlayDelta?.((delta: string) => {
  if (!streamingEl) {
    streamingEl = document.createElement('div');
    streamingEl.className = 'msg assistant streaming';
    messagesDiv.appendChild(streamingEl);
    streamBuffer = '';
  }
  streamBuffer += delta;
  streamingEl.textContent = streamBuffer;
  messagesDiv.scrollTop = messagesDiv.scrollHeight;
});

api.onVrOverlayDone?.(() => {
  if (streamingEl) {
    streamingEl.classList.remove('streaming');
    streamingEl = null;
    streamBuffer = '';

    // 古いメッセージを削除
    while (messagesDiv.children.length > MAX_MESSAGES) {
      messagesDiv.removeChild(messagesDiv.firstChild!);
    }
  }
});

// コンパニオン名取得
api.getProfile?.().then((profile: any) => {
  if (profile?.companionName) {
    companionNameEl.textContent = profile.companionName;
  }
});

// i18n初期化
initI18n().then(() => applyDOMTranslations());
