// Lip Sync Service - amplitude + phoneme ハイブリッド
// アニメーションループは animateAmplitude() に一本化
// phonemeデータがあれば: mouthForm=phoneme, mouthOpenY=phoneme×amplitude
// phonemeデータがなければ: amplitude単体でmouthOpenY

import type { PhonemeEvent } from './types';

export type LipSyncMode = 'simple' | 'amplitude' | 'phoneme';

export interface LipSyncConfig {
  enabled: boolean;
  mode: LipSyncMode;
  // Simple mode settings
  frequency: number;    // Hz (default: 8)
  amplitude: number;    // 0-1 (default: 0.8)
  // Amplitude mode settings
  smoothingAttack: number;  // 0-1 (口を開く速度)
  smoothingRelease: number; // 0-1 (口を閉じる速度)
  disableMouthForm?: boolean; // ParamMouthForm無効化（一部モデルで眉毛連動を防ぐ）
}

type MouthControlFn = (openY: number, form?: number) => void;

// 日本語文字→母音マッピング（Web Speech用推定）
const HIRAGANA_TO_VOWEL: Record<string, string> = {};
const KATAKANA_TO_VOWEL: Record<string, string> = {};

const vowelRows: [string, string, string][] = [
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
    smoothingAttack: 0.7,
    smoothingRelease: 0.2
  };

  // Audio解析リソース
  private audioContext: AudioContext | null = null;
  private analyser: AnalyserNode | null = null;
  private sourceNode: MediaElementAudioSourceNode | null = null;
  private dataArray: Float32Array | null = null;
  private lastAmplitude = 0;
  private longTermRms = 0; // 長期平均RMS（ベースライン）
  // Web Audio API は同じ Audio に対して createMediaElementSource を2回呼べない
  private sourceNodeCache = new WeakMap<HTMLAudioElement, MediaElementAudioSourceNode>();

  // Phoneme リソース
  private phonemeTimeline: PhonemeEvent[] = [];
  private phonemeAudio: HTMLAudioElement | null = null;
  private currentOpenY = 0;
  private currentForm = 0;
  private _debugCounter = 0;

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
    this.hasReceivedAudio = false;

    if (this.config.mode === 'simple') {
      this.animateSimple();
    }
    // amplitude/phoneme: connectAudioElement() が呼ばれるまで待機
  }

  stopTalking() {
    this.isTalking = false;

    if (this.animationFrame) {
      clearTimeout(this.animationFrame);
      this.animationFrame = null;
    }

    if (this.mouthControl) {
      this.mouthControl(0, 0);
    }

    this.phonemeTimeline = [];
    this.phonemeAudio = null;
    this.currentOpenY = 0;
    this.currentForm = 0;
    this.disconnectAudio();
  }

  private animateSimple() {
    if (!this.isTalking || !this.mouthControl) return;

    const elapsed = (performance.now() - this.startTime) / 1000;
    const { frequency, amplitude } = this.config;

    const sinValue = Math.sin(elapsed * frequency * Math.PI * 2);
    const noise = (Math.random() - 0.5) * 0.2;
    const mouthOpen = Math.max(0, Math.min(1, (sinValue + 1) / 2 * amplitude + noise));

    this.mouthControl(mouthOpen);
    this.animationFrame = requestAnimationFrame(() => this.animateSimple());
  }

  // --- 音声接続 ---
  connectAudioElement(audio: HTMLAudioElement) {
    if (!this.config.enabled) return;

    try {
      if (!this.audioContext) {
        this.audioContext = new AudioContext();
      }
      if (this.audioContext.state === 'suspended') {
        this.audioContext.resume();
      }

      if (!this.analyser) {
        this.analyser = this.audioContext.createAnalyser();
        this.analyser.fftSize = 1024; // 音節レベルの応答性と滑らかさのバランス
        this.analyser.smoothingTimeConstant = 0;
        this.analyser.connect(this.audioContext.destination);
        this.dataArray = new Float32Array(1024);
      }

      // 前のsourceNodeだけ切断
      if (this.sourceNode) {
        try { this.sourceNode.disconnect(); } catch (_) { /* already disconnected */ }
        this.sourceNode = null;
      }

      let source = this.sourceNodeCache.get(audio);
      if (!source) {
        source = this.audioContext.createMediaElementSource(audio);
        this.sourceNodeCache.set(audio, source);
      }
      this.sourceNode = source;
      this.sourceNode.connect(this.analyser);

      // アニメーションループが走ってなければ開始
      if (!this.animationFrame) {
        this.animateAmplitude();
      }

      console.log('✅ LipSync: 音声接続完了');
    } catch (err) {
      console.warn('⚠️ LipSync: 音声接続失敗、シンプルモードにフォールバック', err);
      if (!this.animationFrame) this.animateSimple();
    }
  }

  // === 統合アニメーションループ ===
  // phonemeデータあり → ハイブリッド（phoneme形状 × amplitude強度）
  // phonemeデータなし → amplitude単体
  private animateAmplitude() {
    if (!this.isTalking || !this.mouthControl || !this.analyser || !this.dataArray) return;

    // --- 時間ドメイン波形からRMS ---
    this.analyser.getFloatTimeDomainData(this.dataArray);
    let sum = 0;
    const len = this.dataArray.length;
    for (let i = 0; i < len; i++) {
      sum += this.dataArray[i] * this.dataArray[i];
    }
    const rms = Math.sqrt(sum / len);

    // --- baseline追従 ---
    // 無音時は速くリセット、発話中はゆっくり追従（追いつきすぎ防止）
    const baselineRate = rms < 0.01 ? 0.15 : 0.005;
    this.longTermRms += (rms - this.longTermRms) * baselineRate;

    // --- amplitude target（baseline偏差ベース）---
    const deviation = Math.max(0, rms - this.longTermRms * 0.8);
    const scale = this.longTermRms > 0.005 ? deviation / this.longTermRms : 0;
    const ampTarget = rms < 0.005 ? 0 : Math.min(1.0, Math.pow(scale * 1.5, 0.5));

    // --- attack/release smoothing（共通）---
    const attackRate = this.config.smoothingAttack;
    const releaseRate = this.config.smoothingRelease;
    const rate = ampTarget > this.lastAmplitude ? attackRate : releaseRate;
    this.lastAmplitude += (ampTarget - this.lastAmplitude) * rate;

    // 無音時はreleaseに任せて自然に閉じる（即ゼロにしない）

    const smoothedAmp = this.lastAmplitude < 0.04 ? 0 : this.lastAmplitude;

    // --- 出力計算 ---
    let mouthOpen: number;
    let mouthForm = 0;

    if (this.phonemeTimeline.length > 0 && this.phonemeAudio) {
      // === ハイブリッド: phoneme主導 + amplitude補正 ===
      const currentTime = this.phonemeAudio.currentTime;
      let phonemeOpenY = 0;
      let phonemeForm = 0;

      for (const phoneme of this.phonemeTimeline) {
        if (currentTime >= phoneme.time && currentTime < phoneme.time + phoneme.duration) {
          phonemeOpenY = phoneme.mouthOpenY;
          phonemeForm = phoneme.mouthForm;
          break;
        }
      }

      // phoneme形状をスムーズ補間（速め — 短い音素にも追従）
      this.currentOpenY += (phonemeOpenY - this.currentOpenY) * 0.6;
      this.currentForm += (phonemeForm - this.currentForm) * 0.5;

      // phoneme形状が取れてる → ハイブリッド、取れてない → amplitude直接
      if (this.currentOpenY > 0.05) {
        mouthOpen = this.currentOpenY * (0.5 + smoothedAmp * 0.5);
        mouthForm = this.currentForm;
      } else {
        // phonemeが無音/未ヒット → amplitudeで直接駆動（口は動かす）
        mouthOpen = smoothedAmp;
        mouthForm = this.currentForm;
      }

    } else {
      // === amplitude単体 ===
      mouthOpen = smoothedAmp;
    }

    // デバッグ用（必要時にコメント解除）
    // const mode = (this.phonemeTimeline.length > 0 && this.phonemeAudio) ? (this.currentOpenY > 0.05 ? 'HYB' : 'AMP*') : 'AMP';
    // console.log(`👄 open=${mouthOpen.toFixed(3)} form=${mouthForm.toFixed(2)} rms=${rms.toFixed(4)} amp=${smoothedAmp.toFixed(3)} tgt=${ampTarget.toFixed(3)} bl=${this.longTermRms.toFixed(4)} phY=${this.currentOpenY.toFixed(3)} [${mode}]`);

    this.mouthControl(mouthOpen, this.config.disableMouthForm ? 0 : mouthForm);
    this.animationFrame = setTimeout(() => this.animateAmplitude(), 30) as unknown as number;
  }

  // --- Phonemeデータ管理 ---

  setPhonemeTimeline(timeline: PhonemeEvent[]) {
    this.phonemeTimeline = timeline;
  }

  // phonemeデータと対応audioをセット → animateAmplitude内でハイブリッド合成される
  setPhonemeData(audio: HTMLAudioElement, timeline: PhonemeEvent[]) {
    this.phonemeTimeline = timeline;
    this.phonemeAudio = audio;
    this.currentOpenY = 0;
    this.currentForm = 0;
  }

  // startPhonemeSync: setPhonemeData + connectAudioElement の薄いラッパー
  // 後方互換用。新規コードは setPhonemeData() + connectAudioElement() を直接使うこと
  startPhonemeSync(audio: HTMLAudioElement, timeline: PhonemeEvent[]) {
    if (!this.config.enabled || !this.mouthControl) return;
    this.isTalking = true;
    this.setPhonemeData(audio, timeline);
    this.connectAudioElement(audio);
    console.log(`✅ LipSync: 音素同期開始（${timeline.length}音素）`);
  }

  clearPhonemeData() {
    this.phonemeTimeline = [];
    this.phonemeAudio = null;
  }

  // Web Speech用: performance.now() ベースのタイマーで音素推定同期
  startWebSpeechPhonemeSync(timeline: PhonemeEvent[]) {
    if (!this.config.enabled || !this.mouthControl) return;

    this.phonemeTimeline = timeline;
    this.phonemeAudio = null;
    this.isTalking = true;
    this.startTime = performance.now();
    this.currentOpenY = 0;
    this.currentForm = 0;

    this.animateWebSpeechPhoneme();
    console.log(`✅ LipSync: Web Speech音素同期開始（${timeline.length}音素）`);
  }

  private animateWebSpeechPhoneme() {
    if (!this.isTalking || !this.mouthControl) return;

    const currentTime = (performance.now() - this.startTime) / 1000;
    let targetOpenY = 0;
    let targetForm = 0;

    for (const phoneme of this.phonemeTimeline) {
      if (currentTime >= phoneme.time && currentTime < phoneme.time + phoneme.duration) {
        targetOpenY = phoneme.mouthOpenY;
        targetForm = phoneme.mouthForm;
        break;
      }
    }

    this.currentOpenY += (targetOpenY - this.currentOpenY) * 0.3;
    this.currentForm += (targetForm - this.currentForm) * 0.3;
    this.mouthControl(this.currentOpenY, this.currentForm);

    this.animationFrame = requestAnimationFrame(() => this.animateWebSpeechPhoneme());
  }

  // 日本語テキストから母音タイムライン推定（Web Speech用）
  estimatePhonemeTimeline(text: string, rate: number = 1.0): PhonemeEvent[] {
    const timeline: PhonemeEvent[] = [];
    const charDuration = 0.12 / rate;
    const consonantDuration = 0.04 / rate;
    let currentTime = 0;

    for (const char of text) {
      let vowel = HIRAGANA_TO_VOWEL[char] || KATAKANA_TO_VOWEL[char];

      if (vowel) {
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
        timeline.push({
          time: currentTime,
          duration: charDuration * 0.8,
          vowel: 'pau',
          mouthOpenY: 0,
          mouthForm: 0,
        });
        currentTime += charDuration * 0.8;
      } else if (/[、。！？,.!?]/.test(char)) {
        timeline.push({
          time: currentTime,
          duration: charDuration * 2,
          vowel: 'pau',
          mouthOpenY: 0,
          mouthForm: 0,
        });
        currentTime += charDuration * 2;
      } else if (/[\u4e00-\u9fff]/.test(char)) {
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
        currentTime += charDuration * 0.5;
      }
    }

    return timeline;
  }

  disconnectAudio() {
    if (this.sourceNode) {
      try { this.sourceNode.disconnect(); } catch (_) { /* already disconnected */ }
      this.sourceNode = null;
    }
    this.lastAmplitude = 0;
  }

  isActive(): boolean {
    return this.isTalking;
  }
}

export const lipSyncService = new LipSyncService();
