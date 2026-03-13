// Live2Dレンダラー: PIXIjs + pixi-live2d-display
import * as PIXI from 'pixi.js';
import type { CharacterSettings, CharacterRenderer } from './types';
import { MotionPlayer, type ParsedMotion } from './motion-player';
import { platform } from './platform';

// PIXIをグローバルに設定（pixi-live2d-displayが参照）
// @ts-ignore
window.PIXI = PIXI;

import { Live2DModel } from "@pld/cubism4";

// スクリプト動的ロード用ヘルパー
function loadScript(src: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const script = document.createElement('script');
    script.src = src;
    script.onload = () => resolve();
    script.onerror = () => reject(new Error(`Failed to load script: ${src}`));
    document.head.appendChild(script);
  });
}

export class Live2DRenderer implements CharacterRenderer {
  private app: PIXI.Application | null = null;
  private model: any = null;
  private canvas: HTMLCanvasElement | null = null;
  private settings: CharacterSettings | null = null;

  // リップシンク用の口パラメータ（毎フレーム適用）
  private currentMouthOpenY = 0;
  private currentMouthForm = 1; // デフォルトで笑顔にする

  // 口パクスムージング（#5）
  private mouthOpenSmoothed = 0;
  private mouthFormSmoothed = 1.0;

  // モーションアニメーション用
  private motionAnimFrame: number | null = null;
  private motionOverrides: Record<string, number> = {};

  // まばたき用（#1: 'closed' ステート追加）
  private blinkState: 'open' | 'closing' | 'closed' | 'opening' = 'open';
  private blinkTimer = 0;
  private nextBlinkDelay = 2.5;
  private baseEyeOpenL = 1.0;
  private baseEyeOpenR = 1.0;
  private currentBlinkValue = 1.0;  // internalModel.update内で参照
  private blinkCloseHold = 0;       // 閉じた状態でのホールド時間
  private isDoubleBlink = false;    // ダブルまばたきフラグ
  private doubleBlinkPending = false;

  // サッカード（視線の素早い移動）
  private saccadeX = 0;
  private saccadeY = 0;
  private saccadeTimer = 0;
  private saccadeInterval = 3.0;  // 次の視線移動まで
  private saccadeEaseTimer = 0;
  private saccadeEaseDuration = 0.12;

  // うなずき
  private nodTimer = 0;
  private nodInterval = 8.0;
  private nodPhase = 0;  // 0=待機, 1=うなずき中

  // アイドル・状態管理用
  private elapsedTime = 0;
  private currentExpression: string | null = null;
  private tickerCallback: ((deltaTime: number) => void) | null = null;

  // モーション状態レイヤー
  private motionLayerState: 'idle' | 'talk' | 'listen' | 'thinking' | 'sad' = 'idle';
  private talkIntensity = 0.7;
  private layer0Overrides: Record<string, number> = {};
  private layer1Overrides: Record<string, number> = {};

  // 警告フラグ
  private mouthWarnShown = false;

  // #2: 擬似Perlinノイズ用ジッターシード
  private jitterSeed = Math.random() * 1000;

  // マイクロムーブメント用タイマー（elapsedTime と独立）
  private microTime = 0;

  // #3: 首かしげアニメーション
  private headTiltTimer = 0;
  private headTiltInterval = 5.0 + Math.random() * 5.0;
  private headTiltPhase = 0; // 0=待機, 1=傾き中, 2=戻り中
  private headTiltTarget = 0;
  private headTiltCurrent = 0;

  // #4: 感情リアクションモーション
  private reactionTimer = 0;
  private reactionDuration = 0;
  private reactionExpression: string | null = null;
  private reactionIntensity = 0;

  // motion3.json プレイヤー
  private motionPlayer = new MotionPlayer();
  private expressionMotions = new Map<string, ParsedMotion>(); // 表情名 → モーション
  private stateMotions = new Map<string, ParsedMotion>();      // 状態名 → モーション
  private useMotionFiles = false; // モーションファイル読み込み成功フラグ

  // 感情マッピング（設定から受け取り）
  private emotionMap: Record<string, { motion: string; label: string; tags: string[] }> = {};
  private tagToEmotion: Record<string, string> = {}; // 逆引きマップ

  // パラメータ動的化（model3.json Groups から取得）
  private blinkParamIds: string[] = ['ParamEyeLOpen', 'ParamEyeROpen'];
  private lipSyncParamIds: string[] = ['ParamMouthOpenY'];

  // model3.json 内蔵モーション
  private builtinMotionGroups: string[] = [];
  private usingBuiltinIdle = false;
  private motionManagerRestored = false;

  // motionManager 退避（内蔵モーション復元用）
  private _savedMmUpdate: any = null;
  private _savedMmDefinitions: any = null;
  private _savedMmMotionGroups: any = null;

  // パラメータインデックスキャッシュ（毎フレームの文字列検索を回避）
  private paramCache: { [key: string]: number } = {};

  // プロシージャルアニメーション有効フラグ（false = リップシンクのみ）
  private proceduralEnabled = false;

  // 物理演算制御
  private physicsEnabled = true;
  private _savedPhysics: any = null; // OFF時に退避するphysicsオブジェクト


  async init(canvas: HTMLCanvasElement, settings: CharacterSettings): Promise<void> {
    this.canvas = canvas;
    this.settings = settings;
    this.updateEmotionMap(settings.emotionMap || {});
    this.physicsEnabled = settings.physicsEnabled !== false;
    const { window: winSettings, model: modelSettings } = settings;

    // リソースパス取得（本番時のみ）
    const resourcePath = await platform.getResourcePath();

    // Cubism Core を動的にロード（本番時）
    if (typeof (window as any).Live2DCubismCore === 'undefined') {
      if (resourcePath) {
        const libPath = resourcePath.replace(/[/\\]live2d$/, '/lib');
        const scriptSrc = `file:///${libPath.replace(/\\/g, '/')}/live2dcubismcore.min.js`;
        console.log('📦 Cubism Core を動的ロード:', scriptSrc);
        await loadScript(scriptSrc);
      } else {
        console.error('❌ Cubism Core が読み込まれていません（開発モード）');
        throw new Error('Cubism Core not loaded');
      }
    }
    console.log('✅ Cubism Core 読み込み完了');

    // PIXIアプリケーション作成
    this.app = new PIXI.Application({
      view: canvas,
      width: winSettings.width,
      height: winSettings.height,
      backgroundAlpha: 0,
      autoDensity: true,
      resolution: settings.resolution || 2,
      preserveDrawingBuffer: true,
    } as any);


    // Live2Dモデル読み込み
    let modelPath = modelSettings.path;
    if (resourcePath && modelSettings.path.startsWith('/live2d/')) {
      const relativePath = modelSettings.path.replace('/live2d/', '');
      modelPath = `file:///${resourcePath.replace(/\\/g, '/')}/${relativePath}`;
    }
    console.log('📦 モデル読み込み中:', modelPath);
    this.model = await Live2DModel.from(modelPath, {
      autoInteract: false
    });

    // PIXI v7 + pixi-live2d-display 互換性パッチ: isInteractive未実装エラー回避
    if (this.model && !(this.model as any).isInteractive) {
      (this.model as any).isInteractive = () => false;
    }
    (this.model as any).eventMode = 'none';
    (this.model as any).interactive = false;
    (this.model as any).interactiveChildren = false;

    // FPS制限
    this.app.ticker.maxFPS = settings.fps || 30;

    // モデルをステージに追加
    this.app.stage.addChild(this.model as any);

    // スケール・位置設定（設定値を適用）
    this.applyAutoFit(this.app.screen.width, this.app.screen.height, false);

    // リップシンク・アニメーション制御を設定
    this.setupModelControls();

    // 物理演算の制御
    this.applyPhysicsState();

    console.log('✅ Live2D初期化完了:', modelSettings.path);
    (window as any).__live2dCoreModel = (this.model.internalModel as any).coreModel;
    (window as any).__live2dModel = this.model;

    // motion3.json 読み込み（失敗してもハードコードフォールバックで動く）
    await this.loadMotionFiles(modelPath);
  }

