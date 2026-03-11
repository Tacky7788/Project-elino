// TTS Service - Web Speech API + VOICEVOX + OpenAI + ElevenLabs + Google TTS + AivisSpeech + Style-Bert-VITS2

import { platform } from './platform';

export type TTSEngine = 'web-speech' | 'voicevox' | 'openai' | 'elevenlabs' | 'google-tts' | 'aivis-speech' | 'style-bert-vits2' | 'openai-compat-tts' | 'none';

export interface TTSConfig {
  engine: TTSEngine;
  webSpeech: {
    lang: string;
    rate: number;
    pitch: number;
  };
  voicevox: {
    baseUrl: string;
    speakerId: number;
  };
  openai: {
    voice: string;
    model: string;
    speed: number;
  };
  elevenlabs: {
    voiceId: string;
    model: string;
    stability: number;
    similarityBoost: number;
    speed: number;
  };
  googleTts: {
    languageCode: string;
    voiceName: string;
    speakingRate: number;
    pitch: number;
    useGeminiKey: boolean;
  };
  aivisSpeech: {
    baseUrl: string;
    speakerId: number;
  };
  styleBertVits2: {
    baseUrl: string;
    modelId: number;
    speakerId: number;
    style: string;
    styleWeight: number;
    language: string;
    speed: number;
  };
  openaiCompatTts: {
    baseUrl: string;
    apiKey: string;
    model: string;
    voice: string;
    speed: number;
  };
}

export interface TTSCallbacks {
  onStart?: () => void;
  onEnd?: () => void;
  onError?: (error: string) => void;
}

import './types'; // Import for global type declaration

// VOICEVOX音声接続用イベント（amplitude lip sync用）
export const TTS_AUDIO_READY_EVENT = 'tts-audio-ready';

// 音素タイムライン準備完了イベント（phoneme lip sync用）
export const TTS_PHONEME_READY_EVENT = 'tts-phoneme-ready';

class TTSService {
  private synth: SpeechSynthesis;
  private currentUtterance: SpeechSynthesisUtterance | null = null;
  private currentAudio: HTMLAudioElement | null = null;
  private _cancelled = false;
  private callbacks: TTSCallbacks = {};
  // 感情による声トーン補正（speed: 0.85-1.15, pitch: -0.1〜0.1）
  private emotionTone: { speed: number; pitch: number } = { speed: 1.0, pitch: 0 };
  private config: TTSConfig = {
    engine: 'web-speech',
    webSpeech: { lang: 'ja-JP', rate: 1.0, pitch: 1.0 },
    voicevox: { baseUrl: 'http://127.0.0.1:50021', speakerId: 0 },
    openai: { voice: 'nova', model: 'tts-1', speed: 1.0 },
    elevenlabs: { voiceId: '', model: 'eleven_multilingual_v2', stability: 0.5, similarityBoost: 0.75, speed: 1.0 },
    googleTts: { languageCode: 'ja-JP', voiceName: 'ja-JP-Neural2-B', speakingRate: 1.0, pitch: 0, useGeminiKey: true },
    aivisSpeech: { baseUrl: 'http://127.0.0.1:10101', speakerId: 0 },
    styleBertVits2: { baseUrl: 'http://127.0.0.1:5000', modelId: 0, speakerId: 0, style: 'Neutral', styleWeight: 5, language: 'JP', speed: 1.0 },
    openaiCompatTts: { baseUrl: '', apiKey: '', model: 'tts-1', voice: 'alloy', speed: 1.0 }
  };
  private japaneseVoice: SpeechSynthesisVoice | null = null;
  private outputDeviceId: string = ''; // 空文字=デフォルトデバイス

  constructor() {
    this.synth = window.speechSynthesis;
    this.initJapaneseVoice();
  }

