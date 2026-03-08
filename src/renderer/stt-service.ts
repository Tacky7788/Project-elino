// STT Service - Web Speech API / Whisper API / Whisper Local 切り替え対応
import { t } from './locales';
import { platform } from './platform';

export interface STTConfig {
  enabled: boolean;
  engine: 'web-speech' | 'whisper' | 'whisper-local';
  autoSend: boolean;
  alwaysOn: boolean;
  lang: string;
  whisperModel?: string;
}

export interface STTCallbacks {
  onStart?: () => void;
  onRecordingStop?: () => void;  // 録音停止→文字起こし開始
  onResult?: (text: string, isFinal: boolean) => void;
  onEnd?: () => void;
  onError?: (error: string) => void;
}

// ====== Web Speech API type definitions ======
interface SpeechRecognitionEvent extends Event {
  results: SpeechRecognitionResultList;
  resultIndex: number;
}
interface SpeechRecognitionResultList {
  length: number;
  item(index: number): SpeechRecognitionResult;
  [index: number]: SpeechRecognitionResult;
}
interface SpeechRecognitionResult {
  length: number;
  item(index: number): SpeechRecognitionAlternative;
  [index: number]: SpeechRecognitionAlternative;
  isFinal: boolean;
}
interface SpeechRecognitionAlternative {
  transcript: string;
  confidence: number;
}
interface SpeechRecognitionErrorEvent extends Event {
  error: string;
  message?: string;
}
interface SpeechRecognition extends EventTarget {
  continuous: boolean;
  interimResults: boolean;
  lang: string;
  maxAlternatives: number;
  onstart: ((this: SpeechRecognition, ev: Event) => any) | null;
  onresult: ((this: SpeechRecognition, ev: SpeechRecognitionEvent) => any) | null;
  onend: ((this: SpeechRecognition, ev: Event) => any) | null;
  onerror: ((this: SpeechRecognition, ev: SpeechRecognitionErrorEvent) => any) | null;
  onspeechend: ((this: SpeechRecognition, ev: Event) => any) | null;
  start(): void;
  stop(): void;
  abort(): void;
}
interface SpeechRecognitionConstructor {
  new(): SpeechRecognition;
}
declare global {
  interface Window {
    SpeechRecognition?: SpeechRecognitionConstructor;
    webkitSpeechRecognition?: SpeechRecognitionConstructor;
  }
}

class STTService {
  private callbacks: STTCallbacks = {};
  private config: STTConfig = {
    enabled: true,
    engine: 'whisper',
    autoSend: false,
    alwaysOn: false,
    lang: 'ja-JP'
  };
  private isListening = false;
  private permissionGranted = false;
  private isPaused = false;

  // --- Web Speech API ---
  private recognition: SpeechRecognition | null = null;

  // --- Whisper (MediaRecorder) ---
  private mediaRecorder: MediaRecorder | null = null;
  private audioChunks: Blob[] = [];
  private stream: MediaStream | null = null;
  private isTranscribing = false;
  private audioContext: AudioContext | null = null;
  private analyser: AnalyserNode | null = null;
  private vadInterval: number | null = null;
  private silenceStart: number | null = null;
  private hasVoice = false;
  private readonly SILENCE_THRESHOLD = 15;
  private readonly SILENCE_DURATION = 1500;
  private readonly MAX_RECORD_DURATION = 30000;
  private maxRecordTimer: number | null = null;
  private peakVolume = 0; // 録音中の最大音量を記録

  // Whisperが無音時に生成しがちなハルシネーション（部分一致）
  private static readonly HALLUCINATION_PATTERNS = [
    'ご視聴ありがとうございました',
    'ご視聴いただきありがとうございます',
    'チャンネル登録',
    'お疲れ様でした',
    'ありがとうございました',
    'おやすみなさい',
    'いってらっしゃい',
    'お願いします',
    'Thank you for watching',
    'Thanks for watching',
    'Please subscribe',
    'Bye bye',
    'Subtitles by',
    'MoMoClips',
    'ご覧いただき',
    'お待ちください',
  ];

  constructor() {
    this.initWebSpeech();
  }

  // ====== Web Speech API 初期化 ======
  private initWebSpeech() {
    const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SR) {
      console.warn('⚠️ STT: Web Speech API 非対応');
      return;
    }

    this.recognition = new SR();
    this.recognition.continuous = false;
    this.recognition.interimResults = true;
    this.recognition.maxAlternatives = 1;
    this.recognition.lang = this.config.lang;

