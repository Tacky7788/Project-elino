// Lip Sync Service - Simple (sin wave) + Amplitude-based + Phoneme-based

import type { PhonemeEvent } from './types';

export type LipSyncMode = 'simple' | 'amplitude' | 'phoneme';

export interface LipSyncConfig {
  enabled: boolean;
  mode: LipSyncMode;
  // Simple mode settings
  frequency: number;    // Hz (default: 8)
  amplitude: number;    // 0-1 (default: 0.8)
  // Amplitude mode settings
  smoothingAttack: number;  // 0-1 (default: 0.3)
  smoothingRelease: number; // 0-1 (default: 0.1)
}

type MouthControlFn = (openY: number, form?: number) => void;

// 日本語文字→母音マッピング（Web Speech用推定）
const HIRAGANA_TO_VOWEL: Record<string, string> = {};
const KATAKANA_TO_VOWEL: Record<string, string> = {};

// あ行
const vowelRows: [string, string, string][] = [
  // [ひらがな列, カタカナ列, 母音]
  ['あいうえお', 'アイウエオ', 'aiueo'],
  ['かきくけこ', 'カキクケコ', 'aiueo'],
  ['さしすせそ', 'サシスセソ', 'aiueo'],
  ['たちつてと', 'タチツテト', 'aiueo'],
  ['なにぬねの', 'ナニヌネノ', 'aiueo'],
  ['はひふへほ', 'ハヒフヘホ', 'aiueo'],
  ['まみむめも', 'マミムメモ', 'aiueo'],
  ['やゆよ', 'ヤユヨ', 'auo'],
  ['らりるれろ', 'ラリルレロ', 'aiueo'],
  ['わをん', 'ワヲン', 'aoN'],
  ['がぎぐげご', 'ガギグゲゴ', 'aiueo'],
  ['ざじずぜぞ', 'ザジズゼゾ', 'aiueo'],
  ['だぢづでど', 'ダヂヅデド', 'aiueo'],
  ['ばびぶべぼ', 'バビブベボ', 'aiueo'],
  ['ぱぴぷぺぽ', 'パピプペポ', 'aiueo'],
];

for (const [hira, kata, vowels] of vowelRows) {
  for (let i = 0; i < hira.length; i++) {
    HIRAGANA_TO_VOWEL[hira[i]] = vowels[i];
    KATAKANA_TO_VOWEL[kata[i]] = vowels[i];
  }
}

// 母音→口形状マッピング
function vowelToShape(vowel: string): { openY: number; form: number } {
  switch (vowel) {
    case 'a': return { openY: 1.0, form: 0.0 };
    case 'i': return { openY: 0.4, form: 0.7 };
    case 'u': return { openY: 0.3, form: -0.5 };
    case 'e': return { openY: 0.6, form: 0.4 };
    case 'o': return { openY: 0.7, form: -0.3 };
    case 'N': return { openY: 0.1, form: 0.0 };
    default:  return { openY: 0.0, form: 0.0 };
  }
}

class LipSyncService {
  private mouthControl: MouthControlFn | null = null;
  private animationFrame: number | null = null;
  private isTalking = false;
  private startTime = 0;
  private config: LipSyncConfig = {
    enabled: true,
    mode: 'phoneme',
    frequency: 8,
    amplitude: 0.8,
    smoothingAttack: 0.3,
    smoothingRelease: 0.1
  };

  // Amplitude mode resources
  private audioContext: AudioContext | null = null;
  private analyser: AnalyserNode | null = null;
  private sourceNode: MediaElementAudioSourceNode | null = null;
  private dataArray: Uint8Array<ArrayBuffer> | null = null;
  private lastAmplitude = 0;
  private usingAmplitude = false; // amplitude解析が接続されているか
  // 一度 createMediaElementSource で接続した Audio → SourceNode のキャッシュ
  // Web Audio API は同じ Audio に対して createMediaElementSource を2回呼べない
  private sourceNodeCache = new WeakMap<HTMLAudioElement, MediaElementAudioSourceNode>();