  private initJapaneseVoice() {
    const findJapaneseVoice = () => {
      const voices = this.synth.getVoices();
      // 日本語音声を優先順位で探す
      const jaVoice = voices.find(v => v.lang === 'ja-JP') ||
                      voices.find(v => v.lang.startsWith('ja')) ||
                      voices.find(v => v.name.includes('Japanese'));
      if (jaVoice) {
        this.japaneseVoice = jaVoice;
        console.log('✅ TTS: 日本語音声を検出:', jaVoice.name);
      }
    };

    // 音声リストが非同期でロードされる場合がある
    if (this.synth.getVoices().length > 0) {
      findJapaneseVoice();
    } else {
      this.synth.addEventListener('voiceschanged', findJapaneseVoice, { once: true });
    }
  }

  setConfig(config: Partial<TTSConfig>) {
    this.config = { ...this.config, ...config };
  }

  get currentEngine(): string {
    return this.config.engine;
  }

  /** VRChat等に音声を出力するためのデバイスID設定 */
  setOutputDevice(deviceId: string) {
    this.outputDeviceId = deviceId;
    console.log(`🔊 TTS出力デバイス変更: ${deviceId || 'デフォルト'}`);
  }

  /** Audio要素に出力デバイスを設定（VRミキサー未使用時のフォールバック） */
  private async applySinkId(audio: HTMLAudioElement): Promise<void> {
    // VRミキサーがアクティブなら、ローカルスピーカーで再生（sinkIdは変えない）
    // ミキサーが仮想デバイスへの転送を担当する
    const { isActive } = await import('./vr-audio-mixer');
    if (isActive()) return;

    if (this.outputDeviceId && typeof (audio as any).setSinkId === 'function') {
      try {
        await (audio as any).setSinkId(this.outputDeviceId);
      } catch (err) {
        console.error('❌ 出力デバイス設定失敗:', err);
      }
    }
  }

  /** VRミキサーにTTS音声データを転送 */
  private async routeToVrMixer(audioData: ArrayBuffer, mimeType: string = 'audio/wav'): Promise<void> {
    const { isActive, routeTTSToVirtual } = await import('./vr-audio-mixer');
    if (isActive()) {
      routeTTSToVirtual(audioData, mimeType);
    }
  }

  setCallbacks(callbacks: TTSCallbacks) {
    this.callbacks = callbacks;
  }

  /** 感情状態から声のトーンを更新（ipc-memory-apply.cjsのcalculateVoiceToneと同じロジック） */
  setEmotionTone(emotions: { arousal: number; valence: number; surprise?: number }) {
    let speed = 0.9 + emotions.arousal * 0.25;
    if ((emotions.surprise || 0) > 0.5) speed += 0.05;
    speed = Math.max(0.85, Math.min(1.15, speed));

    let pitch = (emotions.valence - 0.5) * 0.2;
    if ((emotions.surprise || 0) > 0.5) pitch += 0.03;
    pitch = Math.max(-0.1, Math.min(0.1, pitch));

    this.emotionTone = { speed: parseFloat(speed.toFixed(2)), pitch: parseFloat(pitch.toFixed(2)) };
  }

  async speak(text: string): Promise<void> {
    if (!text.trim()) return;

    // 既存の音声をキャンセル
    this.cancel();

    if (this.config.engine === 'none') {
      return;
    }

    if (this.config.engine === 'voicevox') {
      await this.speakVoicevox(text);
    } else if (this.config.engine === 'openai') {
      await this.speakOpenAI(text);
    } else if (this.config.engine === 'elevenlabs') {
      await this.speakElevenLabs(text);
    } else if (this.config.engine === 'google-tts') {
      await this.speakGoogleTTS(text);
    } else if (this.config.engine === 'aivis-speech') {
      await this.speakAivisSpeech(text);
    } else if (this.config.engine === 'style-bert-vits2') {
      await this.speakStyleBertVits2(text);
    } else if (this.config.engine === 'openai-compat-tts') {
      await this.speakOpenAICompat(text);
    } else {
      this.speakWebSpeech(text);
    }
  }

