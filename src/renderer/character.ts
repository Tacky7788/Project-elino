// キャラウィンドウ: オーケストレーター（Live2D / VRM切替）
import { lipSyncService } from './lip-sync-service';
import type { CharacterSettings, CharacterRenderer } from './types';
import './types'; // Import for global type declaration
import { t, initI18n, applyDOMTranslations } from './locales';
import { platform } from './platform';

// デフォルト設定
const DEFAULT_CHARACTER_SETTINGS: CharacterSettings = {
  window: { width: 300, height: 200 },
  model: {
    path: '/live2d/models/AvatarSample-A/AvatarSample_A.vrm',
    scale: 0.2,
    x: 0.5,
    y: 0.0,
    anchorX: 0.5,
    anchorY: 0.0
  },
  resolution: 2,
  idleMotion: 'Idle',
  tapMotion: 'Tap@Body'
};

let canvas = document.getElementById('live2d-canvas') as HTMLCanvasElement;

let renderer: CharacterRenderer | null = null;
let characterSettings: CharacterSettings | null = null;

// ドラッグ&ドロップ用の状態
let isDragging = false;
let dragStartX = 0;
let dragStartY = 0;
let modelStartX = 0;
let modelStartY = 0;
let clickStartTime = 0;
let clickStartPos = { x: 0, y: 0 };

// --- レンダラー生成（dynamic import）---
async function createRenderer(modelType: string): Promise<CharacterRenderer> {
  if (modelType === 'vrm') {
    const { VRMRenderer } = await import('./character-vrm');
    return new VRMRenderer();
  } else {
    const { Live2DRenderer } = await import('./character-live2d');
    return new Live2DRenderer();
  }
}

// --- canvasイベントリスナー登録（canvas再作成時にも再登録可能）---
function setupCanvasListeners(): void {
  canvas.addEventListener('mousedown', (e) => {
    if (!renderer) return;
    clickStartTime = Date.now();
    clickStartPos = { x: e.clientX, y: e.clientY };

    isDragging = false;
    dragStartX = e.clientX;
    dragStartY = e.clientY;

    // Live2Dレンダラーの場合のみモデル位置を取得
    const live2d = renderer as any;
    if (typeof live2d.getModelPosition === 'function') {
      const pos = live2d.getModelPosition();
      if (pos) {
        modelStartX = pos.x;
        modelStartY = pos.y;
      }
    }
  });
}

// --- 初期化 ---
async function initCharacter() {
  try {
    // i18n初期化
    await initI18n();
    applyDOMTranslations();

    // 設定読み込み
    const settings = await platform.getSettings();
    characterSettings = settings.character || DEFAULT_CHARACTER_SETTINGS;

    const modelType = characterSettings.modelType || 'live2d';
    console.log(`🎭 モデルタイプ: ${modelType}`);

    // レンダラー生成＋初期化
    renderer = await createRenderer(modelType);
    await renderer.init(canvas, characterSettings);

    // リップシンクサービス登録
    lipSyncService.registerMouthControl((openY: number, _form?: number) => {
      renderer?.setMouthOpen(openY, _form);
    });

    // IPCリスナー登録
    if (platform?.onLipSync) {
      platform.onLipSync((value: number) => {
        renderer?.setMouthOpen(value);
      });
      console.log('✅ LipSync IPC: リップシンク受信を登録');
    }

    if (platform?.onExpressionChange) {
      platform.onExpressionChange((expression: string) => {
        renderer?.setExpression(expression);
      });
      console.log('✅ Expression IPC: 表情変更受信を登録');
    }

    if (platform?.onMotionTrigger) {
      platform.onMotionTrigger((motion: string) => {
        // oneshot:xxx 形式（設定画面テストボタン用）
        if (motion.startsWith('oneshot:')) {
          const name = motion.replace('oneshot:', '');
          renderer?.playMotion(name);
          return;
        }
        // group:xxx 形式（内蔵モーショングループ再生）
        if (motion.startsWith('group:')) {
          const group = motion.replace('group:', '');
          const model = renderer?.getModel?.();
          if (model) model.motion(group, undefined, 2);
          return;
        }
        // file:パス 形式（モーションファイル直接再生）
        if (motion.startsWith('file:')) {
          const filePath = motion.replace('file:', '');
          const player = (renderer as any)?.getMotionPlayer?.();
          if (player) {
            player.load(filePath, '_test_' + Date.now()).then((parsed: any) => {
              player.play(parsed, { loop: false, fadeIn: 0.3, weight: 1.0, blendMode: 'override', exclusive: false });
            }).catch((e: any) => console.warn('モーション再生失敗:', e));
          }
          return;
        }
        // setMotionState対応（talk/listen/thinking/idle/sad）
        const motionStates = ['idle', 'talk', 'listen', 'thinking', 'sad'];
        if (motionStates.includes(motion) && renderer?.setMotionState) {
          renderer.setMotionState(motion as any);
        } else {
          renderer?.playMotion(motion);
        }
      });
      console.log('✅ Motion IPC: モーション受信を登録');
    }

    // --- 字幕表示 ---
    const subtitleContainer = document.getElementById('subtitle-container');
    const subtitleTextEl = document.getElementById('subtitle-text');
    let subtitleFadeTimer: ReturnType<typeof setTimeout> | null = null;

    const streaming = settings.streaming;
    if (streaming?.enabled && streaming?.subtitle?.enabled) {
      if (subtitleContainer) subtitleContainer.style.display = 'block';
      if (subtitleTextEl) subtitleTextEl.style.fontSize = `${streaming.subtitle.fontSize || 28}px`;
      console.log('✅ 字幕表示: 有効');
    }

    if (platform?.onSubtitleUpdate) {
      platform.onSubtitleUpdate((data: { text: string; clear: boolean }) => {
        if (!subtitleContainer || !subtitleTextEl) return;
        // 配信モード無効時は非表示
        if (subtitleContainer.style.display === 'none') return;

        if (subtitleFadeTimer) {
          clearTimeout(subtitleFadeTimer);
          subtitleFadeTimer = null;
        }

        if (data.clear) {
          // フェードアウト開始
          subtitleTextEl.classList.add('fading');
          subtitleFadeTimer = setTimeout(() => {
            subtitleTextEl.textContent = '';
            subtitleTextEl.classList.remove('fading');
          }, 500);
        } else {
          subtitleTextEl.classList.remove('fading');
          subtitleTextEl.textContent = data.text;
        }
      });
      console.log('✅ Subtitle IPC: 字幕受信を登録');
    }

    canvas.style.display = 'block';
    console.log('✅ キャラクター初期化完了');

  } catch (err) {
    console.error('❌ キャラクター初期化失敗:', err);
    canvas.style.display = 'none';
    // エラーオーバーレイ表示
    const errorOverlay = document.getElementById('model-error-overlay');
    const errorMsg = document.getElementById('model-error-msg');
    if (errorOverlay && errorMsg) {
      const errText = err instanceof Error ? err.message : String(err);
      const modelPath = characterSettings?.model?.path || '不明';
      errorMsg.textContent = `${t('character.error.loadFailed')}\n\nパス: ${modelPath}\nエラー: ${errText}`;
      errorMsg.style.whiteSpace = 'pre-wrap';
      errorOverlay.classList.add('visible');
    }
  }
}

