// Docked mode: キャラ + チャットを1ウィンドウに統合するエントリポイント
// character.ts と app.ts の初期化を統合。IPC転送不要でlipSyncService直結。

import { platform } from './platform';
import { lipSyncService } from './lip-sync-service';
import type { CharacterSettings, CharacterRenderer } from './types';
import './types';
import { t, initI18n, applyDOMTranslations } from './locales';

// ====== Character init (character.ts から移植・整理) ======

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

async function createRenderer(modelType: string): Promise<CharacterRenderer> {
  if (modelType === 'vrm') {
    const { VRMRenderer } = await import('./character-vrm');
    return new VRMRenderer();
  } else {
    const { Live2DRenderer } = await import('./character-live2d');
    return new Live2DRenderer();
  }
}

// dockedモードではIPC経由でlip-syncが同じウィンドウに戻ってくる
// （main.cjsでcharacterWindow = dockedWindowにセットしてるため）
// onLipSyncで受けてrendererに直接流す
function setupLipSyncForDocked() {
  if (platform?.onLipSync) {
    platform.onLipSync((value: number, form?: number) => {
      renderer?.setMouthOpen(value, form);
    });
    console.log('✅ [docked] LipSync IPC→renderer直結セットアップ完了');
  }
}

async function initCharacter() {
  try {
    const settings = await platform.getSettings();
    characterSettings = settings.character || DEFAULT_CHARACTER_SETTINGS;

    const modelType = characterSettings.modelType || 'live2d';
    console.log(`🎭 [docked] モデルタイプ: ${modelType}`);

    // ドッキングモード: ペインの実サイズをwindow設定に上書き
    const charPane = document.getElementById('docked-char-pane');
    if (charPane) {
      const rect = charPane.getBoundingClientRect();
      if (rect.width > 0 && rect.height > 0) {
        characterSettings.window = {
          width: Math.round(rect.width),
          height: Math.round(rect.height),
        };
      }
    }

    renderer = await createRenderer(modelType);
    await renderer.init(canvas, characterSettings);

    // 表情変更
    if (platform?.onExpressionChange) {
      platform.onExpressionChange((expression: string) => {
        renderer?.setExpression(expression);
      });
    }

    // モーション
    if (platform?.onMotionTrigger) {
      platform.onMotionTrigger((motion: string) => {
        if (motion.startsWith('oneshot:')) {
          renderer?.playMotion(motion.replace('oneshot:', ''));
          return;
        }
        if (motion.startsWith('group:')) {
          const group = motion.replace('group:', '');
          const model = renderer?.getModel?.();
          if (model) model.motion(group, undefined, 2);
          return;
        }
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
        const motionStates = ['idle', 'talk', 'listen', 'thinking', 'sad'];
        if (motionStates.includes(motion) && renderer?.setMotionState) {
          renderer.setMotionState(motion as any);
        } else {
          renderer?.playMotion(motion);
        }
      });
    }

    // 設定変更時のモデル更新
    platform.onSettingsChanged(async (newSettings: CharacterSettings) => {
      const oldModelType = characterSettings?.modelType || 'live2d';
      const newModelType = newSettings.modelType || 'live2d';
      const old = characterSettings;
      // ドッキングモード: ペインの実サイズでwindow設定を上書き
      const charPane = document.getElementById('docked-char-pane');
      if (charPane) {
        const rect = charPane.getBoundingClientRect();
        if (rect.width > 0 && rect.height > 0) {
          newSettings.window = {
            width: Math.round(rect.width),
            height: Math.round(rect.height),
          };
        }
      }
      characterSettings = newSettings;

      if (oldModelType !== newModelType) {
        console.log(`🔄 [docked] モデルタイプ変更: ${oldModelType} → ${newModelType}（再起動で反映）`);
        return;
      }

      const needsFullReload = old !== null && (
        old.model.path !== newSettings.model.path ||
        old.resolution !== newSettings.resolution ||
        old.idleMotion !== newSettings.idleMotion ||
        old.tapMotion !== newSettings.tapMotion
      );

      try {
        if (needsFullReload) {
          await renderer?.reload(newSettings);
        } else {
          renderer?.updateTransform(newSettings);
        }
      } catch (err) {
        console.error('❌ [docked] モデル更新失敗:', err);
      }
    });

    canvas.style.display = 'block';

    // ペインリサイズ時にキャラクターを自動追従（debounce付き）
    if (charPane && renderer?.resize) {
      let resizeTimer: ReturnType<typeof setTimeout> | null = null;
      const ro = new ResizeObserver((entries) => {
        for (const entry of entries) {
          const { width, height } = entry.contentRect;
          if (width > 0 && height > 0 && renderer?.resize) {
            if (resizeTimer) clearTimeout(resizeTimer);
            resizeTimer = setTimeout(() => {
              renderer.resize(Math.round(width), Math.round(height));
            }, 100);
          }
        }
      });
      ro.observe(charPane);
    }

    console.log('✅ [docked] キャラクター初期化完了');

  } catch (err) {
    console.error('❌ [docked] キャラクター初期化失敗:', err);
    canvas.style.display = 'none';
    const errorOverlay = document.getElementById('model-error-overlay');
    const errorMsg = document.getElementById('model-error-msg');
    if (errorOverlay && errorMsg) {
      const errText = err instanceof Error ? err.message : String(err);
      const modelPath = characterSettings?.model?.path || '不明';
      errorMsg.textContent = `モデルの読み込みに失敗しました\n\nパス: ${modelPath}\nエラー: ${errText}`;
      errorMsg.style.whiteSpace = 'pre-wrap';
      errorOverlay.classList.add('visible');
    }
  }
}