  private speakWebSpeech(text: string) {
    const utterance = new SpeechSynthesisUtterance(text);
    utterance.lang = this.config.webSpeech.lang;
    utterance.rate = this.config.webSpeech.rate * this.emotionTone.speed;
    utterance.pitch = Math.max(0, this.config.webSpeech.pitch + this.emotionTone.pitch);

    if (this.japaneseVoice) {
      utterance.voice = this.japaneseVoice;
    }

    utterance.onstart = () => {
      this.callbacks.onStart?.();
      // Web Speech用音素推定イベント発火
      window.dispatchEvent(new CustomEvent(TTS_PHONEME_READY_EVENT, {
        detail: { type: 'web-speech', text, rate: this.config.webSpeech.rate }
      }));
    };

    utterance.onend = () => {
      this.currentUtterance = null;
      this.callbacks.onEnd?.();
    };

    utterance.onerror = (event) => {
      this.currentUtterance = null;
      // canceled はユーザー操作なのでエラーとして扱わない
      if (event.error !== 'canceled') {
        this.callbacks.onError?.(event.error);
      }
    };

    this.currentUtterance = utterance;
    this.synth.speak(utterance);
  }

  private async speakOpenAI(text: string): Promise<void> {
    try {
      const audioData = await platform.ttsOpenaiSynthesize({
        text,
        voice: this.config.openai.voice,
        model: this.config.openai.model,
        speed: Math.max(0.25, Math.min(4.0, this.config.openai.speed * this.emotionTone.speed))
      });

      const blob = new Blob([audioData], { type: 'audio/mpeg' });
      const url = URL.createObjectURL(blob);
      const audio = new Audio(url);
      await this.applySinkId(audio);
      this.currentAudio = audio;

      this.callbacks.onStart?.();

      // 音素推定イベント（Web Speech互換、テキストベース）
      window.dispatchEvent(new CustomEvent(TTS_PHONEME_READY_EVENT, {
        detail: { type: 'openai', text, rate: this.config.openai.speed }
      }));

      audio.onended = () => {
        URL.revokeObjectURL(url);
        this.currentAudio = null;
        this.callbacks.onEnd?.();
      };

      audio.onerror = () => {
        URL.revokeObjectURL(url);
        this.currentAudio = null;
        this.callbacks.onError?.('OpenAI TTS再生エラー');
      };

      await audio.play();
      // play()成功後にリップシンク接続
      window.dispatchEvent(new CustomEvent(TTS_AUDIO_READY_EVENT, { detail: audio }));
    } catch (err) {
      console.error('OpenAI TTS合成エラー:', err);
      console.warn('Web Speechにフォールバック');
      this.speakWebSpeech(text);
    }
  }

  // Cloud TTS共通ヘルパー: IPC→ArrayBuffer→Audio再生
  private async playCloudTTS(audioData: ArrayBuffer, mimeType: string, engineLabel: string, text: string, rate?: number): Promise<void> {
    // VRミキサーにも転送
    this.routeToVrMixer(audioData, mimeType);

    const blob = new Blob([audioData], { type: mimeType });
    const url = URL.createObjectURL(blob);
    const audio = new Audio(url);
    await this.applySinkId(audio);
    this.currentAudio = audio;

    this.callbacks.onStart?.();

    // 音素推定イベント（テキストベース）
    window.dispatchEvent(new CustomEvent(TTS_PHONEME_READY_EVENT, {
      detail: { type: engineLabel, text, rate: rate ?? 1.0 }
    }));

    return new Promise((resolve, reject) => {
      audio.onended = () => {
        URL.revokeObjectURL(url);
        this.currentAudio = null;
        this.callbacks.onEnd?.();
        resolve();
      };
      audio.onerror = () => {
        URL.revokeObjectURL(url);
        this.currentAudio = null;
        this.callbacks.onError?.(`${engineLabel} TTS再生エラー`);
        reject(new Error(`${engineLabel} TTS再生エラー`));
      };
      audio.play().then(() => {
        // play()成功後にリップシンク接続
        window.dispatchEvent(new CustomEvent(TTS_AUDIO_READY_EVENT, { detail: audio }));
      }).catch(reject);
    });
  }