    this.recognition.onstart = () => {
      this.isListening = true;
      this.callbacks.onStart?.();
    };

    this.recognition.onresult = (event: SpeechRecognitionEvent) => {
      let transcript = '';
      let isFinal = false;
      for (let i = event.resultIndex; i < event.results.length; i++) {
        const result = event.results[i];
        transcript += result[0].transcript;
        if (result.isFinal) isFinal = true;
      }
      this.callbacks.onResult?.(transcript, isFinal);
    };

    this.recognition.onend = () => {
      this.isListening = false;
      this.callbacks.onEnd?.();
      if (this.config.alwaysOn && this.config.enabled && !this.isPaused) {
        setTimeout(() => {
          if (!this.isPaused) this.start();
        }, 500);
      }
    };

    this.recognition.onerror = (event: SpeechRecognitionErrorEvent) => {
      this.isListening = false;
      if (event.error === 'no-speech') {
        console.log('🔇 STT: 音声が検出されませんでした');
        this.callbacks.onEnd?.();
        return;
      }
      if (event.error === 'aborted') {
        this.callbacks.onEnd?.();
        return;
      }
      if (event.error === 'network') {
        console.error('❌ STT: ネットワークエラー（Whisperエンジンに切り替えてください）');
        this.callbacks.onError?.(t('app.stt.networkError'));
        return;
      }
      if (event.error === 'not-allowed') {
        this.callbacks.onError?.(t('app.stt.micDenied'));
        return;
      }
      console.error('❌ STTエラー:', event.error);
      this.callbacks.onError?.(event.error);
    };