  // リップシンクとアニメーション制御を設定（初期化・再読み込み共通処理）
  // ウィンドウサイズに合わせてキャラを自動配置（中央下基準）
  // forceAuto=true の場合は設定値を無視して自動計算
  private applyAutoFit(width: number, height: number, forceAuto = false) {
    if (!this.model || !this.settings) return;
    const m = this.settings.model;

    if (!forceAuto) {
      // 通常: 0〜1比率をウィンドウサイズに変換
      const scale = m.scale;
      this.model.scale.set(scale);
      this.model.pivot.set(0, 0);
      const sw0 = (this.model as any).internalModel?.originalWidth  ?? 2048;
      const sh0 = (this.model as any).internalModel?.originalHeight ?? 2048;
      const sw = sw0 * scale;
      const sh = sh0 * scale;
      // x=0.5でモデル中心がウィンドウ中央に来るよう計算
      this.model.x = width  * m.x - sw * 0.5;
      this.model.y = height * m.y - sh * 0.5;
      console.log(`📐 scale=${scale.toFixed(3)} model=${sw.toFixed(0)}x${sh.toFixed(0)} win=${width}x${height}`);
    } else {
      // 自動フィット: ウィンドウ高さ85%を使ってスケール計算、中央下配置
      const scale = (height * 0.85) / 2200;
      this.model.scale.set(scale);
      const mw2 = (this.model as any).internalModel?.originalWidth  ?? 2048;
      const mh2 = (this.model as any).internalModel?.originalHeight ?? 2048;
      this.model.pivot.set(mw2 * 0.5, mh2 * 0.5);
      this.model.x = width * 0.5;
      this.model.y = height * 0.5;
      console.log(`📐 AutoFit: ${width}x${height} → scale=${scale.toFixed(3)}`);
    }
  }