  // Phoneme mode resources
  private phonemeTimeline: PhonemeEvent[] = [];
  private phonemeAudio: HTMLAudioElement | null = null;
  private currentOpenY = 0;
  private currentForm = 0;

  setConfig(config: Partial<LipSyncConfig>) {
    this.config = { ...this.config, ...config };
  }

  registerMouthControl(fn: MouthControlFn) {
    this.mouthControl = fn;
    console.log('✅ LipSync: 口制御関数を登録');
  }

  startTalking() {
    if (!this.config.enabled || !this.mouthControl || this.isTalking) return;

    this.isTalking = true;
    this.startTime = performance.now();
    this.lastAmplitude = 0;
    this.usingAmplitude = false;

    if (this.config.mode === 'simple') {
      // simpleモードのみsin波アニメーション
      // amplitude/phonemeモードはconnectAudioElement()で振幅解析に切り替わる
      this.animateSimple();
    }
    // amplitude/phoneme: connectAudioElement() が呼ばれるまで待機
  }

  stopTalking() {
    this.isTalking = false;
    this.usingAmplitude = false;

    if (this.animationFrame) {
      cancelAnimationFrame(this.animationFrame);
      this.animationFrame = null;
    }

    // 口を閉じる
    if (this.mouthControl) {
      this.mouthControl(0, 0);
    }

    this.phonemeAudio = null;
    this.currentOpenY = 0;
    this.currentForm = 0;
    this.disconnectAudio();
  }

  private animateSimple() {
    if (!this.isTalking || !this.mouthControl) return;

    const elapsed = (performance.now() - this.startTime) / 1000;
    const { frequency, amplitude } = this.config;

    // Sin wave with noise for natural movement
    const sinValue = Math.sin(elapsed * frequency * Math.PI * 2);
    const noise = (Math.random() - 0.5) * 0.2;
    const mouthOpen = Math.max(0, Math.min(1, (sinValue + 1) / 2 * amplitude + noise));

    this.mouthControl(mouthOpen);

    this.animationFrame = requestAnimationFrame(() => this.animateSimple());
  }

  // Amplitude-based lip sync — モードに関係なく音声要素が利用可能なら振幅解析を使用
  connectAudioElement(audio: HTMLAudioElement) {
    if (!this.config.enabled) {
      return;
    }

    try {
      // 既存のsin波アニメーションを停止（amplitude解析に切り替え）
      if (this.animationFrame) {
        cancelAnimationFrame(this.animationFrame);
        this.animationFrame = null;
      }

      // 前回の接続をクリーンアップ
      this.disconnectAudio();

      // Create AudioContext if needed
      if (!this.audioContext) {
        this.audioContext = new AudioContext();
      }

      // Resume if suspended
      if (this.audioContext.state === 'suspended') {
        this.audioContext.resume();
      }

      // Create analyser
      this.analyser = this.audioContext.createAnalyser();
      this.analyser.fftSize = 256;
      this.analyser.smoothingTimeConstant = 0.3;

      // Connect audio element to analyser
      // Web Audio API: 同じ Audio に createMediaElementSource を2回呼ぶとエラーになるのでキャッシュ
      let source = this.sourceNodeCache.get(audio);
      if (!source) {
        source = this.audioContext.createMediaElementSource(audio);
        this.sourceNodeCache.set(audio, source);
      }
      this.sourceNode = source;
      this.sourceNode.connect(this.analyser);
      this.analyser.connect(this.audioContext.destination);

      // Create data array for frequency data
      this.dataArray = new Uint8Array(this.analyser.frequencyBinCount);

      this.usingAmplitude = true;

      // Start amplitude animation
      this.animateAmplitude();

      console.log('✅ LipSync: 音声接続完了（振幅解析モード）');
    } catch (err) {
      console.warn('⚠️ LipSync: 音声接続失敗、シンプルモードにフォールバック', err);
      this.usingAmplitude = false;
      this.animateSimple();
    }
  }

