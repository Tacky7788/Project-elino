import { platform } from '../platform';
// Settings shared utilities
import { t } from '../locales';
import type { CharacterSettings, Settings } from '../types';

// ====== Global State ======
export let currentSettings: Settings | null = null;
export function setCurrentSettings(s: Settings | null) { currentSettings = s; }

export let modelRegistry: Record<string, Array<{ id: string; label: string; multiModal?: boolean }>> = {};
export function setModelRegistry(r: typeof modelRegistry) { modelRegistry = r; }

// ====== Preview ======
let previewTimer: ReturnType<typeof setTimeout> | null = null;
const PREVIEW_DEBOUNCE_MS = 200;

export async function applyPreview(): Promise<void> {
  if (!currentSettings) return;
  const DEFAULT_CHARACTER = getDefaultCharacter();
  try {
    const modelPathInput = document.getElementById('model-path') as HTMLInputElement | null;
    const modelScaleNumInput = document.getElementById('model-scale-num') as HTMLInputElement | null;
    const modelScaleInput = document.getElementById('model-scale') as HTMLInputElement | null;
    const modelXNumInput = document.getElementById('model-x-num') as HTMLInputElement | null;
    const modelXInput = document.getElementById('model-x') as HTMLInputElement | null;
    const modelYNumInput = document.getElementById('model-y-num') as HTMLInputElement | null;
    const modelYInput = document.getElementById('model-y') as HTMLInputElement | null;
    const anchorXInput = document.getElementById('anchor-x') as HTMLInputElement | null;
    const anchorYInput = document.getElementById('anchor-y') as HTMLInputElement | null;
    const idleMotionInput = document.getElementById('idle-motion') as HTMLSelectElement | null;
    const tapMotionInput = document.getElementById('tap-motion') as HTMLSelectElement | null;
    const modelTypeSelect = document.getElementById('model-type') as HTMLSelectElement | null;
    const physicsEnabledInput = document.getElementById('physics-enabled') as HTMLInputElement | null;
    const vrmCameraDistanceNumInput = document.getElementById('vrm-camera-distance-num') as HTMLInputElement | null;
    const vrmCameraHeightNumInput = document.getElementById('vrm-camera-height-num') as HTMLInputElement | null;
    const vrmLightIntensityNumInput = document.getElementById('vrm-light-intensity-num') as HTMLInputElement | null;
    const vrmModelXNumInput = document.getElementById('vrm-model-x-num') as HTMLInputElement | null;
    const vrmModelYNumInput = document.getElementById('vrm-model-y-num') as HTMLInputElement | null;
    const vrmCameraAngleXNumInput = document.getElementById('vrm-camera-angle-x-num') as HTMLInputElement | null;
    const vrmCameraAngleYNumInput = document.getElementById('vrm-camera-angle-y-num') as HTMLInputElement | null;

    const previewSettings: CharacterSettings = {
      window: currentSettings.character.window,
      model: {
        path: modelPathInput?.value || DEFAULT_CHARACTER.model.path,
        scale: parseFloat(modelScaleNumInput?.value || modelScaleInput?.value || '0.2') || 0.2,
        x: parseFloat(modelXNumInput?.value || modelXInput?.value || '0.5') || 0.5,
        y: parseFloat(modelYNumInput?.value || modelYInput?.value || '0') || 0.0,
        anchorX: parseFloat(anchorXInput?.value || '0.5') || 0.5,
        anchorY: parseFloat(anchorYInput?.value || '0') || 0.0
      },
      resolution: currentSettings.character.resolution,
      idleMotion: idleMotionInput?.value || 'Idle',
      tapMotion: tapMotionInput?.value || 'Tap@Body',
      modelType: (modelTypeSelect?.value as 'live2d' | 'vrm') || 'live2d',
      physicsEnabled: physicsEnabledInput?.checked !== false,
      vrm: {
        cameraDistance: parseFloat(vrmCameraDistanceNumInput?.value || '1.5') || 1.5,
        cameraHeight: parseFloat(vrmCameraHeightNumInput?.value || '1.3') || 1.3,
        lightIntensity: parseFloat(vrmLightIntensityNumInput?.value || '1') || 1.0,
        modelX: parseFloat(vrmModelXNumInput?.value || '0') || 0,
        modelY: parseFloat(vrmModelYNumInput?.value || '0') || 0,
        cameraAngleX: parseFloat(vrmCameraAngleXNumInput?.value || '0') || 0,
        cameraAngleY: parseFloat(vrmCameraAngleYNumInput?.value || '0') || 0
      }
    };
    await platform.applyCharacterSettings(previewSettings);
  } catch (err) {
    console.warn('プレビュー更新失敗:', err);
  }
}