  private setupModelControls() {
    if (!this.model || !this.model.internalModel) return;

    // 1. 自動リップシンクを無効化（手動制御のため）
    this.model.lipSync = false;

    // 2. update拡張
    const originalUpdate = this.model.internalModel.update;
    const coreModel = (this.model.internalModel as any).coreModel;
    const self = this;

    // model3.json の Groups からまばたき・口パクのパラメータIDを取得
    const settingsM3 = (this.model.internalModel as any).settings;
    if (settingsM3?.groups) {
      for (const group of settingsM3.groups) {
        if (group.Name === 'EyeBlink' && group.Ids?.length > 0) {
          this.blinkParamIds = group.Ids;
        }
        if (group.Name === 'LipSync' && group.Ids?.length > 0) {
          this.lipSyncParamIds = group.Ids;
        }
      }
    }
    console.log('👁️ Blink params:', this.blinkParamIds, 'LipSync params:', this.lipSyncParamIds);

    // パラメータインデックスキャッシュ（毎フレーム30回の文字列検索 → 0回）
    this.paramCache = {
      angleX:    coreModel.getParameterIndex('ParamAngleX'),
      angleY:    coreModel.getParameterIndex('ParamAngleY'),
      angleZ:    coreModel.getParameterIndex('ParamAngleZ'),
      bodyX:     coreModel.getParameterIndex('ParamBodyAngleX'),
      bodyZ:     coreModel.getParameterIndex('ParamBodyAngleZ'),
      bodyY:     coreModel.getParameterIndex('ParamBodyAngleY'),
      breath:    coreModel.getParameterIndex('ParamBreath'),
      eyeBallX:  coreModel.getParameterIndex('ParamEyeBallX'),
      eyeBallY:  coreModel.getParameterIndex('ParamEyeBallY'),
      browLY:    coreModel.getParameterIndex('ParamBrowLY'),
      browRY:    coreModel.getParameterIndex('ParamBrowRY'),
      shoulder:  coreModel.getParameterIndex('ParamShoulder'),
      armLA:     coreModel.getParameterIndex('ParamArmLA'),
      armRA:     coreModel.getParameterIndex('ParamArmRA'),
      handL:     coreModel.getParameterIndex('ParamHandL'),
      handR:     coreModel.getParameterIndex('ParamHandR'),
      bustY:     coreModel.getParameterIndex('ParamBustY'),
      mouthForm: coreModel.getParameterIndex('ParamMouthForm'),
      mouthOpen: coreModel.getParameterIndex('ParamMouthOpen'),
      eyeLSmile: coreModel.getParameterIndex('ParamEyeLSmile'),
      eyeRSmile: coreModel.getParameterIndex('ParamEyeRSmile'),
      cheek:     coreModel.getParameterIndex('ParamCheek'),
      browLForm: coreModel.getParameterIndex('ParamBrowLForm'),
      browRForm: coreModel.getParameterIndex('ParamBrowRForm'),
      browLAng:  coreModel.getParameterIndex('ParamBrowLAngle'),
      browRAng:  coreModel.getParameterIndex('ParamBrowRAngle'),
    };

    this.model.internalModel.update = function (dt: number, now: number) {
      if (!coreModel) {
        originalUpdate.call(this, dt, now);
        return;
      }

      // === プロシージャル全体ゲート ===
      if (!self.proceduralEnabled) {
        // originalUpdate内のcoreModel.update()を一時無効化
        // → モーションがパラメータを書く → リップシンクで口だけ上書き → 手動でcommit
        const origCoreUpdate = coreModel.update?.bind(coreModel);
        if (origCoreUpdate) coreModel.update = () => {};
        originalUpdate.call(this, dt, now);
        if (origCoreUpdate) coreModel.update = origCoreUpdate;
        self.applyLipSync(coreModel);
        coreModel.update?.();
        return;
      }

      // まばたき — blinkParamIds を動的適用
      const blinkVal = self.currentBlinkValue;
      for (const id of self.blinkParamIds) {
        const idx = coreModel.getParameterIndex(id);
        if (idx >= 0) coreModel.setParameterValueByIndex(idx, blinkVal, 1.0);
      }

      // 表情連動パラメータ
      // motion3.json の表情モーションがあればスキップ（motionPlayer が処理する）
      const expr = self.currentExpression || '';
      const hasExprMotion = self.expressionMotions.has(expr);

      const idxEyeLSmile = self.paramCache.eyeLSmile;
      const idxEyeRSmile = self.paramCache.eyeRSmile;
      const idxCheek     = self.paramCache.cheek;
      const idxBrowLForm = self.paramCache.browLForm;
      const idxBrowRForm = self.paramCache.browRForm;
      const idxBrowLAng  = self.paramCache.browLAng;
      const idxBrowRAng  = self.paramCache.browRAng;

      const setE = (idx: number, val: number) => {
        if (idx >= 0) coreModel.setParameterValueByIndex(idx, val, 0.2);
      };

      // 表情による眉・目のオーバーライド
      // motion3.json がある表情はスキップ（motionPlayer が適用済み）
      const idxBrowLYexpr = self.paramCache.browLY;
      const idxBrowRYexpr = self.paramCache.browRY;

      const baseExpr = expr.endsWith('_tired') ? expr.slice(0, -6) : expr;

      if (hasExprMotion) {
        // motion3.json ベース → ハードコードスキップ
      } else if (baseExpr === 'happy' || baseExpr === 'joy' || baseExpr === 'excited') {
        setE(idxEyeLSmile, 1.0);
        setE(idxEyeRSmile, 1.0);
        setE(idxCheek, 0.8);
        setE(idxBrowLForm, 0.5);
        setE(idxBrowRForm, 0.5);
        setE(idxBrowLYexpr, 0.6);
        setE(idxBrowRYexpr, 0.6);
      } else if (baseExpr === 'sad' || baseExpr === 'cry') {
        setE(idxEyeLSmile, 0);
        setE(idxEyeRSmile, 0);
        setE(idxCheek, 0);
        setE(idxBrowLAng, -0.5);
        setE(idxBrowRAng, -0.5);
        setE(idxBrowLForm, -0.5);
        setE(idxBrowRForm, -0.5);
        setE(idxBrowLYexpr, -0.6);
        setE(idxBrowRYexpr, -0.6);
      } else if (baseExpr === 'annoyed' || baseExpr === 'angry') {
        setE(idxEyeLSmile, 0);
        setE(idxEyeRSmile, 0);
        setE(idxCheek, 0);
        setE(idxBrowLAng, -0.8);
        setE(idxBrowRAng, -0.8);
        setE(idxBrowLForm, -0.8);
        setE(idxBrowRForm, -0.8);
        setE(idxBrowLYexpr, -0.8);
        setE(idxBrowRYexpr, -0.8);
      } else if (baseExpr === 'surprised' || baseExpr === 'shocked') {
        setE(idxCheek, 0.3);
        setE(idxBrowLForm, 0.8);
        setE(idxBrowRForm, 0.8);
        setE(idxBrowLYexpr, 0.8);
        setE(idxBrowRYexpr, 0.8);
      } else if (baseExpr === 'shy' || baseExpr === 'embarrassed') {
        setE(idxEyeLSmile, 0.5);
        setE(idxEyeRSmile, 0.5);
        setE(idxCheek, 1.0);
        setE(idxBrowLForm, 0.3);
        setE(idxBrowRForm, 0.3);
        setE(idxBrowLYexpr, 0.3);
        setE(idxBrowRYexpr, 0.3);
      } else if (baseExpr === 'focused') {
        setE(idxEyeLSmile, 0);
        setE(idxEyeRSmile, 0);
        setE(idxCheek, 0);
        setE(idxBrowLAng, -0.3);
        setE(idxBrowRAng, -0.3);
        setE(idxBrowLForm, -0.2);
        setE(idxBrowRForm, -0.2);
        setE(idxBrowLYexpr, -0.1);
        setE(idxBrowRYexpr, -0.1);
      } else if (baseExpr === 'confused') {
        setE(idxEyeLSmile, 0);
        setE(idxEyeRSmile, 0);
        setE(idxCheek, 0);
        setE(idxBrowLYexpr, 0.5);
        setE(idxBrowRYexpr, -0.2);
        setE(idxBrowLAng, 0.4);
        setE(idxBrowRAng, -0.1);
      } else if (baseExpr === 'thinking') {
        setE(idxEyeLSmile, 0);
        setE(idxEyeRSmile, 0);
        setE(idxCheek, 0);
        setE(idxBrowLYexpr, -0.35);
        setE(idxBrowRYexpr, -0.35);
        setE(idxBrowLForm, -0.25);
        setE(idxBrowRForm, -0.25);
      } else {
        // neutral
        setE(idxEyeLSmile, 0);
        setE(idxEyeRSmile, 0);
        setE(idxCheek, 0);
        setE(idxBrowLAng, 0);
        setE(idxBrowRAng, 0);
        setE(idxBrowLForm, 0);
        setE(idxBrowRForm, 0);
      }

      // アイドル揺れ＋状態レイヤー（加算で既存値に乗せる）
      const t = self.elapsedTime;
      const state = self.motionLayerState;
      const intensity = self.talkIntensity;

      // paramCache からインデックス取得（毎フレームの文字列検索を回避）
      const idxAngleX   = self.paramCache.angleX;
      const idxAngleY   = self.paramCache.angleY;
      const idxAngleZ   = self.paramCache.angleZ;
      const idxBodyX    = self.paramCache.bodyX;
      const idxBodyZ    = self.paramCache.bodyZ;
      const idxBreath   = self.paramCache.breath;
      const idxEyeBallX = self.paramCache.eyeBallX;
      const idxEyeBallY = self.paramCache.eyeBallY;
      const idxBrowLY   = self.paramCache.browLY;
      const idxBrowRY   = self.paramCache.browRY;
      const idxShoulder = self.paramCache.shoulder;
      const idxArmLA    = self.paramCache.armLA;
      const idxArmRA    = self.paramCache.armRA;
      const idxHandL    = self.paramCache.handL;
      const idxHandR    = self.paramCache.handR;
      const idxBustY    = self.paramCache.bustY;

      const add = (idx: number, val: number) => {
        if (idx >= 0) coreModel.addParameterValueByIndex(idx, val, 1.0);
      };
      const set = (idx: number, val: number) => {
        if (idx >= 0) coreModel.setParameterValueByIndex(idx, val, 0.15);
      };

      // #2: 擬似Perlinノイズジッター（breathX/Zへの加算前に計算）
      const jX = Math.sin(t * 7.3 + self.jitterSeed) * 0.08 + Math.sin(t * 13.7 + self.jitterSeed * 1.3) * 0.04;
      const jZ = Math.sin(t * 9.1 + self.jitterSeed * 0.7) * 0.06 + Math.sin(t * 17.3) * 0.03;

      // 状態モーション (motion3.json) が再生中かチェック
      const hasStateMotion = (self.useMotionFiles && self.stateMotions.has(state))
                          || (state === 'idle' && self.usingBuiltinIdle);

      if (hasStateMotion) {
        // --- motion3.json が全軸を担当する ---
        // ジッターと首かしげだけ薄く乗せる（共通レイヤー）
        add(idxAngleX, jX);
        add(idxAngleZ, jZ);
        add(idxAngleZ, self.headTiltCurrent);
        // 眼球サッカードは維持
        const saccadeEase = Math.min(self.saccadeEaseTimer / self.saccadeEaseDuration, 1.0);
        const driftX = Math.sin(t * 0.23) * 0.15 + Math.sin(t * 0.47 + 1.2) * 0.08;
        const driftY = Math.sin(t * 0.31 + 0.5) * 0.1 + Math.sin(t * 0.19 + 0.8) * 0.05;
        set(idxEyeBallX, driftX + self.saccadeX * saccadeEase);
        set(idxEyeBallY, driftY + self.saccadeY * saccadeEase);
      } else {
        // --- フォールバック: motion3.json なし、procedural アニメーション ---
        const breathX    = Math.sin(t * 1.1) * 1.5 + Math.sin(t * 2.3 + 0.7) * 0.6 + Math.sin(t * 0.4 + 1.2) * 0.4;
        const breathZ    = Math.sin(t * 0.9 + 0.5) * 1.0 + Math.sin(t * 1.7 + 0.3) * 0.4;
        const breathBodyX = Math.sin(t * 0.9) * 1.5 + Math.sin(t * 1.7) * 0.5;
        const breathBodyZ = Math.sin(t * 0.7 + 0.3) * 0.8;

        // 呼吸
        set(idxBreath, (Math.sin(t * 0.5) + 1) * 0.5);

        // 眼球サッカード
        const driftX = Math.sin(t * 0.23) * 0.15 + Math.sin(t * 0.47 + 1.2) * 0.08;
        const driftY = Math.sin(t * 0.31 + 0.5) * 0.1 + Math.sin(t * 0.19 + 0.8) * 0.05;
        const saccadeEase = Math.min(self.saccadeEaseTimer / self.saccadeEaseDuration, 1.0);
        const eyeX = driftX + self.saccadeX * saccadeEase;
        const eyeY = driftY + self.saccadeY * saccadeEase;
        set(idxEyeBallX, eyeX);
        set(idxEyeBallY, eyeY);

        // ジッターと首かしげ
        add(idxAngleX, jX);
        add(idxAngleZ, jZ);
        add(idxAngleZ, self.headTiltCurrent);

        if (state === 'talk') {
          const talkX = Math.sin(t * 2.2) * 3.0 + Math.sin(t * 3.7 + 0.4) * 1.0;
          const talkZ = Math.sin(t * 1.9 + 1.1) * 1.5 + Math.sin(t * 3.1) * 0.5;
          add(idxAngleX, breathX + talkX * intensity);
          add(idxAngleZ, breathZ + talkZ * intensity);
          add(idxBodyX,  breathBodyX + Math.sin(t * 1.8) * 2.5 * intensity);
          add(idxBodyZ,  breathBodyZ + Math.sin(t * 1.4 + 0.5) * 1.5 * intensity);
          set(idxBrowLY, Math.sin(t * 0.8) * 0.2);
          set(idxBrowRY, Math.sin(t * 0.8 + 0.3) * 0.2);
          set(idxShoulder, Math.sin(t * 1.5) * 0.15);
          add(idxArmLA, Math.sin(t * 1.3) * 0.2 * intensity);
          add(idxArmRA, Math.sin(t * 1.3 + 0.8) * 0.2 * intensity);
          add(idxHandL, Math.sin(t * 2.0 + 0.3) * 0.2 * intensity);
          add(idxHandR, Math.sin(t * 2.0) * 0.2 * intensity);
          set(idxBustY, Math.sin(t * 0.5) * 0.15);
        } else if (state === 'thinking') {
          add(idxAngleX, breathX * 0.5 + Math.sin(t * 0.6) * 1.0);
          add(idxAngleZ, breathZ * 0.5 - 1.0);
          add(idxBodyX,  breathBodyX * 0.5);
          add(idxBodyZ,  breathBodyZ * 0.5);
          set(idxBrowLY, -0.4);
          set(idxBrowRY, -0.4);
          set(idxEyeBallY, eyeY + 0.2);
        } else if (state === 'listen') {
          add(idxAngleX, breathX * 0.6 + Math.sin(t * 0.4 + 0.8) * 0.8);
          add(idxAngleZ, breathZ * 0.6);
          add(idxBodyX,  breathBodyX * 0.6 + 1.5);
          add(idxBodyZ,  breathBodyZ * 0.6);
          set(idxBrowLY, 0.3);
          set(idxBrowRY, 0.3);
        } else {
          // idle
          add(idxAngleX, breathX);
          add(idxAngleZ, breathZ);
          add(idxBodyX,  breathBodyX);
          add(idxBodyZ,  breathBodyZ);
          set(idxBrowLY, 0);
          set(idxBrowRY, 0);
          set(idxBustY,  Math.sin(t * 0.5) * 0.1);
          set(idxShoulder, Math.sin(t * 0.8 + 0.5) * 0.08);
        }
      }

      // #4: 感情リアクション適用
      if (self.reactionTimer > 0 && self.reactionDuration > 0 && self.reactionExpression) {
        const rProg = 1.0 - (self.reactionTimer / self.reactionDuration);
        const rDecay = Math.sin(rProg * Math.PI); // 0→1→0
        switch (self.reactionExpression) {
          case 'happy':
          case 'excited':
            add(idxBodyX, -12.0 * rDecay);
            add(idxAngleX, -6.0 * rDecay);
            add(idxBodyZ, Math.sin(self.elapsedTime * 8.0) * 3.0 * rDecay);
            break;
          case 'surprised':
          case 'shocked':
            add(idxAngleY, -10.0 * rDecay);
            add(idxBodyX, -8.0 * rDecay);
            add(idxAngleX, -5.0 * rDecay);
            break;
          case 'sad':
            add(idxAngleX, 10.0 * rDecay);
            add(idxBodyX, 6.0 * rDecay);
            break;
          case 'annoyed':
            add(idxAngleZ, 6.0 * rDecay);
            add(idxAngleX, -3.0 * rDecay);
            break;
        }
      }

      // うなずき（listen/talk中にたまにコクッ）
      if (self.nodPhase === 1) {
        const nodProgress = Math.min(self.nodTimer / 0.4, 1.0);
        const nodVal = Math.sin(nodProgress * Math.PI) * 3.0;
        if (self.paramCache.angleY >= 0) coreModel.addParameterValueByIndex(self.paramCache.angleY, nodVal, 1.0);
      }

      // originalUpdate内のcoreModel.update()を一時無効化
      // → モーション+物理がパラメータを書く → リップシンクで口だけ上書き → 手動でcommit
      const origCoreUpdate = coreModel.update?.bind(coreModel);
      if (origCoreUpdate) coreModel.update = () => {};
      originalUpdate.call(this, dt, now);
      if (origCoreUpdate) coreModel.update = origCoreUpdate;
      self.applyLipSync(coreModel);
      coreModel.update?.();
    };

    // 3. expressionManager・focusController・eyeBlink は無効化（手動制御）
    // motionManager は有効のまま（idleモーションを再生）
    if (this.model.internalModel.expressionManager) {
      (this.model.internalModel.expressionManager as any).update = () => {};
    }
    if (this.model.internalModel.focusController) {
      (this.model.internalModel.focusController as any).update = () => {};
    }
    if (this.model.internalModel.eyeBlink) {
      (this.model.internalModel.eyeBlink as any).update = () => {};
    }

    // motionManager: 内蔵モーショングループを検出してから無効化
    try {
      const mm = this.model.internalModel.motionManager as any;
      // 内蔵モーショングループを退避（loadMotionFiles で使う可能性あり）
      this._savedMmUpdate = mm.update?.bind(mm);
      this._savedMmDefinitions = mm.definitions ? { ...mm.definitions } : {};
      this._savedMmMotionGroups = mm.motionGroups ? { ...mm.motionGroups } : {};
      this.builtinMotionGroups = Object.keys(mm.definitions || {});
      console.log('📋 内蔵モーショングループ:', this.builtinMotionGroups);
      // 一旦無効化（loadMotionFiles で必要に応じて復元）
      mm.update = () => false;
      mm.stopAllMotions?.();
      mm.motionGroups = {};
      mm.definitions = {};
      this.motionManagerRestored = false;
      console.log('✅ motionManager 一旦無効化');
    } catch (e) {
      console.warn('⚠️ motionManager 無効化失敗:', e);
    }

    if (this.model.internalModel.expressionManager) {
      (this.model.internalModel.expressionManager as any).restore?.();
      (this.model.internalModel.expressionManager as any).update = () => {};
    }

    if (this.model.internalModel.focusController) {
      (this.model.internalModel.focusController as any).update = () => {};
    }

    if (this.model.internalModel.eyeBlink) {
      (this.model.internalModel.eyeBlink as any).update = () => {};
    }

    console.log('✅ モデル制御設定完了: 口パク優先モード');

    // 物理演算の初期状態を適用（OFFならライブラリのphysicsをnullにする）
    this.applyPhysicsState();

    // Ticker登録（まばたき・アイドル・状態レイヤー）
    this.setupTicker();
  }