  private async speakElevenLabs(text: string): Promise<void> {
    try {
      const audioData = await platform.ttsElevenlabsSynthesize({
        text,
        voiceId: this.config.elevenlabs.voiceId,
        model: this.config.elevenlabs.model,
        stability: this.config.elevenlabs.stability,
        similarityBoost: this.config.elevenlabs.similarityBoost,
        speed: Math.max(0.5, Math.min(2.0, this.config.elevenlabs.speed * this.emotionTone.speed))
      });
      await this.playCloudTTS(audioData, 'audio/mpeg', 'elevenlabs', text, this.config.elevenlabs.speed);
    } catch (err) {
      console.error('ElevenLabs TTS合成エラー:', err);
      console.warn('Web Speechにフォールバック');
      this.speakWebSpeech(text);
    }
  }

  private async speakGoogleTTS(text: string): Promise<void> {
    try {
      const audioData = await platform.ttsGoogleSynthesize({
        text,
        languageCode: this.config.googleTts.languageCode,
        voiceName: this.config.googleTts.voiceName,
        speakingRate: Math.max(0.25, Math.min(4.0, this.config.googleTts.speakingRate * this.emotionTone.speed)),
        pitch: Math.max(-20, Math.min(20, this.config.googleTts.pitch + this.emotionTone.pitch * 100)),
        useGeminiKey: this.config.googleTts.useGeminiKey
      });
      await this.playCloudTTS(audioData, 'audio/mpeg', 'google-tts', text, this.config.googleTts.speakingRate);
    } catch (err) {
      console.error('Google TTS合成エラー:', err);
      console.warn('Web Speechにフォールバック');
      this.speakWebSpeech(text);
    }
  }

  // AivisSpeech: VOICEVOX互換のパイプライン合成
  private async synthesizeAivisSpeechChunk(text: string): Promise<{ audio: ArrayBuffer; phonemes: import('./types').PhonemeEvent[] }> {
    const cleanText = this.cleanTextForVoicevox(text);
    if (!cleanText) return { audio: new ArrayBuffer(0), phonemes: [] };

    if (platform.aivisSpeechSynthesizeWithPhonemes) {
      return await platform.aivisSpeechSynthesizeWithPhonemes({
        text: cleanText,
        speakerId: this.config.aivisSpeech.speakerId
      });
    }
    const audio = await platform.aivisSpeechSynthesize({
      text: cleanText,
      speakerId: this.config.aivisSpeech.speakerId
    });
    return { audio, phonemes: [] };
  }

  private async speakAivisSpeech(text: string): Promise<void> {
    try {
      const sentences = this.splitSentences(text);
      if (sentences.length === 0) return;

      this._cancelled = false;

      let nextPromise: Promise<{ audio: ArrayBuffer; phonemes: import('./types').PhonemeEvent[] }> | null =
        this.synthesizeAivisSpeechChunk(sentences[0]);

      for (let i = 0; i < sentences.length; i++) {
        const result = await nextPromise!;
        if (this._cancelled) return;

        nextPromise = (i + 1 < sentences.length)
          ? this.synthesizeAivisSpeechChunk(sentences[i + 1])
          : null;

        if (i === 0) {
          this.callbacks.onStart?.();
          window.dispatchEvent(new CustomEvent(TTS_PHONEME_READY_EVENT, {
            detail: { type: 'aivis-speech', phonemes: result.phonemes }
          }));
        }

        await this.playAudioBuffer(result.audio);
        if (this._cancelled) return;
      }

      this.currentAudio = null;
      this.callbacks.onEnd?.();
    } catch (err) {
      console.error('AivisSpeech合成エラー:', err);
      console.warn('Web Speechにフォールバック');
      this.speakWebSpeech(text);
    }
  }