// ====== Titlebar controls ======

function initTitlebar() {
  const settingsBtn = document.getElementById('titlebar-settings');
  const minimizeBtn = document.getElementById('titlebar-minimize');
  const closeBtn = document.getElementById('titlebar-close');

  // Settings: ドッキングモードではiframeでチャットペインを置き換える
  const chatPane = document.getElementById('docked-chat-pane');
  const settingsPane = document.getElementById('docked-settings-pane');
  const settingsIframe = document.getElementById('settings-iframe') as HTMLIFrameElement | null;
  const settingsBackBtn = document.getElementById('settings-back-btn');
  let settingsOpen = false;

  function toggleSettings(show: boolean) {
    if (!chatPane || !settingsPane) return;
    settingsOpen = show;
    if (show) {
      chatPane.style.display = 'none';
      settingsPane.style.display = 'flex';
      if (settingsIframe && !settingsIframe.src) {
        settingsIframe.src = 'settings.html';
      }
    } else {
      settingsPane.style.display = 'none';
      chatPane.style.display = 'flex';
    }
  }

  // iframe内のsettings.htmlから「閉じる/キャンセル」が呼ばれた時のハンドラ
  // settings.tsのcloseSettingsWindow()がIPC経由でウィンドウを閉じようとするが、
  // ドッキングモードでは代わりにチャットに戻す
  (window as any).__dockedCloseSettings = () => toggleSettings(false);

  settingsBtn?.addEventListener('click', () => {
    toggleSettings(!settingsOpen);
  });

  settingsBackBtn?.addEventListener('click', () => {
    toggleSettings(false);
  });

  minimizeBtn?.addEventListener('click', () => {
    const api = (window as any).electronAPI;
    if (api?.minimizeWindow) {
      api.minimizeWindow();
    }
  });

  closeBtn?.addEventListener('click', () => {
    const api = (window as any).electronAPI;
    if (api?.hideWindow) {
      api.hideWindow();
    }
  });
}

// ====== Theme ======
async function applyTheme() {
  const settings = await platform.getSettings();
  const theme = settings.theme || 'system';
  let isDark = theme === 'dark';
  if (theme === 'system') {
    isDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
  }
  document.documentElement.setAttribute('data-theme', isDark ? 'dark' : 'light');
}

// ====== Main init sequence ======
async function init() {
  // i18n (app.ts も呼ぶが initI18n は冪等)
  await initI18n();
  applyDOMTranslations();

  // Theme
  await applyTheme();

  // Titlebar
  initTitlebar();

  // キャラ初期化
  await initCharacter();

  // LipSync: IPC経由で戻ってきたデータをrendererに流す（キャラ初期化後）
  setupLipSyncForDocked();

  // チャットUI初期化 (app.ts は自前でplatformを使って非同期初期化する)
  await import('./app');

  console.log('✅ [docked] 全初期化完了');
}

init().catch(err => console.error('❌ [docked] 初期化エラー:', err));