  private setupTicker() {
    if (!this.app) return;
    if (this.tickerCallback) {
      this.app.ticker.remove(this.tickerCallback);
      this.tickerCallback = null;
    }
    this.blinkTimer = 0;
    this.blinkState = 'open';
    this.nextBlinkDelay = 2.5 + Math.random() * 3.5;
    this.elapsedTime = 0;

    this.tickerCallback = (_deltaTime: number) => {
      try {
        // ticker.deltaMS = 実際の経過ミリ秒（PIXI v7）
        const delta = (this.app?.ticker.deltaMS ?? 33) / 1000;
        this.elapsedTime += delta;
        this.updateMotionPlayer(delta); // motion3.json 再生（常時）
        if (this.proceduralEnabled) {
          this.updateBlink(delta);
          this.updateSaccade(delta);
          this.updateNod(delta);
          this.updateHeadTilt(delta);
          this.updateMicroMovements(delta);
          this.updateReaction(delta);
          this.updateIdleAnimation();
          this.updateStateLayer();
        }
      } catch (e) {
        console.error('❌ Ticker error:', e);
      }
    };
    this.app.ticker.add(this.tickerCallback);
  }

  // #1: まばたき改善（'closed'ステート追加、ダブルまばたき対応）
  private updateBlink(delta: number) {
    // リップシンク中はスキップ
    if (this.currentMouthOpenY > 0.3) {
      this.currentBlinkValue = 1.0;
      return;
    }
    // tiredは半目
    if (this.currentExpression?.includes('tired')) {
      this.currentBlinkValue = 0.6;
      return;
    }

    const BLINK_CLOSE = 0.07;   // 閉じる: 0.07s（速い）
    const BLINK_HOLD  = 0.02;   // 完全閉じ状態で停止: 0.02s
    const BLINK_OPEN  = 0.15;   // 開く: 0.15s（ゆっくり、イーズアウト）
    this.blinkTimer += delta;

    if (this.blinkState === 'open' && this.blinkTimer >= this.nextBlinkDelay) {
      this.blinkState = 'closing';
      this.blinkTimer = 0;
      // ダブルまばたきを確率15%で予約
      this.isDoubleBlink = Math.random() < 0.15;
    } else if (this.blinkState === 'closing') {
      const p = Math.min(this.blinkTimer / BLINK_CLOSE, 1);
      this.currentBlinkValue = 1.0 - p;
      if (p >= 1) {
        this.blinkState = 'closed';
        this.blinkTimer = 0;
        this.blinkCloseHold = BLINK_HOLD;
        this.currentBlinkValue = 0.0;
      }
    } else if (this.blinkState === 'closed') {
      if (this.blinkTimer >= this.blinkCloseHold) {
        this.blinkState = 'opening';
        this.blinkTimer = 0;
      }
    } else if (this.blinkState === 'opening') {
      const p = Math.min(this.blinkTimer / BLINK_OPEN, 1);
      // イーズアウト: sqrt で緩やかに
      const eased = Math.sqrt(p);
      this.currentBlinkValue = eased;
      if (p >= 1) {
        this.currentBlinkValue = 1.0;
        if (this.isDoubleBlink && !this.doubleBlinkPending) {
          // ダブルまばたき: 少しだけ間を置いてすぐもう1回
          this.doubleBlinkPending = true;
          this.blinkState = 'open';
          this.blinkTimer = 0;
          this.nextBlinkDelay = 0.05 + Math.random() * 0.05; // 0.05〜0.10s後にすぐ再度まばたき
        } else {
          this.doubleBlinkPending = false;
          this.isDoubleBlink = false;
          this.blinkState = 'open';
          this.blinkTimer = 0;
          this.nextBlinkDelay = 2.5 + Math.random() * 3.5; // 2.5〜6.0秒
        }
      }
    }
  }