    this.recognition.onspeechend = () => {
      this.stop();
    };
  }

  // ====== 共通 ======

  setConfig(config: Partial<STTConfig>) {
    this.config = { ...this.config, ...config };
    if (this.recognition) {
      this.recognition.lang = this.config.lang;
    }
  }

  setCallbacks(callbacks: STTCallbacks) {
    this.callbacks = callbacks;
  }

  async requestPermission(): Promise<boolean> {
    if (this.permissionGranted) return true;
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      stream.getTracks().forEach(track => track.stop());
      this.permissionGranted = true;
      console.log('✅ STT: マイク許可取得');
      return true;
    } catch (err) {
      console.error('❌ STT: マイク許可拒否:', err);
      this.callbacks.onError?.(t('app.stt.micDenied'));
      return false;
    }
  }

  async start(): Promise<boolean> {
    if (!this.config.enabled) return false;

    if (this.config.engine === 'web-speech') {
      return this.startWebSpeech();
    } else {
      // whisper / whisper-local 共通（MediaRecorder）
      return this.startWhisper();
    }
  }

  stop() {
    if (this.config.engine === 'web-speech') {
      this.stopWebSpeech();
    } else {
      this.stopWhisper();
    }
  }

  abort() {
    if (this.config.engine === 'web-speech') {
      if (this.recognition && this.isListening) {
        this.recognition.abort();
      }
    } else {
      this.abortWhisper();
    }
  }

  async toggle(): Promise<boolean> {
    if (this.isListening) {
      this.stop();
      return false;
    } else {
      return await this.start();
    }
  }

  getIsListening(): boolean {
    return this.isListening;
  }

  getIsTranscribing(): boolean {
    return this.isTranscribing;
  }

  isSupported(): boolean {
    if (this.config.engine === 'web-speech') {
      return this.recognition !== null;
    }
    return typeof MediaRecorder !== 'undefined' && !!navigator.mediaDevices;
  }

  pause() {
    this.isPaused = true;
    this.stop();
  }

  resume() {
    this.isPaused = false;
    if (this.config.alwaysOn && this.config.enabled) {
      this.start();
    }
  }

  getIsAlwaysOn(): boolean {
    return this.config.alwaysOn;
  }

  // ====== Web Speech API ======

  private async startWebSpeech(): Promise<boolean> {
    if (!this.recognition) return false;
    if (this.isListening) return true;

    const hasPermission = await this.requestPermission();
    if (!hasPermission) return false;

    try {
      this.recognition.start();
      return true;
    } catch (err) {
      console.error('❌ STT開始失敗:', err);
      this.callbacks.onError?.(t('app.stt.startFailed'));
      return false;
    }
  }

  private stopWebSpeech() {
    if (this.recognition && this.isListening) {
      this.recognition.stop();
    }
  }

  // ====== Whisper / Whisper-Local (MediaRecorder共通) ======

  private async startWhisper(): Promise<boolean> {
    if (this.isListening || this.isTranscribing) return true;

    const hasPermission = await this.requestPermission();
    if (!hasPermission) return false;

    try {
      this.stream = await navigator.mediaDevices.getUserMedia({
        audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true }
      });
      this.audioChunks = [];

      this.mediaRecorder = new MediaRecorder(this.stream, {
        mimeType: this.getSupportedMimeType(),
        audioBitsPerSecond: 64000
      });

      this.mediaRecorder.ondataavailable = (event) => {
        if (event.data.size > 0) {
          this.audioChunks.push(event.data);
        }
      };

      this.mediaRecorder.onstop = () => {
        this.transcribeWhisper();
      };

      this.mediaRecorder.start(100);
      this.isListening = true;
      this.peakVolume = 0;
      this.callbacks.onStart?.();

      this.maxRecordTimer = window.setTimeout(() => {
        if (this.isListening) {
          console.log('⏱️ STT: 最大録音時間到達');
          this.stopWhisperRecording();
        }
      }, this.MAX_RECORD_DURATION);

      // 常にVADを有効にして音量を追跡（alwaysOn時は無音自動停止も行う）
      this.setupVAD();

      console.log('🎤 STT: 録音開始 (' + this.config.engine + ')');
      return true;
    } catch (err) {
      console.error('❌ STT開始失敗:', err);
      this.callbacks.onError?.(t('app.stt.startFailed'));
      return false;
    }
  }

  private stopWhisper() {
    if (this.isListening) {
      this.stopWhisperRecording();
    }
  }

  private abortWhisper() {
    this.cleanupVAD();
    if (this.maxRecordTimer) {
      clearTimeout(this.maxRecordTimer);
      this.maxRecordTimer = null;
    }
    if (this.mediaRecorder && this.mediaRecorder.state !== 'inactive') {
      this.mediaRecorder.onstop = null;
      this.mediaRecorder.stop();
    }
    if (this.stream) {
      this.stream.getTracks().forEach(track => track.stop());
      this.stream = null;
    }
    this.isListening = false;
    this.audioChunks = [];
    this.callbacks.onEnd?.();
  }

  private getSupportedMimeType(): string {
    const types = ['audio/webm;codecs=opus', 'audio/webm', 'audio/ogg;codecs=opus', 'audio/ogg'];
    for (const type of types) {
      if (MediaRecorder.isTypeSupported(type)) return type;
    }
    return 'audio/webm';
  }

  private setupVAD() {
    if (!this.stream) return;
    this.audioContext = new AudioContext();
    const source = this.audioContext.createMediaStreamSource(this.stream);
    this.analyser = this.audioContext.createAnalyser();
    this.analyser.fftSize = 512;
    source.connect(this.analyser);

    const dataArray = new Uint8Array(this.analyser.frequencyBinCount);
    this.silenceStart = null;
    this.hasVoice = false;

    this.vadInterval = window.setInterval(() => {
      if (!this.analyser || !this.isListening) return;
      this.analyser.getByteFrequencyData(dataArray);
      const volume = dataArray.reduce((sum, v) => sum + v, 0) / dataArray.length;

      if (volume > this.peakVolume) {
        this.peakVolume = volume;
      }

      if (volume > this.SILENCE_THRESHOLD) {
        this.hasVoice = true;
        this.silenceStart = null;
      } else if (this.hasVoice && this.config.alwaysOn) {
        // alwaysOnモードのみ無音自動停止
        if (!this.silenceStart) {
          this.silenceStart = Date.now();
        } else if (Date.now() - this.silenceStart > this.SILENCE_DURATION) {
          console.log('🔇 STT: 無音検出、録音停止');
          this.stopWhisperRecording();
        }
      }
    }, 100);
  }

  private cleanupVAD() {
    if (this.vadInterval) {
      clearInterval(this.vadInterval);
      this.vadInterval = null;
    }
    if (this.audioContext) {
      this.audioContext.close();
      this.audioContext = null;
    }
    this.analyser = null;
  }

  private stopWhisperRecording() {
    if (this.maxRecordTimer) {
      clearTimeout(this.maxRecordTimer);
      this.maxRecordTimer = null;
    }
    this.cleanupVAD();

    if (this.mediaRecorder && this.mediaRecorder.state !== 'inactive') {
      this.isListening = false;
      this.mediaRecorder.stop();
    } else {
      this.isListening = false;
    }

    if (this.stream) {
      this.stream.getTracks().forEach(track => track.stop());
      this.stream = null;
    }
  }

  private async transcribeWhisper() {
    // 録音停止を通知（processing状態への切り替え用）
    this.callbacks.onRecordingStop?.();

    if (this.audioChunks.length === 0) {
      console.log('🔇 STT: 音声データなし');
      this.callbacks.onEnd?.();
      this.restartIfAlwaysOn();
      return;
    }

    this.isTranscribing = true;

    try {
      const mimeType = this.getSupportedMimeType();
      const audioBlob = new Blob(this.audioChunks, { type: mimeType });
      this.audioChunks = [];

      if (audioBlob.size < 1000) {
        console.log('🔇 STT: 音声が短すぎます');
        this.isTranscribing = false;
        this.callbacks.onEnd?.();
        this.restartIfAlwaysOn();
        return;
      }

      // 録音中に十分な音量がなかった場合はスキップ（Whisperハルシネーション防止）
      if (this.peakVolume < this.SILENCE_THRESHOLD) {
        console.log(`🔇 STT: 音量不足（peak=${this.peakVolume.toFixed(1)}）、文字起こしスキップ`);
        this.isTranscribing = false;
        this.callbacks.onEnd?.();
        this.restartIfAlwaysOn();
        return;
      }

      const api = platform;
      let text = '';

      if (this.config.engine === 'whisper-local') {
        // ローカルWhisper: PCM Float32に変換してから送信
        const pcmData = await this.convertToFloat32PCM(audioBlob);
        if (!api?.sttTranscribeLocal) {
          throw new Error('ローカルWhisper APIが利用できません');
        }
        const lang = this.config.lang.split('-')[0] || 'ja';
        text = await api.sttTranscribeLocal(pcmData.buffer as ArrayBuffer, lang);
      } else {
        // Whisper API
        const arrayBuffer = await audioBlob.arrayBuffer();
        if (!api?.sttTranscribe) {
          throw new Error('Whisper APIが利用できません');
        }
        const lang = this.config.lang.split('-')[0] || 'ja';
        text = await api.sttTranscribe(arrayBuffer, lang, mimeType, this.config.whisperModel);
      }

      if (text && text.trim()) {
        const trimmed = text.trim();
        // Whisperハルシネーション判定
        if (this.isHallucination(trimmed)) {
          console.log(`🔇 STT: ハルシネーション除外: "${trimmed}"`);
        } else {
          console.log('🎤 STT結果:', trimmed);
          this.callbacks.onResult?.(trimmed, true);
        }
      } else {
        console.log('🔇 STT: 音声が検出されませんでした');
      }
    } catch (err: any) {
      console.error('❌ STT文字起こしエラー:', err);
      this.callbacks.onError?.(err.message || t('app.stt.transcribeFailed'));
    } finally {
      this.isTranscribing = false;
      this.callbacks.onEnd?.();
      this.restartIfAlwaysOn();
    }
  }

  // 音声をWhisper用 16kHz mono Float32 PCM に変換
  private async convertToFloat32PCM(audioBlob: Blob): Promise<Float32Array> {
    const arrayBuffer = await audioBlob.arrayBuffer();
    const tempCtx = new AudioContext();
    const audioBuffer = await tempCtx.decodeAudioData(arrayBuffer);
    tempCtx.close();

    const targetSampleRate = 16000;
    const numSamples = Math.ceil(audioBuffer.duration * targetSampleRate);
    const offlineCtx = new OfflineAudioContext(1, numSamples, targetSampleRate);
    const source = offlineCtx.createBufferSource();
    source.buffer = audioBuffer;
    source.connect(offlineCtx.destination);
    source.start();
    const resampled = await offlineCtx.startRendering();
    return resampled.getChannelData(0);
  }

  private isHallucination(text: string): boolean {
    // 短すぎるテキスト（1文字以下）
    if (text.length <= 1) return true;
    // 既知のハルシネーションパターン
    return STTService.HALLUCINATION_PATTERNS.some(
      pattern => text.includes(pattern)
    );
  }

  private restartIfAlwaysOn() {
    if (this.config.alwaysOn && this.config.enabled && !this.isPaused) {
      setTimeout(() => {
        if (!this.isPaused && !this.isListening && !this.isTranscribing) {
          this.start();
        }
      }, 500);
    }
  }
}

export const sttService = new STTService();