  private async speakStyleBertVits2(text: string): Promise<void> {
    try {
      const sentences = this.splitSentences(text);
      if (sentences.length === 0) return;

      this._cancelled = false;
      this.callbacks.onStart?.();

      // 音素推定イベント（テキストベース）
      window.dispatchEvent(new CustomEvent(TTS_PHONEME_READY_EVENT, {
        detail: { type: 'style-bert-vits2', text, rate: this.config.styleBertVits2.speed }
      }));

      for (let i = 0; i < sentences.length; i++) {
        if (this._cancelled) return;

        const cleanText = this.cleanTextForVoicevox(sentences[i]);
        if (!cleanText) continue;

        const audioData = await platform.styleBertVits2Synthesize({
          text: cleanText,
          modelId: this.config.styleBertVits2.modelId,
          speakerId: this.config.styleBertVits2.speakerId,
          style: this.config.styleBertVits2.style,
          styleWeight: this.config.styleBertVits2.styleWeight,
          language: this.config.styleBertVits2.language,
          speed: Math.max(0.5, Math.min(2.0, this.config.styleBertVits2.speed * this.emotionTone.speed))
        });

        if (this._cancelled) return;
        await this.playAudioBuffer(audioData);
      }

      this.currentAudio = null;
      this.callbacks.onEnd?.();
    } catch (err) {
      console.error('Style-Bert-VITS2合成エラー:', err);
      console.warn('Web Speechにフォールバック');
      this.speakWebSpeech(text);
    }
  }