  // #6: 状態別サッカード頻度調整
  private updateSaccade(delta: number) {
    this.saccadeTimer += delta;
    this.saccadeEaseTimer += delta;

    if (this.saccadeTimer >= this.saccadeInterval) {
      // 新しい視線先をランダムに設定
      this.saccadeX = (Math.random() - 0.5) * 0.8;
      this.saccadeY = (Math.random() - 0.5) * 0.5;
      this.saccadeTimer = 0;
      this.saccadeEaseTimer = 0;

      // 状態別インターバル
      switch (this.motionLayerState) {
        case 'idle':
          this.saccadeInterval = 3.0 + Math.random() * 4.0; // 3〜7秒
          break;
        case 'talk':
          this.saccadeInterval = 0.8 + Math.random() * 1.2; // 0.8〜2秒
          break;
        case 'listen':
          this.saccadeInterval = 1.5 + Math.random() * 1.5; // 1.5〜3秒
          break;
        case 'thinking':
          this.saccadeInterval = 4.0 + Math.random() * 4.0; // 4〜8秒
          break;
        default:
          this.saccadeInterval = 2.0 + Math.random() * 5.0;
      }
    }
  }

  private updateNod(delta: number) {
    this.nodTimer += delta;
    if (this.nodPhase === 0 && this.nodTimer >= this.nodInterval) {
      this.nodPhase = 1;
      this.nodTimer = 0;
      this.nodInterval = 6.0 + Math.random() * 8.0;
    } else if (this.nodPhase === 1 && this.nodTimer >= 0.4) {
      this.nodPhase = 0;
      this.nodTimer = 0;
    }
  }

  // #3: 首かしげアニメーション
  private updateHeadTilt(delta: number) {
    const state = this.motionLayerState;
    // thinking/confused/hmm に相当する状態（confused/hmmはmotionLayerStateにないので、
    // currentExpressionも参照して判定）
    const expr = this.currentExpression || '';
    const isThinkingState = state === 'thinking'
      || expr === 'confused'
      || expr === 'hmm'
      || expr === 'thinking';

    if (!isThinkingState) {
      // 状態が解除されたら headTiltCurrent をゆっくり 0 に戻す
      if (this.headTiltCurrent !== 0) {
        const returnSpeed = delta / 1.5;
        if (Math.abs(this.headTiltCurrent) <= returnSpeed) {
          this.headTiltCurrent = 0;
          this.headTiltPhase = 0;
        } else {
          this.headTiltCurrent -= Math.sign(this.headTiltCurrent) * returnSpeed;
        }
      }
      return;
    }

    this.headTiltTimer += delta;

    if (this.headTiltPhase === 0) {
      // 待機フェーズ: インターバルが来たら傾き開始
      if (this.headTiltTimer >= this.headTiltInterval) {
        this.headTiltPhase = 1;
        this.headTiltTimer = 0;
        // 傾く角度: 8〜15度、方向はランダム
        const angle = 8.0 + Math.random() * 7.0;
        this.headTiltTarget = (Math.random() < 0.5 ? 1 : -1) * angle;
      }
    } else if (this.headTiltPhase === 1) {
      // 傾き中: 0.2秒で目標角度へ
      const progress = Math.min(this.headTiltTimer / 0.2, 1.0);
      this.headTiltCurrent = this.headTiltTarget * progress;
      if (progress >= 1.0) {
        this.headTiltPhase = 2;
        this.headTiltTimer = 0;
      }
    } else if (this.headTiltPhase === 2) {
      // 戻り中: 1.5秒かけてゆっくり 0 に戻る
      const progress = Math.min(this.headTiltTimer / 1.5, 1.0);
      // イーズイン（最初は遅く、後半で加速）
      const eased = 1.0 - (1.0 - progress) * (1.0 - progress);
      this.headTiltCurrent = this.headTiltTarget * (1.0 - eased);
      if (progress >= 1.0) {
        this.headTiltCurrent = 0;
        this.headTiltPhase = 0;
        this.headTiltTimer = 0;
        this.headTiltInterval = 5.0 + Math.random() * 5.0;
      }
    }
  }

  // #4: リアクションタイマー更新
  private updateReaction(delta: number) {
    if (this.reactionTimer > 0) {
      this.reactionTimer -= delta;
      if (this.reactionTimer < 0) this.reactionTimer = 0;
    }
  }

  // #4: 感情リアクショントリガー
  private triggerReaction(expression: string): void {
    // 内蔵 Tap モーションがあればそれを使う（motionManager が生きている場合のみ）
    if (this.motionManagerRestored) {
      const tapGroup = this.builtinMotionGroups.includes('Tap@Body') ? 'Tap@Body'
                     : this.builtinMotionGroups.includes('Tap') ? 'Tap'
                     : null;
      if (tapGroup) {
        this.model?.motion(tapGroup, undefined, 2); // priority: NORMAL
        return;
      }
    }

    this.reactionExpression = expression;
    this.reactionIntensity = 1.0;

    if (expression === 'happy' || expression === 'excited') {
      this.reactionDuration = 2.0;
    } else if (expression === 'surprised' || expression === 'shocked') {
      this.reactionDuration = 1.0;
    } else if (expression === 'sad') {
      this.reactionDuration = 3.0;
    } else if (expression === 'annoyed') {
      this.reactionDuration = 2.0;
    } else {
      // その他の表情はリアクションなし
      this.reactionTimer = 0;
      this.reactionDuration = 0;
      return;
    }

    this.reactionTimer = this.reactionDuration;
  }

  private updateIdleAnimation() {
    const coreModel = (this.model?.internalModel as any)?.coreModel;
    if (!coreModel) return;
    const t = this.elapsedTime;

    // アイドルアニメーション無効（パラメータ競合のため）
  }

  private updateStateLayer() {
    const t = this.elapsedTime;
    switch (this.motionLayerState) {
      case 'talk':
        this.layer1Overrides = {
          'ParamBodyAngleZ': Math.sin(t * 4.0) * 0.3 * this.talkIntensity,
          'ParamAngleX': Math.sin(t * 3.5 + 0.5) * 0.8 * this.talkIntensity,
          'ParamAngleZ': Math.sin(t * 2.5) * 0.4 * this.talkIntensity,
        };
        break;
      case 'listen':
        this.layer1Overrides = {
          'ParamAngleY': 5.0,
          'ParamAngleX': Math.sin(t * 0.5) * 0.5,
        };
        break;
      case 'thinking':
        this.layer1Overrides = {
          'ParamAngleX': -3.0,
          'ParamAngleZ': Math.sin(t * 1.2) * 0.3,
        };
        break;
      case 'sad':
        this.layer1Overrides = {
          'ParamAngleX': 5.0,
          'ParamBodyAngleX': 3.0,
        };
        break;
      default:
        this.layer1Overrides = {};
    }
  }