export function schedulePreview(): void {
  if (previewTimer) clearTimeout(previewTimer);
  previewTimer = setTimeout(() => applyPreview(), PREVIEW_DEBOUNCE_MS);
}

// ====== Default Character ======
export function getDefaultCharacter(): CharacterSettings {
  return {
    window: { width: 600, height: 600 },
    model: {
      path: '/live2d/models/AvatarSample-A/AvatarSample_A.vrm',
      scale: 0.28, x: 0.5, y: 0.5, anchorX: 0.5, anchorY: 0.5
    },
    resolution: 2,
    idleMotion: 'Idle',
    tapMotion: 'Tap@Body'
  };
}

// ====== Modal Utilities ======
export function modalPrompt(message: string, defaultValue = ''): Promise<string | null> {
  return new Promise(resolve => {
    const overlay = document.createElement('div');
    overlay.className = 'modal-overlay';
    const box = document.createElement('div');
    box.className = 'modal-box';
    const label = document.createElement('div');
    label.textContent = message;
    label.style.marginBottom = '12px';
    const input = document.createElement('input');
    input.type = 'text';
    input.value = defaultValue;
    input.style.marginBottom = '12px';
    const btnRow = document.createElement('div');
    btnRow.className = 'modal-buttons';
    const cancelBtn = document.createElement('button');
    cancelBtn.textContent = t('common.cancel');
    cancelBtn.className = 'btn btn-secondary';
    const okBtn = document.createElement('button');
    okBtn.textContent = t('common.ok');
    okBtn.className = 'btn btn-primary';
    btnRow.append(cancelBtn, okBtn);
    box.append(label, input, btnRow);
    overlay.append(box);
    document.body.append(overlay);
    input.focus();
    input.select();
    const cleanup = (val: string | null) => { overlay.remove(); resolve(val); };
    okBtn.addEventListener('click', () => cleanup(input.value || null));
    cancelBtn.addEventListener('click', () => cleanup(null));
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') cleanup(input.value || null);
      if (e.key === 'Escape') cleanup(null);
    });
    overlay.addEventListener('click', (e) => { if (e.target === overlay) cleanup(null); });
  });
}

export function modalConfirm(message: string): Promise<boolean> {
  return new Promise(resolve => {
    const overlay = document.createElement('div');
    overlay.className = 'modal-overlay';
    const box = document.createElement('div');
    box.className = 'modal-box';
    const label = document.createElement('div');
    label.style.cssText = 'margin-bottom:16px;white-space:pre-wrap';
    label.textContent = message;
    const btnRow = document.createElement('div');
    btnRow.className = 'modal-buttons';
    const cancelBtn = document.createElement('button');
    cancelBtn.textContent = t('common.cancel');
    cancelBtn.className = 'btn btn-secondary';
    const okBtn = document.createElement('button');
    okBtn.textContent = t('common.ok');
    okBtn.className = 'btn btn-danger';
    btnRow.append(cancelBtn, okBtn);
    box.append(label, btnRow);
    overlay.append(box);
    document.body.append(overlay);
    okBtn.focus();
    const cleanup = (val: boolean) => { overlay.remove(); resolve(val); };
    okBtn.addEventListener('click', () => cleanup(true));
    cancelBtn.addEventListener('click', () => cleanup(false));
    overlay.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') cleanup(false);
      if (e.key === 'Enter') cleanup(true);
    });
    overlay.addEventListener('click', (e) => { if (e.target === overlay) cleanup(false); });
  });
}

export function showToast(message: string, durationMs = 2000): void {
  const toast = document.getElementById('toast');
  if (!toast) return;
  toast.textContent = message;
  toast.classList.add('show');
  setTimeout(() => toast.classList.remove('show'), durationMs);
}

export function showStatus(message: string, type: 'success' | 'error'): void {
  const el = document.getElementById('status');
  if (!el) return;
  el.textContent = message;
  el.className = `status ${type}`;
}

// ====== Slider Sync Helper ======
export function syncSliders(rangeId: string, numId: string, onChange?: () => void): void {
  const range = document.getElementById(rangeId) as HTMLInputElement;
  const num = document.getElementById(numId) as HTMLInputElement;
  if (!range || !num) return;
  range.addEventListener('input', () => {
    num.value = range.value;
    onChange?.();
  });
  num.addEventListener('input', () => {
    range.value = num.value;
    onChange?.();
  });
}