// --- ドラッグ&ドロップ＋クリック処理（documentレベル）---
document.addEventListener('mousemove', (e) => {
  if (!renderer) return;
  const moveDistance = Math.sqrt(
    Math.pow(e.clientX - clickStartPos.x, 2) +
    Math.pow(e.clientY - clickStartPos.y, 2)
  );

  if (moveDistance > 5 && !isDragging) {
    isDragging = true;
    canvas.style.cursor = 'grabbing';
  }

  if (isDragging) {
    const dx = e.clientX - dragStartX;
    const dy = e.clientY - dragStartY;

    // Live2Dレンダラーの場合のみドラッグ移動
    const live2d = renderer as any;
    if (typeof live2d.setModelPosition === 'function') {
      live2d.setModelPosition(modelStartX + dx, modelStartY + dy);
    }
  }
});

document.addEventListener('mouseup', async (e) => {
  const clickDuration = Date.now() - clickStartTime;

  if (isDragging && renderer && characterSettings) {
    isDragging = false;
    canvas.style.cursor = 'pointer';

    // Live2Dの場合のみ位置を記録
    const live2d = renderer as any;
    if (typeof live2d.getModelPosition === 'function' && typeof live2d.getViewSize === 'function') {
      const pos = live2d.getModelPosition();
      const viewSize = live2d.getViewSize();
      if (pos && viewSize) {
        const newX = pos.x / viewSize.width;
        const newY = pos.y / viewSize.height;
        characterSettings.model.x = newX;
        characterSettings.model.y = newY;
        console.log(`📍 位置変更: x=${newX.toFixed(2)}, y=${newY.toFixed(2)} (設定画面で「保存」すると永続化されます)`);
      }
    }
  } else if (clickDuration < 300) {
    // 短いクリック：チャット開閉
    await platform.toggleChat();

    if (renderer && characterSettings?.tapMotion) {
      renderer.playMotion(characterSettings.tapMotion);
    }
  }

  isDragging = false;
  canvas.style.cursor = 'pointer';
});

// --- canvas mousedownリスナー初期登録 ---
setupCanvasListeners();

// --- 設定変更時にモデルを更新（スマート判定） ---
platform.onSettingsChanged(async (newSettings: CharacterSettings) => {
  console.log('🔄 設定変更を検知');

  const oldModelType = characterSettings?.modelType || 'live2d';
  const newModelType = newSettings.modelType || 'live2d';
  const old = characterSettings;
  characterSettings = newSettings;

  if (oldModelType !== newModelType) {
    // モデルタイプ変更 → 再起動で対応（設定画面側で再起動ダイアログ表示済み）
    console.log(`🔄 モデルタイプ変更検知: ${oldModelType} → ${newModelType}（再起動で反映）`);
    return;
  }

  // フルリロードが必要な変更を検出
  const needsFullReload = old !== null && (
    old.model.path !== newSettings.model.path ||
    old.resolution !== newSettings.resolution ||
    old.window.width !== newSettings.window.width ||
    old.window.height !== newSettings.window.height ||
    old.idleMotion !== newSettings.idleMotion ||
    old.tapMotion !== newSettings.tapMotion
  );

  try {
    if (needsFullReload) {
      console.log('🔄 フルリロード（モデル/解像度/ウィンドウサイズ変更）');
      await renderer?.reload(newSettings);
    } else {
      console.log('⚡ 軽量更新（トランスフォームのみ）');
      renderer?.updateTransform(newSettings);
    }
  } catch (err) {
    console.error('❌ モデル更新失敗:', err);
    const errorOverlay = document.getElementById('model-error-overlay');
    const errorMsg = document.getElementById('model-error-msg');
    if (errorOverlay && errorMsg) {
      const errText = err instanceof Error ? err.message : String(err);
      errorMsg.textContent = `${t('character.error.updateFailed')}\n\nエラー: ${errText}`;
      errorMsg.style.whiteSpace = 'pre-wrap';
      errorOverlay.classList.add('visible');
    }
  }
});

// 初期化
initCharacter();

console.log('✅ キャラウィンドウ初期化完了');