  // マイクロムーブメント — 実データ (VTube Studio Idle1) を参考に有機的な揺れを生成
  // 黄金比ベースの非周期周波数 + 超低周波エンベロープで「動く瞬間/静かな瞬間」を再現
  private updateMicroMovements(delta: number) {
    this.microTime += delta;

    const coreModel = (this.model?.internalModel as any)?.coreModel;
    if (!coreModel) return;

    const mt = this.microTime;
    const s = this.jitterSeed;

    // 超低周波エンベロープ: 振幅が時間で変わる (0.5〜1.0)
    // 実データの「動いてる瞬間」と「静かな瞬間」を再現
    const env = 0.65 + 0.35 * Math.sin(mt * 0.13 + s);

    // --- AngleX (上下) ---
    // 実データ: ±20°、breathX (±2.5) と合算で ±8〜10° を目標
    const microX =
      Math.sin(mt * 1.93 + s * 0.4)       * 4.0 +   // 0.31 Hz
      Math.sin(mt * 3.27 + s * 0.8 + 1.7) * 2.0 +   // 0.52 Hz
      Math.sin(mt * 0.83 + s * 1.2 + 3.1) * 1.5;    // 0.13 Hz (超ゆっくり)

    // --- AngleY (左右) ---
    // 実データ: ±10°、目標 ±6°
    const microY =
      Math.sin(mt * 3.83 + s * 0.3)       * 3.5 +   // 0.61 Hz
      Math.sin(mt * 2.33 + s * 0.7 + 1.4) * 1.8 +   // 0.37 Hz
      Math.sin(mt * 1.45 + s * 1.1 + 2.8) * 0.8;    // 0.23 Hz

    // --- AngleZ (傾き) ---
    // 実データ: ±22°、idle.motion3.json が ±18° 担当なので控えめに ±3° 追加
    const microZ =
      Math.sin(mt * 2.71 + s * 0.6 + 0.5) * 2.0 +   // 0.43 Hz
      Math.sin(mt * 1.17 + s * 1.0 + 2.3) * 1.2;    // 0.19 Hz

    // --- BodyAngleY (体左右旋回) ---
    // 実データ: ±2°、ほぼ一致
    const microBodyY =
      Math.sin(mt * 2.57 + s * 0.5 + 0.9) * 1.5 +   // 0.41 Hz
      Math.sin(mt * 1.82 + s * 0.9 + 2.1) * 0.7;    // 0.29 Hz

    const addMicro = (idx: number, val: number) => {
      if (idx >= 0) coreModel.addParameterValueByIndex(idx, val * env, 1.0);
    };

    addMicro(this.paramCache.angleX, microX);
    addMicro(this.paramCache.angleY, microY);
    addMicro(this.paramCache.angleZ, microZ);
    addMicro(this.paramCache.bodyY,  microBodyY);
  }

  setMotionState(state: 'idle' | 'talk' | 'listen' | 'thinking' | 'sad'): void {
    console.log(`[MotionState] ${this.motionLayerState} → ${state}`,
      'mpActive:', this.motionPlayer.activeCount,
      'builtinIdle:', this.usingBuiltinIdle,
      'mmRestored:', this.motionManagerRestored);
    this.motionLayerState = state;
    this.layer1Overrides = {};

    // 内蔵モーショングループにマッチがあれば内蔵優先
    const builtinGroup = this.findBuiltinGroup(state);
    if (builtinGroup && this.motionManagerRestored) {
      this.motionPlayer.stopAll(0);
      this.model?.motion(builtinGroup, undefined, state === 'idle' ? 1 : 2);
      this.usingBuiltinIdle = (state === 'idle');
    } else {
      // カスタムモーション: そのステート用があれば切替、無ければ現在のモーション維持
      const stateMotion = this.stateMotions.get(state);
      if (stateMotion) {
        // 同じモーションが既に再生中ならスキップ（再生リセット防止）
        if (!this.motionPlayer.isPlaying(stateMotion.name)) {
          this.motionPlayer.stopAll(0);
          this.motionPlayer.play(stateMotion, {
            loop: true,
            fadeIn: 0.5,
            weight: 1.0,
            blendMode: 'override',
            exclusive: true,
          });
        }
      }
      this.usingBuiltinIdle = false;
    }
  }

  // state名 → 内蔵モーショングループ名のマッチ
  private findBuiltinGroup(state: string): string | null {
    // 完全一致（大文字始まり）
    const capitalized = state.charAt(0).toUpperCase() + state.slice(1);
    if (this.builtinMotionGroups.includes(capitalized)) return capitalized;
    // Idle は特別扱い（多くのモデルに存在）
    if (state === 'idle' && this.builtinMotionGroups.includes('Idle')) return 'Idle';
    return null;
  }

  setTalkIntensity(intensity: number): void {
    this.talkIntensity = Math.max(0, Math.min(1, intensity));
  }

  // emotionMapを更新して逆引きマップを再構築
  updateEmotionMap(map: Record<string, { motion: string; label: string; tags: string[] }>): void {
    this.emotionMap = map;
    this.tagToEmotion = {};
    for (const [emotion, entry] of Object.entries(map)) {
      // 感情名自体もタグとして認識
      this.tagToEmotion[emotion] = emotion;
      for (const tag of entry.tags) {
        this.tagToEmotion[tag] = emotion;
      }
    }
  }

  setPhysicsEnabled(enabled: boolean): void {
    this.physicsEnabled = enabled;
    this.applyPhysicsState();
  }

  private applyPhysicsState(): void {
    if (!this.model?.internalModel) return;
    const im = this.model.internalModel as any;
    if (this.physicsEnabled) {
      // 退避していたphysicsを復元
      if (!im.physics && this._savedPhysics) {
        im.physics = this._savedPhysics;
        this._savedPhysics = null;
        console.log('[Physics] ON（復元）');
      }
    } else {
      // physicsを退避してnullにする → ライブラリがevaluateをスキップ
      if (im.physics) {
        this._savedPhysics = im.physics;
        im.physics = null;
        console.log('[Physics] OFF（退避）');
      }
    }
  }

  parseEmotionTags(text: string): { cleanText: string; expression: string | null } {
    // tagToEmotionから全タグキーを動的にパターン生成
    const allTags = Object.keys(this.tagToEmotion);
    if (allTags.length === 0) {
      return { cleanText: text, expression: null };
    }
    const tagPattern = new RegExp(`\\[(${allTags.map(t => t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|')})\\]`, 'gi');
    let expression: string | null = null;
    const cleanText = text.replace(
      tagPattern,
      (_, tag) => {
        const mapped = this.tagToEmotion[tag.toLowerCase()];
        if (mapped) { expression = mapped; this.setExpression(mapped); }
        return '';
      }
    );
    return { cleanText, expression };
  }

  /**
   * originalUpdate の後にリップシンクパラメータを上書き適用する。
   * モーション（ひよりのIdleなど）が口パラメータを上書きするため、
   * originalUpdate の後に呼ぶことで確実にリップシンクが反映される。
   */
  private applyLipSync(coreModel: any): void {
    // スムージング（急な変化を抑える）
    const smoothFactor = 0.35;
    this.mouthOpenSmoothed += (this.currentMouthOpenY - this.mouthOpenSmoothed) * smoothFactor;
    this.mouthFormSmoothed += (this.currentMouthForm - this.mouthFormSmoothed) * smoothFactor;

    const openVal = this.mouthOpenSmoothed;
    const formVal = this.mouthFormSmoothed;

    // lipSyncParamIds（model3.json Groups から取得した動的パラメータ）
    for (const id of this.lipSyncParamIds) {
      const idx = coreModel.getParameterIndex(id);
      if (idx >= 0) {
        coreModel.setParameterValueByIndex(idx, openVal, 1.0);
      }
    }

    // ParamMouthOpen（ParamMouthOpenYとは別パラメータのモデルもある）
    if (this.paramCache.mouthOpen >= 0) {
      coreModel.setParameterValueByIndex(this.paramCache.mouthOpen, openVal, 1.0);
    }

    // ParamMouthForm
    if (this.paramCache.mouthForm >= 0) {
      coreModel.setParameterValueByIndex(this.paramCache.mouthForm, formVal, 1.0);
    }
  }

  setMouthOpen(openY: number, form?: number): void {
    const scale = this.settings?.lipSyncScale ?? 1.0;
    this.currentMouthOpenY = Math.min(openY * scale, 1.0);
    if (form !== undefined) {
      this.currentMouthForm = form;
    }

    if (this.model && this.model.internalModel?.coreModel) {
      try {
        const coreModel = this.model.internalModel.coreModel;

        const mouthOpenIndex = coreModel.getParameterIndex?.('ParamMouthOpenY');
        if (mouthOpenIndex !== undefined && mouthOpenIndex >= 0) {
          coreModel.setParameterValueByIndex(mouthOpenIndex, openY, 1.0);
        } else {
          coreModel.setParameterValueById?.('ParamMouthOpenY', openY, 1.0);
        }

        if (form !== undefined) {
          const formIndex = coreModel.getParameterIndex?.('ParamMouthForm');
          if (formIndex !== undefined && formIndex >= 0) {
            coreModel.setParameterValueByIndex(formIndex, form, 1.0);
          } else {
            try {
              coreModel.setParameterValueById?.('ParamMouthForm', form, 1.0);
            } catch {
              // ParamMouthForm が無いモデルもあるので無視
            }
          }
        }
      } catch (err) {
        if (!this.mouthWarnShown) {
          console.warn('⚠️ ParamMouthOpenY パラメータが見つかりません:', err);
          this.mouthWarnShown = true;
        }
      }
    }
  }