  private async speakOpenAICompat(text: string): Promise<void> {
    const cfg = this.config.openaiCompatTts;
    if (!cfg.baseUrl) {
      console.warn('OpenAI互換TTS: baseURLが未設定');
      this.speakWebSpeech(text);
      return;
    }
    try {
      const headers: Record<string, string> = { 'Content-Type': 'application/json' };
      if (cfg.apiKey) headers['Authorization'] = `Bearer ${cfg.apiKey}`;
      const res = await fetch(`${cfg.baseUrl.replace(/\/$/, '')}/audio/speech`, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          model: cfg.model || 'tts-1',
          input: text,
          voice: cfg.voice || 'alloy',
          speed: Math.max(0.25, Math.min(4.0, (cfg.speed || 1.0) * this.emotionTone.speed)),
        }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}: ${await res.text()}`);
      const audioData = await res.arrayBuffer();
      this.callbacks.onStart?.();
      window.dispatchEvent(new CustomEvent(TTS_PHONEME_READY_EVENT, {
        detail: { type: 'openai-compat-tts', text, rate: cfg.speed || 1.0 }
      }));
      await this.playCloudTTS(audioData, 'audio/mpeg', 'OpenAI互換TTS', text, cfg.speed);
    } catch (err) {
      console.error('OpenAI互換TTS合成エラー:', err);
      console.warn('Web Speechにフォールバック');
      this.speakWebSpeech(text);
    }
  }

  // 文分割（日本語の句点・感嘆符・改行で分割、短すぎる断片はマージ）
  private splitSentences(text: string): string[] {
    const parts = text.split(/(?<=[。！？\n])/);
    const sentences: string[] = [];
    let buffer = '';

    for (const part of parts) {
      buffer += part;
      if (buffer.trim().length >= 5) {
        sentences.push(buffer.trim());
        buffer = '';
      }
    }

    // 残りを最後の文にマージ or 単独追加
    if (buffer.trim()) {
      if (sentences.length > 0) {
        sentences[sentences.length - 1] += buffer.trim();
      } else {
        sentences.push(buffer.trim());
      }
    }

    return sentences.filter(s => s.length > 0);
  }

  // VOICEVOX用テキスト前処理（読み誤り軽減）
  private cleanTextForVoicevox(text: string): string {
    let t = text;
    // 絵文字を除去
    t = t.replace(/[\u{1F300}-\u{1F9FF}\u{2600}-\u{27BF}\u{FE00}-\u{FE0F}\u{200D}\u{20E3}\u{E0020}-\u{E007F}]/gu, '');
    // 「w」「草」系の笑い表現 → 読める形に
    t = t.replace(/w{2,}/g, 'わらわら');
    t = t.replace(/([^a-zA-Z0-9])w([^a-zA-Z0-9]|$)/g, '$1わら$2');
    // マークダウン記号を除去
    t = t.replace(/[*_~`#]/g, '');
    // 連続記号を整理
    t = t.replace(/…+/g, '、');
    t = t.replace(/\.{2,}/g, '、');
    t = t.replace(/ー{3,}/g, 'ー');
    t = t.replace(/〜{2,}/g, '〜');
    // 括弧で囲まれたアクション記述を除去 (*笑う* 等)
    t = t.replace(/\(([^)]{1,10})\)/g, '');
    t = t.replace(/（([^）]{1,10})）/g, '');
    // 前後の空白を整理
    t = t.trim();
    return t;
  }

  // VOICEVOX: 1チャンク合成（IPC呼び出し）
  private async synthesizeVoicevoxChunk(text: string): Promise<{ audio: ArrayBuffer; phonemes: import('./types').PhonemeEvent[] }> {
    const cleanText = this.cleanTextForVoicevox(text);
    if (!cleanText) return { audio: new ArrayBuffer(0), phonemes: [] };

    if (platform.voicevoxSynthesizeWithPhonemes) {
      return await platform.voicevoxSynthesizeWithPhonemes({
        text: cleanText,
        speakerId: this.config.voicevox.speakerId
      });
    }
    // レガシーフォールバック（音素なし）
    const audio = await platform.voicevoxSynthesize({
      text: cleanText,
      speakerId: this.config.voicevox.speakerId
    });
    return { audio, phonemes: [] };
  }

  // 音声バッファ再生（Promise化）
  private async playAudioBuffer(audioData: ArrayBuffer): Promise<void> {
    // VRミキサーにも転送
    this.routeToVrMixer(audioData, 'audio/wav');

    const blob = new Blob([audioData], { type: 'audio/wav' });
    const url = URL.createObjectURL(blob);
    const audio = new Audio(url);
    await this.applySinkId(audio);
    this.currentAudio = audio;

    return new Promise((resolve, reject) => {
      audio.onended = () => {
        URL.revokeObjectURL(url);
        if (this.currentAudio === audio) this.currentAudio = null;
        resolve();
      };

      audio.onerror = () => {
        URL.revokeObjectURL(url);
        if (this.currentAudio === audio) this.currentAudio = null;
        reject(new Error('VOICEVOX再生エラー'));
      };

      audio.play().then(() => {
        // play()成功後にリップシンク接続（再生中のデータがanalyserに流れる）
        window.dispatchEvent(new CustomEvent(TTS_AUDIO_READY_EVENT, { detail: audio }));
      }).catch(reject);
    });
  }

  // VOICEVOX: 文分割＋パイプライン合成（1文再生中に次文を合成）
  private async speakVoicevox(text: string): Promise<void> {
    try {
      const sentences = this.splitSentences(text);
      if (sentences.length === 0) return;

      this._cancelled = false;

      // 最初のチャンク合成を開始
      let nextPromise: Promise<{ audio: ArrayBuffer; phonemes: import('./types').PhonemeEvent[] }> | null =
        this.synthesizeVoicevoxChunk(sentences[0]);

      for (let i = 0; i < sentences.length; i++) {
        const result = await nextPromise!;
        if (this._cancelled) return;

        // パイプライン: 再生中に次のチャンク合成を開始
        nextPromise = (i + 1 < sentences.length)
          ? this.synthesizeVoicevoxChunk(sentences[i + 1])
          : null;

        // 最初のチャンクでコールバック発火
        if (i === 0) {
          this.callbacks.onStart?.();
        }
        // 全チャンクで音素イベント発火（リップシンク用）
        if (result.phonemes && result.phonemes.length > 0) {
          window.dispatchEvent(new CustomEvent(TTS_PHONEME_READY_EVENT, {
            detail: { type: 'voicevox', phonemes: result.phonemes }
          }));
        }

        // チャンク再生（完了まで待機）
        await this.playAudioBuffer(result.audio);
        if (this._cancelled) return;
      }

      this.currentAudio = null;
      this.callbacks.onEnd?.();
    } catch (err) {
      console.error('VOICEVOX合成エラー:', err);
      console.warn('Web Speechにフォールバック');
      this.speakWebSpeech(text);
    }
  }

  // インクリメンタルTTS: LLMストリーミング中に文単位で合成・再生キュー
  private _incrementalQueue: string[] = [];
  private _isPlayingQueue = false;
  private _incrementalStarted = false;
  private _prefetchPromise: Promise<{ audio: ArrayBuffer; phonemes: import('./types').PhonemeEvent[] }> | null = null;

  async queueChunk(text: string): Promise<void> {
    if (!text.trim() || (this.config.engine !== 'voicevox' && this.config.engine !== 'aivis-speech' && this.config.engine !== 'style-bert-vits2')) return;
    this._incrementalQueue.push(text.trim());
    // 先読み: キューに入った瞬間に合成開始
    if (!this._prefetchPromise && this._incrementalQueue.length === 1) {
      this._prefetchPromise = this._synthesizeIncrementalChunk(this._incrementalQueue[0]);
    }
    if (!this._isPlayingQueue) {
      this._processIncrementalQueue();
    }
  }

  // エンジンに応じた合成メソッドを選択
  private _synthesizeIncrementalChunk(text: string): Promise<{ audio: ArrayBuffer; phonemes: import('./types').PhonemeEvent[] }> {
    if (this.config.engine === 'aivis-speech') {
      return this.synthesizeAivisSpeechChunk(text);
    }
    if (this.config.engine === 'style-bert-vits2') {
      return this.synthesizeStyleBertVits2Chunk(text);
    }
    return this.synthesizeVoicevoxChunk(text);
  }

  // Style-Bert-VITS2: 1チャンク合成
  private async synthesizeStyleBertVits2Chunk(text: string): Promise<{ audio: ArrayBuffer; phonemes: import('./types').PhonemeEvent[] }> {
    const cleanText = this.cleanTextForVoicevox(text);
    if (!cleanText) return { audio: new ArrayBuffer(0), phonemes: [] };

    const audio = await platform.styleBertVits2Synthesize({
      text: cleanText,
      modelId: this.config.styleBertVits2.modelId,
      speakerId: this.config.styleBertVits2.speakerId,
      style: this.config.styleBertVits2.style,
      styleWeight: this.config.styleBertVits2.styleWeight,
      language: this.config.styleBertVits2.language,
      speed: this.config.styleBertVits2.speed
    });
    return { audio, phonemes: [] };
  }

  private async _processIncrementalQueue(): Promise<void> {
    if (this._isPlayingQueue) return;
    this._isPlayingQueue = true;
    this._cancelled = false;
    this._incrementalStarted = false;

    while (this._incrementalQueue.length > 0 && !this._cancelled) {
      const text = this._incrementalQueue.shift()!;
      try {
        // 先読み済みならそれを使う、なければ新規合成
        const result = this._prefetchPromise
          ? await this._prefetchPromise
          : await this._synthesizeIncrementalChunk(text);
        this._prefetchPromise = null;

        if (this._cancelled) break;

        // 次のチャンクを先読み
        if (this._incrementalQueue.length > 0) {
          this._prefetchPromise = this._synthesizeIncrementalChunk(this._incrementalQueue[0]);
        }

        if (!this._incrementalStarted) {
          this._incrementalStarted = true;
          this.callbacks.onStart?.();
          window.dispatchEvent(new CustomEvent(TTS_PHONEME_READY_EVENT, {
            detail: { type: this.config.engine, phonemes: result.phonemes }
          }));
        }

        await this.playAudioBuffer(result.audio);
      } catch (err) {
        console.error('❌ インクリメンタルTTSエラー:', err);
      }
    }

    this._isPlayingQueue = false;
    this._prefetchPromise = null;
    if (this._incrementalStarted && !this._cancelled) {
      this.callbacks.onEnd?.();
    }
    this._incrementalStarted = false;
  }

  isIncrementalActive(): boolean {
    return this._isPlayingQueue || this._incrementalQueue.length > 0;
  }

  cancel() {
    this._cancelled = true;
    this._incrementalQueue = [];
    this._prefetchPromise = null;
    this._isPlayingQueue = false;
    this._incrementalStarted = false;

    // Web Speech API
    if (this.currentUtterance) {
      this.synth.cancel();
      this.currentUtterance = null;
    }

    // VOICEVOX / OpenAI Audio
    if (this.currentAudio) {
      this.currentAudio.pause();
      this.currentAudio = null;
    }
  }

  isSpeaking(): boolean {
    return this.synth.speaking || this.currentAudio !== null || this._isPlayingQueue;
  }

  getCurrentAudio(): HTMLAudioElement | null {
    return this.currentAudio;
  }
}

export const ttsService = new TTSService();