  private animateAmplitude() {
    if (!this.isTalking || !this.mouthControl || !this.analyser || !this.dataArray) return;

    // Get frequency data
    this.analyser.getByteFrequencyData(this.dataArray);

    // Calculate RMS amplitude (focus on lower frequencies for speech)
    let sum = 0;
    const voiceRange = Math.floor(this.dataArray.length * 0.5); // Lower half for voice
    for (let i = 0; i < voiceRange; i++) {
      sum += this.dataArray[i] * this.dataArray[i];
    }
    const rms = Math.sqrt(sum / voiceRange) / 255;

    // ノイズゲート: 閾値以下は無音として扱う（無音時にパクパクしない）
    const gatedRms = rms < 0.05 ? 0 : rms;

    // スムージング: 開口は適度に速く、閉口はより速く（無音→即閉じ）
    const smoothing = gatedRms > this.lastAmplitude ? 0.4 : 0.5;
    const smoothedAmplitude = this.lastAmplitude + (gatedRms - this.lastAmplitude) * smoothing;
    this.lastAmplitude = smoothedAmplitude;

    // Scale to mouth open range (0-1)、ゲインを控えめに
    const mouthOpen = Math.min(1, smoothedAmplitude * 2.0);
    this.mouthControl(mouthOpen < 0.02 ? 0 : mouthOpen);

    this.animationFrame = requestAnimationFrame(() => this.animateAmplitude());
  }

  // ===== Phoneme mode =====

  setPhonemeTimeline(timeline: PhonemeEvent[]) {
    this.phonemeTimeline = timeline;
  }

  // VOICEVOX用: HTMLAudioElement の currentTime に同期
  startPhonemeSync(audio: HTMLAudioElement, timeline: PhonemeEvent[]) {
    if (!this.config.enabled || !this.mouthControl) return;

    this.phonemeTimeline = timeline;
    this.phonemeAudio = audio;
    this.isTalking = true;
    this.currentOpenY = 0;
    this.currentForm = 0;

    this.animatePhonemeWithAudio();
    console.log(`✅ LipSync: 音素同期開始（${timeline.length}音素）`);
  }

  private animatePhonemeWithAudio() {
    if (!this.isTalking || !this.mouthControl || !this.phonemeAudio) return;

    const currentTime = this.phonemeAudio.currentTime;
    this.updatePhonemeAtTime(currentTime);

    this.animationFrame = requestAnimationFrame(() => this.animatePhonemeWithAudio());
  }

  // Web Speech用: performance.now() ベースのタイマーで同期
  startWebSpeechPhonemeSync(timeline: PhonemeEvent[]) {
    if (!this.config.enabled || !this.mouthControl) return;

    this.phonemeTimeline = timeline;
    this.phonemeAudio = null;
    this.isTalking = true;
    this.startTime = performance.now();
    this.currentOpenY = 0;
    this.currentForm = 0;

    this.animatePhonemeWithTimer();
    console.log(`✅ LipSync: Web Speech音素同期開始（${timeline.length}音素）`);
  }

  private animatePhonemeWithTimer() {
    if (!this.isTalking || !this.mouthControl) return;

    const currentTime = (performance.now() - this.startTime) / 1000;
    this.updatePhonemeAtTime(currentTime);

    this.animationFrame = requestAnimationFrame(() => this.animatePhonemeWithTimer());
  }

  private updatePhonemeAtTime(currentTime: number) {
    if (!this.mouthControl) return;

    // 現在の時刻に対応する音素を探す
    let targetOpenY = 0;
    let targetForm = 0;

    for (const phoneme of this.phonemeTimeline) {
      if (currentTime >= phoneme.time && currentTime < phoneme.time + phoneme.duration) {
        targetOpenY = phoneme.mouthOpenY;
        targetForm = phoneme.mouthForm;
        break;
      }
    }

    // スムーズ補間（急な変化を防ぐ）
    const smoothing = 0.3;
    this.currentOpenY += (targetOpenY - this.currentOpenY) * smoothing;
    this.currentForm += (targetForm - this.currentForm) * smoothing;

    this.mouthControl(this.currentOpenY, this.currentForm);
  }