  setExpression(name: string): void {
    const prev = this.currentExpression;
    this.currentExpression = name;
    console.log(`😊 表情変更: ${name}`);

    // emotionMapにカスタムモーション指定があればそれを優先
    const mapEntry = this.emotionMap[name];
    if (mapEntry?.motion) {
      // カスタムモーションファイルをロードして再生
      this.motionPlayer.load(mapEntry.motion, `emotion_${name}`).then(parsed => {
        this.motionPlayer.play(parsed, {
          loop: true,
          fadeIn: 0.4,
          weight: 1.0,
          blendMode: 'override',
          exclusive: true,
        });
      }).catch(err => console.warn(`感情モーション読み込み失敗: ${mapEntry.motion}`, err));
    } else {
      // motion3.json ベースの表情があればそれを再生
      const exprMotion = this.expressionMotions.get(name);
      if (exprMotion) {
        this.motionPlayer.play(exprMotion, {
          loop: true,
          fadeIn: 0.4,
          weight: 1.0,
          blendMode: 'override',
          exclusive: true,
        });
      }
    }
    // なければハードコードフォールバック（internalModel.update 内の setE が処理）

    // #4: 感情トリガー時にリアクションモーションを起動
    if (prev !== name) {
      this.triggerReaction(name);
    }
  }

  playMotion(name: string): void {
    console.log(`🎬 モーション: ${name}`);

    // 前のモーションを停止
    if (this.motionAnimFrame) {
      cancelAnimationFrame(this.motionAnimFrame);
      this.motionAnimFrame = null;
      this.motionOverrides = {};
    }

    switch (name) {
      case 'celebrate':
        this.animateCelebrate();
        break;
      case 'nod':
        this.animateNod();
        break;
      case 'shrug':
        this.animateShrug();
        break;
      case 'autofit':
        if (this.app) this.applyAutoFit(this.app.screen.width, this.app.screen.height, true);
        break;
      default:
        console.log(`🎬 未定義モーション: ${name}`);
    }
  }

  // 笑い/お祝いアニメーション（約2秒）
  private animateCelebrate() {
    const start = performance.now();
    const duration = 2000;
    const self = this;

    this.setExpression('happy');

    function tick() {
      const elapsed = performance.now() - start;
      if (elapsed > duration) {
        self.motionOverrides = {};
        self.motionAnimFrame = null;
        self.setExpression('happy');
        return;
      }

      const t = elapsed / duration;
      const laughCycle = Math.sin(elapsed * 0.015) * 0.5 + 0.5;
      const bodyBounce = Math.sin(elapsed * 0.012) * 3 * (1 - t);
      const headTilt = Math.sin(elapsed * 0.008) * 2 * (1 - t);

      self.motionOverrides = {
        'ParamMouthOpenY': laughCycle * 0.8,
        'ParamMouthOpen': laughCycle * 0.8,
        'ParamMouthForm': 0.6,
        'ParamBodyAngleZ': bodyBounce,
        'ParamAngleZ': headTilt,
        'ParamEyeLOpen': 0.5 + Math.sin(elapsed * 0.01) * 0.15,
        'ParamEyeROpen': 0.5 + Math.sin(elapsed * 0.01) * 0.15,
        'ParamBrowLY': 0.5,
        'ParamBrowRY': 0.5,
      };

      self.motionAnimFrame = requestAnimationFrame(tick);
    }

    this.motionAnimFrame = requestAnimationFrame(tick);
  }

  // うなずきアニメーション（約1秒）
  private animateNod() {
    const start = performance.now();
    const duration = 800;
    const self = this;

    function tick() {
      const elapsed = performance.now() - start;
      if (elapsed > duration) {
        self.motionOverrides = {};
        self.motionAnimFrame = null;
        return;
      }

      const nodCurve = Math.sin(elapsed * 0.016) * 8 * (1 - elapsed / duration);
      self.motionOverrides = {
        'ParamAngleY': nodCurve,
      };

      self.motionAnimFrame = requestAnimationFrame(tick);
    }

    this.motionAnimFrame = requestAnimationFrame(tick);
  }

  // 肩をすくめるアニメーション（約1秒）
  private animateShrug() {
    const start = performance.now();
    const duration = 1000;
    const self = this;

    function tick() {
      const elapsed = performance.now() - start;
      if (elapsed > duration) {
        self.motionOverrides = {};
        self.motionAnimFrame = null;
        return;
      }

      const t = elapsed / duration;
      const shrug = Math.sin(t * Math.PI) * 5;
      const tilt = Math.sin(t * Math.PI) * 3;

      self.motionOverrides = {
        'ParamAngleX': tilt,
        'ParamBodyAngleX': -tilt * 0.5,
        'ParamBrowLY': 0.3 * Math.sin(t * Math.PI),
        'ParamBrowRY': -0.3 * Math.sin(t * Math.PI),
      };

      self.motionAnimFrame = requestAnimationFrame(tick);
    }

    this.motionAnimFrame = requestAnimationFrame(tick);
  }

  async reload(settings: CharacterSettings): Promise<void> {
    console.log('🔄 Live2D設定変更を検知、モデル再読み込み中...');
    const oldResolution = this.settings?.resolution;
    this.settings = settings;
    this.updateEmotionMap(settings.emotionMap || {});

    // 物理演算の更新
    if (this.physicsEnabled !== (settings.physicsEnabled !== false)) {
      this.setPhysicsEnabled(settings.physicsEnabled !== false);
    }

    const { window: winSettings, model: modelSettings } = settings;

    // 解像度が変わった場合はPIXIアプリを完全再作成
    if (oldResolution !== settings.resolution) {
      console.log('🔧 解像度変更を検知、PIXIアプリを再作成...');

      if (this.model) {
        if (this.app && this.app.stage) {
          this.app.stage.removeChild(this.model);
        }
        this.model.destroy();
        this.model = null;
      }

      if (this.app) {
        this.app.destroy(true, { children: true, texture: true, baseTexture: true });
        this.app = null;
      }

      // 古いcanvasを削除して新しいcanvasを作成
      if (this.canvas) {
        const parent = this.canvas.parentElement;
        if (parent) {
          this.canvas.remove();
          const newCanvas = document.createElement('canvas');
          newCanvas.id = 'live2d-canvas';
          newCanvas.width = winSettings.width;
          newCanvas.height = winSettings.height;
          parent.appendChild(newCanvas);
          (window as any).__live2dCanvas = newCanvas;
          this.canvas = newCanvas;
        }
      }

      await new Promise(resolve => setTimeout(resolve, 100));

      this.app = new PIXI.Application({
        view: this.canvas!,
        width: winSettings.width,
        height: winSettings.height,
        backgroundAlpha: 0,
        autoDensity: true,
        resolution: settings.resolution || 2
      });
      this.app.ticker.maxFPS = settings.fps || 30;

      console.log('✅ PIXIアプリ再作成完了');
    } else if (this.app && this.model) {
      this.app.stage.removeChild(this.model);
      this.model.destroy();
      this.model = null;

      this.app.renderer.resize(winSettings.width, winSettings.height);
    }

    // 新しいモデルを読み込み
    let modelPath = modelSettings.path;
    const resourcePath = await platform.getResourcePath();
    if (resourcePath && modelSettings.path.startsWith('/live2d/')) {
      const relativePath = modelSettings.path.replace('/live2d/', '');
      modelPath = `file:///${resourcePath.replace(/\\/g, '/')}/${relativePath}`;
    }

    console.log('📦 モデル再読み込み中:', modelPath);
    this.model = await Live2DModel.from(modelPath, {
      autoInteract: false
    });

    // PIXI v7 + pixi-live2d-display 互換性パッチ
    if (this.model && !(this.model as any).isInteractive) {
      (this.model as any).isInteractive = () => false;
    }
    (this.model as any).eventMode = 'none';
    (this.model as any).interactive = false;
    (this.model as any).interactiveChildren = false;

    if (!this.app) {
      console.error('❌ PIXIアプリが存在しません');
      return;
    }

    this.app.stage.addChild(this.model as any);

    this.updateTransform(settings);

    this.setupModelControls();

    // モーション再読み込み（新モデル用）
    this.expressionMotions.clear();
    this.stateMotions.clear();
    this.useMotionFiles = false;
    this.usingBuiltinIdle = false;
    this.motionManagerRestored = false;
    this.motionPlayer.stopAll(0);
    await this.loadMotionFiles(modelPath);

    console.log('✅ Live2Dモデル再読み込み完了');
  }