  // 日本語テキストから母音タイムライン推定（Web Speech用）
  estimatePhonemeTimeline(text: string, rate: number = 1.0): PhonemeEvent[] {
    const timeline: PhonemeEvent[] = [];
    // 1文字あたりの推定時間（秒）
    const charDuration = 0.12 / rate;
    // 子音部分の推定時間
    const consonantDuration = 0.04 / rate;
    let currentTime = 0;

    for (const char of text) {
      // ひらがな→母音
      let vowel = HIRAGANA_TO_VOWEL[char] || KATAKANA_TO_VOWEL[char];

      if (vowel) {
        // 子音部分（閉口）
        if (!['あ', 'い', 'う', 'え', 'お', 'ア', 'イ', 'ウ', 'エ', 'オ'].includes(char)) {
          currentTime += consonantDuration;
        }

        const shape = vowelToShape(vowel);
        timeline.push({
          time: currentTime,
          duration: charDuration - consonantDuration,
          vowel,
          mouthOpenY: shape.openY,
          mouthForm: shape.form,
        });
        currentTime += charDuration - consonantDuration;
      } else if (char === 'ー' || char === '〜') {
        // 長音: 前の母音を延長
        if (timeline.length > 0) {
          const last = timeline[timeline.length - 1];
          timeline.push({
            time: currentTime,
            duration: charDuration,
            vowel: last.vowel,
            mouthOpenY: last.mouthOpenY,
            mouthForm: last.mouthForm,
          });
        }
        currentTime += charDuration;
      } else if (char === 'っ' || char === 'ッ') {
        // 促音: 短いポーズ
        timeline.push({
          time: currentTime,
          duration: charDuration * 0.8,
          vowel: 'pau',
          mouthOpenY: 0,
          mouthForm: 0,
        });
        currentTime += charDuration * 0.8;
      } else if (/[、。！？,.!?]/.test(char)) {
        // 句読点: ポーズ
        timeline.push({
          time: currentTime,
          duration: charDuration * 2,
          vowel: 'pau',
          mouthOpenY: 0,
          mouthForm: 0,
        });
        currentTime += charDuration * 2;
      } else if (/[\u4e00-\u9fff]/.test(char)) {
        // 漢字: 母音「a」として推定（不明なので）
        const shape = vowelToShape('a');
        timeline.push({
          time: currentTime,
          duration: charDuration,
          vowel: 'a',
          mouthOpenY: shape.openY,
          mouthForm: shape.form,
        });
        currentTime += charDuration;
      } else if (/[a-zA-Z]/.test(char)) {
        // アルファベット: 母音推定
        const lc = char.toLowerCase();
        const alphaVowel = 'aeiou'.includes(lc) ? lc : 'a';
        const shape = vowelToShape(alphaVowel);
        timeline.push({
          time: currentTime,
          duration: charDuration,
          vowel: alphaVowel,
          mouthOpenY: shape.openY,
          mouthForm: shape.form,
        });
        currentTime += charDuration;
      } else {
        // その他の文字: 短いポーズ
        currentTime += charDuration * 0.5;
      }
    }

    return timeline;
  }

  disconnectAudio() {
    if (this.sourceNode) {
      try {
        this.sourceNode.disconnect();
      } catch (e) {
        // Already disconnected
      }
      this.sourceNode = null;
    }

    if (this.analyser) {
      try {
        this.analyser.disconnect();
      } catch (e) {
        // Already disconnected
      }
      this.analyser = null;
    }

    this.dataArray = null;
    this.lastAmplitude = 0;
  }

  isActive(): boolean {
    return this.isTalking;
  }
}

export const lipSyncService = new LipSyncService();