  updateTransform(settings: CharacterSettings): void {
    this.settings = settings;
    if (!this.model || !this.app) return;

    // FPS制限更新
    this.app.ticker.maxFPS = settings.fps || 30;

    // スケール・位置（常時自動フィット）
    this.applyAutoFit(this.app.screen.width, this.app.screen.height);
  }

  // --- motion3.json 統合 ---

  // モデルパスからモーションディレクトリを推定して読み込み
  private async loadMotionFiles(modelPath: string) {
    try {
      const baseDir = modelPath.replace(/[^/\\]+$/, '');

      // 1. 設定の idleMotion が指定されていればそれを優先読み込み
      const idleFile = this.settings?.idleMotion;
      if (idleFile) {
        // 絶対パス（/live2d/...）はそのまま、相対パスはbaseDir基準
        const idlePath = idleFile.startsWith('/') ? idleFile : baseDir + idleFile;
        try {
          const motion = await this.motionPlayer.load(idlePath, 'model_idle');
          this.stateMotions.set('idle', motion);
          console.log(`✅ 設定 idleMotion 読み込み: ${idlePath}`);
        } catch {
          console.warn(`⚠️ 設定 idleMotion 見つからず: ${idlePath}`);
        }
      }

      // 2. stateMotionMap（設定画面で指定）があれば優先読み込み
      const stateMap = this.settings?.stateMotionMap || {};
      for (const [stateName, motionPath] of Object.entries(stateMap)) {
        if (!motionPath || this.stateMotions.has(stateName)) continue;
        const fullPath = motionPath.startsWith('/') ? motionPath : baseDir + motionPath;
        try {
          const motion = await this.motionPlayer.load(fullPath, `model_${stateName}`);
          this.stateMotions.set(stateName, motion);
          console.log(`✅ 設定 stateMotion 読み込み: ${stateName} → ${fullPath}`);
        } catch {
          console.warn(`⚠️ 設定 stateMotion 見つからず: ${stateName} → ${fullPath}`);
        }
      }

      // 3. モデルのモーションファイルを自動探索（未ロード分のみ）
      //    motions/ サブディレクトリ → モデル直下 の順で探索
      const searchDirs = [baseDir + 'motions/', baseDir];
      const motionNames = ['idle', 'talk', 'listen', 'thinking', 'sad'];
      let loaded = 0;

      for (const name of motionNames) {
        if (this.stateMotions.has(name)) continue; // 設定or既出ならスキップ
        for (const dir of searchDirs) {
          try {
            const motion = await this.motionPlayer.load(
              `${dir}${name}.motion3.json`, `model_${name}`
            );
            this.stateMotions.set(name, motion);
            loaded++;
            console.log(`✅ モデルモーション読み込み: ${name} (${dir})`);
            break;
          } catch {
            // ファイルなし → 次のディレクトリを試す
          }
        }
      }

      // 3. motionManager の内蔵モーショングループも復元（Tap 等で使える）
      if (this.builtinMotionGroups.length > 0) {
        try {
          const mm = this.model?.internalModel?.motionManager as any;
          if (mm && this._savedMmUpdate) {
            mm.update = this._savedMmUpdate;
            mm.definitions = this._savedMmDefinitions || {};
            mm.motionGroups = this._savedMmMotionGroups || {};
            this.motionManagerRestored = true;
            console.log('✅ motionManager 復元');
          }
        } catch (e) {
          console.warn('⚠️ motionManager 復元失敗:', e);
        }
      }

      // 4. idle モーション再生
      const idleMotion = this.stateMotions.get('idle');
      if (idleMotion) {
        this.motionPlayer.play(idleMotion, {
          loop: true, fadeIn: 0.5, weight: 1.0,
          blendMode: 'override', exclusive: true,
        });
        this.useMotionFiles = true;
        console.log('✅ モデル idle モーション再生開始');
      } else if (this.builtinMotionGroups.includes('Idle')) {
        this.usingBuiltinIdle = true;
        this.model?.motion('Idle', undefined, 1);
        console.log('✅ 内蔵 Idle モーション再生');
      } else {
        console.log('ℹ️ モーションなし、リップシンクのみ');
      }
    } catch (e) {
      console.warn('⚠️ モーション初期化エラー:', e);
    }
  }

  // 外部からモーションを動的に追加（エディターから直接インポート等）
  async loadExpressionMotion(name: string, path: string): Promise<void> {
    try {
      const motion = await this.motionPlayer.load(path, name);
      this.expressionMotions.set(name, motion);
      this.useMotionFiles = true;
      console.log(`✅ 表情モーション追加: ${name}`);
    } catch (e) {
      console.warn(`⚠️ 表情モーション読み込み失敗: ${name}`, e);
    }
  }

  // motionPlayer の出力を coreModel に適用
  private updateMotionPlayer(delta: number) {
    if (this.motionPlayer.activeCount === 0) return;

    const coreModel = (this.model?.internalModel as any)?.coreModel;
    if (!coreModel) return;

    const values = this.motionPlayer.update(delta);

    for (const [paramId, { value, mode }] of values) {
      const idx = coreModel.getParameterIndex(paramId);
      if (idx < 0) continue;

      if (mode === 'override') {
        // override: 表情モーションの値で上書き（スムージング付き）
        coreModel.setParameterValueByIndex(idx, value, 0.3);
      } else {
        // additive: 既存値に加算
        coreModel.addParameterValueByIndex(idx, value, 1.0);
      }
    }
  }

  // motion3.json プレイヤーへのアクセサ（外部連携用）
  getMotionPlayer(): MotionPlayer {
    return this.motionPlayer;
  }

  resize(width: number, height: number): void {
    if (!this.app || !this.model) return;
    this.app.renderer.resize(width, height);
    this.applyAutoFit(width, height);
  }

  destroy(): void {
    // Ticker停止
    if (this.app && this.tickerCallback) {
      this.app.ticker.remove(this.tickerCallback);
      this.tickerCallback = null;
    }

    // モーションプレイヤー停止
    this.motionPlayer.stopAll(0);
    this.motionPlayer.clearCache();

    // モーションアニメーション停止
    if (this.motionAnimFrame) {
      cancelAnimationFrame(this.motionAnimFrame);
      this.motionAnimFrame = null;
    }
    this.motionOverrides = {};

    // モデル破棄
    if (this.model) {
      if (this.app && this.app.stage) {
        this.app.stage.removeChild(this.model);
      }
      this.model.destroy();
      this.model = null;
    }

    // PIXIアプリ破棄
    if (this.app) {
      this.app.destroy(true, { children: true, texture: true, baseTexture: true });
      this.app = null;
    }

    console.log('🧹 Live2Dレンダラー破棄完了');
  }

  // --- ドラッグ用にmodel/app/settingsを公開 ---
  getModel(): any { return this.model; }
  getApp(): PIXI.Application | null { return this.app; }
  getSettings(): CharacterSettings | null { return this.settings; }
  getCanvas(): HTMLCanvasElement | null { return this.canvas; }

  /** ドラッグでモデル位置を更新 */
  setModelPosition(x: number, y: number): void {
    if (this.model) {
      this.model.x = x;
      this.model.y = y;
    }
  }

  /** 現在のモデル位置を取得 */
  getModelPosition(): { x: number; y: number } | null {
    if (!this.model) return null;
    return { x: this.model.x, y: this.model.y };
  }

  /** canvas上のモデル表示幅高を取得 */
  getViewSize(): { width: number; height: number } | null {
    if (!this.app) return null;
    return { width: this.app.screen.width, height: this.app.screen.height };
  }

}
