import { platform } from '../platform';
// Settings > Character tab (Live2D/VRM, Motion, DragPad, EmotionMap, Model Presets, Color)
import type { Settings, CharacterSettings, EmotionMapEntry, ModelPreset } from '../types';
import { t } from '../locales';
import {
  modalPrompt, modalConfirm, showToast, showStatus,
  syncSliders, schedulePreview, applyPreview, getDefaultCharacter,
} from './shared';

// DOM elements (set in initTab)
let winWidthInput: HTMLInputElement;
let winHeightInput: HTMLInputElement;
let modelPathInput: HTMLInputElement;
let modelScaleInput: HTMLInputElement;
let modelScaleNumInput: HTMLInputElement;
let modelXInput: HTMLInputElement;
let modelXNumInput: HTMLInputElement;
let modelYInput: HTMLInputElement;
let modelYNumInput: HTMLInputElement;
let resolutionInput: HTMLInputElement;
let resolutionNumInput: HTMLInputElement;
let fpsInput: HTMLInputElement;
let fpsNumInput: HTMLInputElement;
let anchorXInput: HTMLInputElement;
let anchorYInput: HTMLInputElement;
let idleMotionInput: HTMLSelectElement;
let tapMotionInput: HTMLSelectElement;
let physicsEnabledInput: HTMLInputElement;
let browseBtn: HTMLButtonElement;
let lipsyncEnabledInput: HTMLInputElement;
let lipsyncModeSelect: HTMLSelectElement;
let lipsyncDisableMouthFormInput: HTMLInputElement;
let lipsyncScaleInput: HTMLInputElement;
let lipsyncScaleNumInput: HTMLInputElement;
let showCharacterWindowInput: HTMLInputElement;
let modelTypeSelect: HTMLSelectElement;
let live2dModelSettings: HTMLDivElement;
let vrmModelSettings: HTMLDivElement;
let modelPathHint: HTMLDivElement;

let vrmCameraDistanceInput: HTMLInputElement;
let vrmCameraDistanceNumInput: HTMLInputElement;
let vrmCameraHeightInput: HTMLInputElement;
let vrmCameraHeightNumInput: HTMLInputElement;
let vrmLightIntensityInput: HTMLInputElement;
let vrmLightIntensityNumInput: HTMLInputElement;
let vrmModelXInput: HTMLInputElement;
let vrmModelXNumInput: HTMLInputElement;
let vrmModelYInput: HTMLInputElement;
let vrmModelYNumInput: HTMLInputElement;
let vrmCameraAngleXInput: HTMLInputElement;
let vrmCameraAngleXNumInput: HTMLInputElement;
let vrmCameraAngleYInput: HTMLInputElement;
let vrmCameraAngleYNumInput: HTMLInputElement;

let dragPad: HTMLDivElement;
let dragPadCursor: HTMLDivElement;
let dragPadXNum: HTMLInputElement;
let dragPadYNum: HTMLInputElement;
let dragPadXLabel: HTMLLabelElement;
let dragPadYLabel: HTMLLabelElement;
let dragPadHint: HTMLDivElement;
let dragPadModePositionBtn: HTMLButtonElement;
let dragPadModeCameraBtn: HTMLButtonElement;

let modelPresetSelect: HTMLSelectElement;
let modelPresetLoadBtn: HTMLButtonElement;
let modelPresetDeleteBtn: HTMLButtonElement;
let modelPresetSaveBtn: HTMLButtonElement;


let allMotionsSelect: HTMLSelectElement;
let playAllMotionBtn: HTMLButtonElement;

// State
export let originalResolution = 2;
export let originalModelType = 'live2d';
let dragPadMode: 'position' | 'camera' = 'position';
let currentEmotionMap: Record<string, EmotionMapEntry> = {};
let currentStateMotionMap: Record<string, string> = {};
let availableMotionFiles: string[] = [];
let availableMotionGroups: string[] = [];
let allMotionsCache: string[] = [];
let _stateResetTimer: ReturnType<typeof setTimeout> | null = null;
let _exprResetTimer: ReturnType<typeof setTimeout> | null = null;

const DEFAULT_CHARACTER = getDefaultCharacter();

function getDefaultEmotionMap(): Record<string, EmotionMapEntry> {
  return {
    happy:     { motion: '', label: t('settings.character.emotion.happy'), tags: ['joy', 'excited', 'shy', 'embarrassed'] },
    sad:       { motion: '', label: t('settings.character.emotion.sad'), tags: ['cry', 'depressed'] },
    annoyed:   { motion: '', label: t('settings.character.emotion.annoyed'), tags: ['angry', 'frustrated'] },
    surprised: { motion: '', label: t('settings.character.emotion.surprised'), tags: ['shocked'] },
    thinking:  { motion: '', label: t('settings.character.emotion.thinking'), tags: ['hmm'] },
    neutral:   { motion: '', label: t('settings.character.emotion.neutral'), tags: ['tired'] },
  };
}
const DEFAULT_EMOTION_MAP = getDefaultEmotionMap();

// ====== Suggested Tags ======
const SUGGESTED_TAG_KEYS = [
  'joy', 'excited', 'shy', 'embarrassed', 'love', 'proud', 'grateful', 'relieved',
  'cry', 'depressed', 'lonely', 'disappointed', 'angry', 'frustrated', 'irritated',
  'shocked', 'amazed', 'confused', 'puzzled', 'hmm', 'focused', 'serious', 'curious',
  'tired', 'bored', 'sleepy', 'calm', 'nervous', 'scared', 'worried', 'anxious',
  'playful', 'smug', 'mischievous',
];

function getSuggestedTags(): Record<string, string> {
  const tags: Record<string, string> = {};
  for (const key of SUGGESTED_TAG_KEYS) {
    tags[key] = t(`settings.character.emotionTag.${key}`);
  }
  return tags;
}

function getAvailableSuggestedTags(): string[] {
  const used = new Set<string>();
  for (const entry of Object.values(currentEmotionMap)) {
    for (const tg of entry.tags) used.add(tg);
  }
  for (const k of Object.keys(currentEmotionMap)) used.add(k);
  return Object.keys(getSuggestedTags()).filter(tg => !used.has(tg));
}

// ====== Model Type Visibility ======
const DEFAULT_MODEL_PATHS = {
  live2d: '/live2d/models/hiyori_pro/hiyori_pro_zh/runtime/hiyori_pro_t11.model3.json',
  vrm: '/live2d/models/AvatarSample-A/AvatarSample_A.vrm',
};

function updateModelTypeVisibility() {
  const mt = modelTypeSelect.value;
  const isLive2D = mt === 'live2d';
  live2dModelSettings.style.display = isLive2D ? 'block' : 'none';
  vrmModelSettings.style.display = isLive2D ? 'none' : 'block';
  modelPathHint.textContent = isLive2D
    ? t('settings.character.display.modelPathHintLive2d')
    : t('settings.character.display.modelPathHintVrm');
  dragPadModeCameraBtn.style.display = isLive2D ? 'none' : '';
  if (isLive2D && dragPadMode === 'camera') {
    switchDragPadMode('position');
  }
  // Auto-switch model path to default for the selected type
  const currentPath = modelPathInput.value;
  const isWrongExt = isLive2D
    ? currentPath.endsWith('.vrm')
    : currentPath.endsWith('.model3.json') || currentPath.endsWith('.moc3');
  const otherDefault = isLive2D ? DEFAULT_MODEL_PATHS.vrm : DEFAULT_MODEL_PATHS.live2d;
  if (!currentPath || currentPath === otherDefault || isWrongExt) {
    modelPathInput.value = isLive2D ? DEFAULT_MODEL_PATHS.live2d : DEFAULT_MODEL_PATHS.vrm;
  }
}

// ====== Motion Options ======
async function updateMotionOptions(modelPath: string) {
  try {
    const modelMotions: string[] = await (platform as any).listModelMotions(modelPath);
    const allMotions: string[] = await (platform as any).listAllMotions();
    const modelDir = modelPath.replace(/[^/]+$/, '');

    for (const select of [idleMotionInput, tapMotionInput]) {
      const current = select.value;
      select.innerHTML = `<option value="">${t('common.none')}</option>`;

      if (modelMotions.length > 0) {
        const group = document.createElement('optgroup');
        group.label = t('settings.character.motionTest.thisModel');
        for (const m of modelMotions) {
          const opt = document.createElement('option');
          opt.value = m;
          opt.textContent = m.replace('.motion3.json', '');
          group.appendChild(opt);
        }
        select.appendChild(group);
      }

      const modelFullPaths = new Set(modelMotions.map(m => modelDir + m));
      const others = allMotions.filter(p => !modelFullPaths.has(p));
      if (others.length > 0) {
        const groups = new Map<string, string[]>();
        for (const p of others) {
          const parts = p.replace('/live2d/', '').split('/');
          const groupName = parts.length > 2 ? parts.slice(0, -1).join('/') : parts[0];
          if (!groups.has(groupName)) groups.set(groupName, []);
          groups.get(groupName)!.push(p);
        }
        for (const [groupName, paths] of groups) {
          const group = document.createElement('optgroup');
          group.label = groupName;
          for (const p of paths) {
            const opt = document.createElement('option');
            opt.value = p;
            opt.textContent = p.split('/').pop()!.replace('.motion3.json', '');
            group.appendChild(opt);
          }
          select.appendChild(group);
        }
      }

      if (current) {
        if (!select.querySelector(`option[value="${CSS.escape(current)}"]`)) {
          const opt = document.createElement('option');
          opt.value = current;
          opt.textContent = current.split('/').pop()!.replace('.motion3.json', '') + t('settings.character.motionTest.customSuffix');
          select.appendChild(opt);
        }
        select.value = current;
      }
    }
  } catch (err) {
    console.warn('モーション一覧取得失敗:', err);
  }
}

async function browseMotionFile(targetSelect: HTMLSelectElement) {
  const filePath: string | null = await (platform as any).selectMotionFile();
  if (!filePath) return;
  const existing = targetSelect.querySelector(`option[value="${CSS.escape(filePath)}"]`);
  if (!existing) {
    const opt = document.createElement('option');
    opt.value = filePath;
    opt.textContent = filePath.split('/').pop()!.replace('.motion3.json', '');
    targetSelect.appendChild(opt);
  }
  targetSelect.value = filePath;
  schedulePreview();
}

// ====== Motion/Expression Test Buttons ======
async function updateMotionTestButtons(modelPath: string) {
  const groupsContainer = document.getElementById('motion-test-groups')!;
  const filesContainer = document.getElementById('motion-test-files')!;
  const exprContainer = document.getElementById('expression-test-area')!;
  const emptyMsg = document.getElementById('motion-test-empty')!;

  groupsContainer.innerHTML = '';
  filesContainer.innerHTML = '';
  exprContainer.innerHTML = '';

  try {
    const info: { motionGroups: string[]; expressions: string[] } =
      await (platform as any).getModelInfo(modelPath);
    const files: string[] = await (platform as any).listModelMotions(modelPath);
    availableMotionFiles = files;
    availableMotionGroups = info.motionGroups;

    let hasContent = false;

    if (info.motionGroups.length > 0) {
      hasContent = true;
      const label = document.createElement('div');
      label.style.cssText = 'font-size: 11px; color: var(--text-muted); margin-bottom: 6px;';
      label.textContent = t('settings.character.motionTest.motionGroups');
      groupsContainer.appendChild(label);

      const row = document.createElement('div');
      row.style.cssText = 'display: flex; gap: 6px; flex-wrap: wrap; margin-bottom: 10px;';
      for (const group of info.motionGroups) {
        const btn = document.createElement('button');
        btn.className = 'btn btn-secondary';
        btn.style.cssText = 'min-width: 50px; padding: 6px 10px; font-size: 12px;';
        btn.textContent = group;
        btn.addEventListener('click', () => {
          (platform as any).sendMotionTrigger?.(`group:${group}`);
        });
        row.appendChild(btn);
      }
      groupsContainer.appendChild(row);
    }

    if (files.length > 0) {
      hasContent = true;
      const label = document.createElement('div');
      label.style.cssText = 'font-size: 11px; color: var(--text-muted); margin-bottom: 6px;';
      label.textContent = t('settings.character.motionTest.motionFiles');
      filesContainer.appendChild(label);

      const row = document.createElement('div');
      row.style.cssText = 'display: flex; gap: 6px; flex-wrap: wrap; margin-bottom: 10px;';
      for (const file of files) {
        const name = file.replace('.motion3.json', '').replace('motions/', '');
        const btn = document.createElement('button');
        btn.className = 'btn btn-secondary';
        btn.style.cssText = 'min-width: 50px; padding: 6px 10px; font-size: 12px;';
        btn.textContent = name;
        btn.addEventListener('click', () => {
          const stateNames = ['idle', 'talk', 'listen', 'thinking', 'sad'];
          const baseName = name.toLowerCase();
          if (stateNames.includes(baseName)) {
            (platform as any).sendMotionTrigger?.(baseName);
            if (baseName !== 'idle') {
              if (_stateResetTimer) clearTimeout(_stateResetTimer);
              _stateResetTimer = setTimeout(() => {
                (platform as any).sendMotionTrigger?.('idle');
              }, 5000);
            }
          } else {
            (platform as any).sendMotionTrigger?.(`oneshot:${name}`);
          }
        });
        row.appendChild(btn);
      }
      filesContainer.appendChild(row);
    }

    emptyMsg.style.display = hasContent ? 'none' : '';
    renderStateMotionUI();
    renderEmotionMapUI();
  } catch (err) {
    console.warn('テストボタン生成失敗:', err);
    emptyMsg.style.display = '';
  }
}

// ====== All Motions Select ======
async function populateAllMotions() {
  try {
    const all: string[] = await (platform as any).listAllMotions();
    allMotionsSelect.innerHTML = `<option value="">${t('settings.character.motionTest.selectMotion')}</option>`;
    const groups = new Map<string, string[]>();
    for (const p of all) {
      const parts = p.replace('/live2d/', '').split('/');
      const groupName = parts.length > 2 ? parts.slice(0, -1).join('/') : parts[0];
      if (!groups.has(groupName)) groups.set(groupName, []);
      groups.get(groupName)!.push(p);
    }
    for (const [groupName, paths] of groups) {
      const optgroup = document.createElement('optgroup');
      optgroup.label = groupName;
      for (const p of paths) {
        const opt = document.createElement('option');
        opt.value = p;
        opt.textContent = p.split('/').pop()!.replace('.motion3.json', '');
        optgroup.appendChild(opt);
      }
      allMotionsSelect.appendChild(optgroup);
    }
  } catch (err) {
    console.warn('全モーション一覧取得失敗:', err);
  }
}

// ====== State Motion UI ======
const STATE_MOTION_ENTRIES = [
  { key: 'talk', labelKey: 'settings.character.stateMotion.talk' },
  { key: 'thinking', labelKey: 'settings.character.stateMotion.thinking' },
] as const;

async function renderStateMotionUI() {
  const container = document.getElementById('state-motion-container');
  if (!container) return;
  container.innerHTML = '';

  if (allMotionsCache.length === 0) {
    try { allMotionsCache = await (platform as any).listAllMotions() as string[]; } catch { /* ignore */ }
  }

  for (const { key, labelKey } of STATE_MOTION_ENTRIES) {
    const row = document.createElement('div');
    row.style.cssText = 'display: flex; align-items: center; gap: 8px; margin-bottom: 8px;';

    const lbl = document.createElement('label');
    lbl.textContent = t(labelKey);
    lbl.style.cssText = 'min-width: 80px; font-size: 13px;';

    const select = document.createElement('select');
    select.style.cssText = 'flex: 1;';
    select.id = `state-motion-${key}`;

    const defaultOpt = document.createElement('option');
    defaultOpt.value = '';
    defaultOpt.textContent = t('settings.character.stateMotion.continueIdle');
    select.appendChild(defaultOpt);

    if (allMotionsCache.length > 0) {
      const groups = new Map<string, string[]>();
      for (const p of allMotionsCache) {
        const parts = p.replace('/live2d/', '').split('/');
        const groupName = parts.length > 2 ? parts.slice(0, -1).join('/') : t('settings.character.motionTest.other');
        if (!groups.has(groupName)) groups.set(groupName, []);
        groups.get(groupName)!.push(p);
      }
      for (const [groupName, paths] of groups) {
        const optGroup = document.createElement('optgroup');
        optGroup.label = groupName;
        for (const p of paths) {
          const opt = document.createElement('option');
          opt.value = p;
          opt.textContent = p.split('/').pop()!.replace('.motion3.json', '');
          if (p === (currentStateMotionMap[key] || '')) opt.selected = true;
          optGroup.appendChild(opt);
        }
        select.appendChild(optGroup);
      }
    }

    select.addEventListener('change', () => {
      if (select.value) { currentStateMotionMap[key] = select.value; }
      else { delete currentStateMotionMap[key]; }
    });

    const testBtn = document.createElement('button');
    testBtn.className = 'btn btn-secondary';
    testBtn.style.cssText = 'font-size: 11px; padding: 3px 8px; white-space: nowrap;';
    testBtn.textContent = t('common.test');
    testBtn.addEventListener('click', () => {
      if (select.value) (platform as any).sendMotionTrigger?.(`play:${select.value}`);
    });

    row.appendChild(lbl);
    row.appendChild(select);
    row.appendChild(testBtn);
    container.appendChild(row);
  }
}

// ====== Emotion Map UI ======
async function renderEmotionMapUI() {
  const container = document.getElementById('emotion-map-container');
  if (!container) return;
  container.innerHTML = '';

  if (allMotionsCache.length === 0) {
    try { allMotionsCache = await (platform as any).listAllMotions() as string[]; } catch { /* ignore */ }
  }
  if (availableMotionFiles.length === 0 || availableMotionGroups.length === 0) {
    const modelPath = modelPathInput?.value;
    if (modelPath) {
      try {
        const [files, info] = await Promise.all([
          (platform as any).listModelMotions(modelPath) as Promise<string[]>,
          (platform as any).getModelInfo(modelPath) as Promise<{ motionGroups: string[]; expressions: string[] }>,
        ]);
        if (files.length > 0) availableMotionFiles = files;
        if (info.motionGroups.length > 0) availableMotionGroups = info.motionGroups;
      } catch { /* ignore */ }
    }
  }

  for (const [key, entry] of Object.entries(currentEmotionMap)) {
    const card = document.createElement('div');
    card.className = 'emotion-card';
    card.dataset.emotionKey = key;

    const header = document.createElement('div');
    header.className = 'emotion-card-header';

    const titleArea = document.createElement('div');
    titleArea.style.cssText = 'display: flex; align-items: baseline; gap: 6px; flex: 1; min-width: 0;';
    const labelSpan = document.createElement('span');
    labelSpan.style.cssText = 'font-size: 14px; font-weight: 600; color: var(--text); cursor: pointer;';
    const i18nLabel = t(`settings.character.emotionMap.label.${key}`);
    labelSpan.textContent = (i18nLabel && !i18nLabel.startsWith('settings.')) ? i18nLabel : entry.label;
    labelSpan.title = t('settings.character.emotionMap.renamePrompt');
    labelSpan.addEventListener('click', async () => {
      const newLabel = await modalPrompt(t('settings.character.emotionMap.renamePrompt'), entry.label);
      if (newLabel !== null && newLabel.trim()) {
        entry.label = newLabel.trim();
        labelSpan.textContent = entry.label;
      }
    });
    titleArea.appendChild(labelSpan);

    const testBtn = document.createElement('button');
    testBtn.className = 'btn btn-secondary';
    testBtn.style.cssText = 'font-size: 11px; padding: 3px 8px;';
    testBtn.textContent = t('common.test');
    testBtn.addEventListener('click', () => {
      (platform as any).sendExpressionChange?.(key);
    });

    const deleteBtn = document.createElement('button');
    deleteBtn.className = 'btn btn-secondary';
    deleteBtn.style.cssText = 'font-size: 11px; padding: 3px 8px; color: #f87171;';
    deleteBtn.textContent = t('common.delete');
    deleteBtn.addEventListener('click', () => {
      delete currentEmotionMap[key];
      renderEmotionMapUI();
    });

    header.appendChild(titleArea);
    header.appendChild(testBtn);
    header.appendChild(deleteBtn);
    card.appendChild(header);

    const body = document.createElement('div');
    body.className = 'emotion-card-body';

    // Motion select row
    const motionRow = document.createElement('div');
    motionRow.className = 'emotion-card-row';
    const motionLabel = document.createElement('label');
    motionLabel.textContent = t('settings.character.emotionMap.motion');
    const motionSelect = document.createElement('select');
    const defaultOpt = document.createElement('option');
    defaultOpt.value = '';
    defaultOpt.textContent = t('settings.character.emotionMap.defaultMotion');
    motionSelect.appendChild(defaultOpt);
    if (availableMotionGroups.length > 0) {
      const grpOptGroup = document.createElement('optgroup');
      grpOptGroup.label = t('settings.character.emotionMap.groupBuiltin');
      for (const g of availableMotionGroups) {
        const opt = document.createElement('option');
        opt.value = `group:${g}`;
        opt.textContent = g;
        if (`group:${g}` === entry.motion) opt.selected = true;
        grpOptGroup.appendChild(opt);
      }
      motionSelect.appendChild(grpOptGroup);
    }
    if (allMotionsCache.length > 0) {
      const groups = new Map<string, string[]>();
      for (const p of allMotionsCache) {
        const parts = p.replace('/live2d/', '').split('/');
        const groupName = parts.length > 2 ? parts.slice(0, -1).join('/') : t('settings.character.motionTest.other');
        if (!groups.has(groupName)) groups.set(groupName, []);
        groups.get(groupName)!.push(p);
      }
      for (const [groupName, paths] of groups) {
        const optGroup = document.createElement('optgroup');
        optGroup.label = groupName;
        for (const p of paths) {
          const opt = document.createElement('option');
          opt.value = p;
          opt.textContent = p.split('/').pop()!.replace('.motion3.json', '');
          if (p === entry.motion) opt.selected = true;
          optGroup.appendChild(opt);
        }
        motionSelect.appendChild(optGroup);
      }
    } else if (availableMotionFiles.length > 0) {
      const fileOptGroup = document.createElement('optgroup');
      fileOptGroup.label = t('settings.character.motionTest.motionFiles');
      for (const f of availableMotionFiles) {
        const opt = document.createElement('option');
        opt.value = f;
        opt.textContent = f.replace('.motion3.json', '').replace(/^(motions|motion|states)\//, '');
        if (f === entry.motion) opt.selected = true;
        fileOptGroup.appendChild(opt);
      }
      motionSelect.appendChild(fileOptGroup);
    }
    motionSelect.addEventListener('change', () => { entry.motion = motionSelect.value; });
    motionRow.appendChild(motionLabel);
    motionRow.appendChild(motionSelect);
    body.appendChild(motionRow);

    // Tags row
    const tagRow = document.createElement('div');
    tagRow.className = 'emotion-card-row';
    const tagLabel = document.createElement('label');
    tagLabel.textContent = t('settings.character.emotionMap.aiTags');
    const tagsContainer = document.createElement('div');
    tagsContainer.className = 'emotion-tags';

    let suggestPanel: HTMLDivElement | null = null;
    function renderTags() {
      tagsContainer.innerHTML = '';
      for (let i = 0; i < entry.tags.length; i++) {
        const chip = document.createElement('span');
        chip.className = 'emotion-tag';
        const tagText = getSuggestedTags()[entry.tags[i]]
          ? `${entry.tags[i]} (${getSuggestedTags()[entry.tags[i]]})`
          : entry.tags[i];
        chip.innerHTML = `${tagText}<span class="tag-remove">\u00d7</span>`;
        chip.querySelector('.tag-remove')!.addEventListener('click', () => {
          entry.tags.splice(i, 1);
          renderTags();
        });
        tagsContainer.appendChild(chip);
      }
      const addChip = document.createElement('span');
      addChip.className = 'emotion-tag-add';
      addChip.textContent = '+';
      addChip.addEventListener('click', () => {
        if (suggestPanel) { suggestPanel.remove(); suggestPanel = null; return; }
        suggestPanel = document.createElement('div');
        suggestPanel.style.cssText = 'display: flex; flex-wrap: wrap; gap: 4px; padding: 8px; background: var(--bg-secondary); border: 1px solid var(--border); border-radius: 6px; margin-top: 6px;';

        const available = getAvailableSuggestedTags();
        for (const tag of available) {
          const sChip = document.createElement('span');
          sChip.className = 'emotion-tag';
          sChip.style.cursor = 'pointer';
          sChip.textContent = `${tag} (${getSuggestedTags()[tag]})`;
          sChip.addEventListener('click', () => {
            entry.tags.push(tag);
            if (suggestPanel) { suggestPanel.remove(); suggestPanel = null; }
            renderTags();
          });
          suggestPanel.appendChild(sChip);
        }

        const customInput = document.createElement('input');
        customInput.type = 'text';
        customInput.placeholder = t('settings.character.emotionMap.customTagPlaceholder');
        customInput.style.cssText = 'font-size: 11px; padding: 2px 6px; border: 1px solid var(--border); border-radius: 10px; background: var(--bg-tertiary); color: var(--text); width: 100px;';
        customInput.addEventListener('keydown', (e) => {
          if (e.key === 'Enter' && customInput.value.trim()) {
            entry.tags.push(customInput.value.trim().toLowerCase());
            if (suggestPanel) { suggestPanel.remove(); suggestPanel = null; }
            renderTags();
          }
        });
        suggestPanel.appendChild(customInput);

        card.appendChild(suggestPanel);
      });
      tagsContainer.appendChild(addChip);
    }
    renderTags();

    tagRow.appendChild(tagLabel);
    tagRow.appendChild(tagsContainer);
    body.appendChild(tagRow);

    card.appendChild(body);
    container.appendChild(card);
  }
}


// ====== Drag Pad ======
function clamp(v: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, v));
}

function setSliderAndNum(sliderId: string, numId: string, val: string) {
  const s = document.getElementById(sliderId) as HTMLInputElement | null;
  const n = document.getElementById(numId) as HTMLInputElement | null;
  if (s) s.value = val;
  if (n) n.value = val;
}

function switchDragPadMode(mode: 'position' | 'camera') {
  dragPadMode = mode;
  dragPadModePositionBtn.classList.toggle('active', mode === 'position');
  dragPadModeCameraBtn.classList.toggle('active', mode === 'camera');
  updateDragPadLabelsAndValues();
  updateDragPadCursor();
}

function updateDragPadLabelsAndValues() {
  const isLive2D = modelTypeSelect.value !== 'vrm';
  if (dragPadMode === 'position') {
    dragPadXLabel.textContent = 'X';
    dragPadYLabel.textContent = 'Y';
    if (isLive2D) {
      dragPadXNum.min = '-0.5'; dragPadXNum.max = '1.5'; dragPadXNum.step = '0.01';
      dragPadYNum.min = '-0.5'; dragPadYNum.max = '1.5'; dragPadYNum.step = '0.01';
      dragPadXNum.value = modelXInput.value;
      dragPadYNum.value = modelYInput.value;
      dragPadHint.textContent = t('settings.character.display.padHintPositionLive2d');
    } else {
      dragPadXNum.min = '-1'; dragPadXNum.max = '1'; dragPadXNum.step = '0.01';
      dragPadYNum.min = '-1'; dragPadYNum.max = '1'; dragPadYNum.step = '0.01';
      dragPadXNum.value = vrmModelXInput.value;
      dragPadYNum.value = vrmModelYInput.value;
      dragPadHint.textContent = t('settings.character.display.padHintPositionVrm');
    }
  } else {
    if (isLive2D) {
      dragPadXLabel.textContent = t('settings.character.display.padLabelScale');
      dragPadYLabel.textContent = t('settings.character.display.padLabelAnchorY');
      dragPadXNum.min = '0.05'; dragPadXNum.max = '1'; dragPadXNum.step = '0.01';
      dragPadYNum.min = '0'; dragPadYNum.max = '1'; dragPadYNum.step = '0.1';
      dragPadXNum.value = modelScaleInput.value;
      dragPadYNum.value = anchorYInput.value;
      dragPadHint.textContent = t('settings.character.display.padHintCameraLive2d');
    } else {
      dragPadXLabel.textContent = t('settings.character.display.padLabelAngleX');
      dragPadYLabel.textContent = t('settings.character.display.padLabelAngleY');
      dragPadXNum.min = '-180'; dragPadXNum.max = '180'; dragPadXNum.step = '1';
      dragPadYNum.min = '-60'; dragPadYNum.max = '60'; dragPadYNum.step = '1';
      dragPadXNum.value = vrmCameraAngleXInput.value;
      dragPadYNum.value = vrmCameraAngleYInput.value;
      dragPadHint.textContent = t('settings.character.display.padHintCameraVrm');
    }
  }
}

function updateDragPadCursor() {
  if (!dragPad || !dragPadCursor) return;
  const rect = dragPad.getBoundingClientRect();
  if (rect.width === 0 || rect.height === 0) return;
  const isLive2D = modelTypeSelect.value !== 'vrm';
  let ratioX: number, ratioY: number;

  if (dragPadMode === 'position') {
    if (isLive2D) {
      ratioX = ((parseFloat(modelXInput.value) ?? 0.5) + 0.5) / 2.0;
      ratioY = ((parseFloat(modelYInput.value) ?? 0.5) + 0.5) / 2.0;
    } else {
      const xVal = parseFloat(vrmModelXInput.value) || 0;
      const yVal = parseFloat(vrmModelYInput.value) || 0;
      ratioX = (xVal + 1) / 2;
      ratioY = 1 - (yVal + 1) / 2;
    }
  } else {
    if (isLive2D) {
      const scaleVal = parseFloat(modelScaleInput.value) || 0.2;
      const anchorVal = parseFloat(anchorYInput.value) || 0;
      ratioX = (scaleVal - 0.05) / 0.95;
      ratioY = 1 - anchorVal;
    } else {
      const axVal = parseFloat(vrmCameraAngleXInput.value) || 0;
      const ayVal = parseFloat(vrmCameraAngleYInput.value) || 0;
      ratioX = (axVal + 180) / 360;
      ratioY = 1 - (ayVal + 60) / 120;
    }
  }

  dragPadCursor.style.left = `${clamp(ratioX, 0, 1) * rect.width}px`;
  dragPadCursor.style.top = `${clamp(ratioY, 0, 1) * rect.height}px`;
  updateDragPadLabelsAndValues();
}

function onDragPadMove(e: MouseEvent) {
  if (!dragPad) return;
  const rect = dragPad.getBoundingClientRect();
  const ratioX = clamp((e.clientX - rect.left) / rect.width, 0, 1);
  const ratioY = clamp((e.clientY - rect.top) / rect.height, 0, 1);
  const isLive2D = modelTypeSelect.value !== 'vrm';

  if (dragPadMode === 'position') {
    if (isLive2D) {
      setSliderAndNum('model-x', 'model-x-num', (clamp(ratioX * 2.0 - 0.5, -0.5, 1.5)).toFixed(2));
      setSliderAndNum('model-y', 'model-y-num', (clamp(ratioY * 2.0 - 0.5, -0.5, 1.5)).toFixed(2));
    } else {
      setSliderAndNum('vrm-model-x', 'vrm-model-x-num', (ratioX * 2 - 1).toFixed(2));
      setSliderAndNum('vrm-model-y', 'vrm-model-y-num', ((1 - ratioY) * 2 - 1).toFixed(2));
    }
  } else {
    if (isLive2D) {
      setSliderAndNum('model-scale', 'model-scale-num', (ratioX * 0.95 + 0.05).toFixed(2));
      anchorYInput.value = (1 - ratioY).toFixed(1);
    } else {
      setSliderAndNum('vrm-camera-angle-x', 'vrm-camera-angle-x-num', String(Math.round(ratioX * 360 - 180)));
      setSliderAndNum('vrm-camera-angle-y', 'vrm-camera-angle-y-num', String(Math.round((1 - ratioY) * 120 - 60)));
    }
  }

  updateDragPadCursor();
  applyPreview();
}

function onDragPadWheel(e: WheelEvent) {
  const isLive2D = modelTypeSelect.value !== 'vrm';
  const delta = e.deltaY > 0 ? -1 : 1;

  if (dragPadMode === 'position') {
    if (isLive2D) {
      const current = parseFloat(modelScaleInput.value) || 0.2;
      setSliderAndNum('model-scale', 'model-scale-num', clamp(current + delta * 0.01, 0.05, 1).toFixed(2));
    } else {
      const current = parseFloat(vrmCameraDistanceInput.value) || 1.5;
      setSliderAndNum('vrm-camera-distance', 'vrm-camera-distance-num', clamp(current - delta * 0.1, 0.5, 5).toFixed(1));
    }
  } else {
    if (isLive2D) {
      const current = parseFloat(modelScaleInput.value) || 0.2;
      setSliderAndNum('model-scale', 'model-scale-num', clamp(current + delta * 0.01, 0.05, 1).toFixed(2));
    } else {
      const current = parseFloat(vrmCameraDistanceInput.value) || 1.5;
      setSliderAndNum('vrm-camera-distance', 'vrm-camera-distance-num', clamp(current - delta * 0.1, 0.5, 5).toFixed(1));
    }
  }

  applyPreview();
}

function onDragPadNumInput() {
  const isLive2D = modelTypeSelect.value !== 'vrm';
  const xVal = parseFloat(dragPadXNum.value) || 0;
  const yVal = parseFloat(dragPadYNum.value) || 0;

  if (dragPadMode === 'position') {
    if (isLive2D) {
      setSliderAndNum('model-x', 'model-x-num', xVal.toFixed(2));
      setSliderAndNum('model-y', 'model-y-num', yVal.toFixed(2));
    } else {
      setSliderAndNum('vrm-model-x', 'vrm-model-x-num', xVal.toFixed(2));
      setSliderAndNum('vrm-model-y', 'vrm-model-y-num', yVal.toFixed(2));
    }
  } else {
    if (isLive2D) {
      setSliderAndNum('model-scale', 'model-scale-num', xVal.toFixed(2));
      anchorYInput.value = yVal.toFixed(1);
    } else {
      setSliderAndNum('vrm-camera-angle-x', 'vrm-camera-angle-x-num', String(Math.round(xVal)));
      setSliderAndNum('vrm-camera-angle-y', 'vrm-camera-angle-y-num', String(Math.round(yVal)));
    }
  }

  updateDragPadCursor();
  applyPreview();
}

// ====== Model Presets ======
async function populateModelPresets() {
  try {
    const presets: ModelPreset[] = await platform.getModelPresets();
    modelPresetSelect.innerHTML = `<option value="">${t('settings.character.preset.select')}</option>`;
    for (const preset of presets) {
      const opt = document.createElement('option');
      opt.value = preset.id;
      opt.textContent = preset.name;
      modelPresetSelect.appendChild(opt);
    }
  } catch (err) {
    console.error('モデルプリセット読み込み失敗:', err);
  }
}

function collectCurrentCharacterSettings(): CharacterSettings {
  return {
    window: { width: parseInt(winWidthInput.value) || 300, height: parseInt(winHeightInput.value) || 200 },
    model: {
      path: modelPathInput.value || '/live2d/models/AvatarSample-A/AvatarSample_A.vrm',
      scale: parseFloat(modelScaleNumInput.value || modelScaleInput.value) || 0.2,
      x: parseFloat(modelXNumInput.value || modelXInput.value) || 0.5,
      y: parseFloat(modelYNumInput.value || modelYInput.value) || 0.0,
      anchorX: parseFloat(anchorXInput.value) || 0.5,
      anchorY: parseFloat(anchorYInput.value) || 0.0
    },
    resolution: parseFloat(resolutionNumInput.value || resolutionInput.value) || 2,
    fps: parseInt(fpsNumInput.value || fpsInput.value) || 30,
    idleMotion: idleMotionInput.value || 'Idle',
    tapMotion: tapMotionInput.value || 'Tap@Body',
    modelType: modelTypeSelect.value as 'live2d' | 'vrm',
    physicsEnabled: physicsEnabledInput.checked,
    stateMotionMap: { ...currentStateMotionMap },
    emotionMap: { ...currentEmotionMap },
    vrm: {
      cameraDistance: parseFloat(vrmCameraDistanceNumInput.value) || 1.5,
      cameraHeight: parseFloat(vrmCameraHeightNumInput.value) || 1.3,
      lightIntensity: parseFloat(vrmLightIntensityNumInput.value) || 1.0,
      modelX: parseFloat(vrmModelXNumInput.value) || 0,
      modelY: parseFloat(vrmModelYNumInput.value) || 0,
      cameraAngleX: parseFloat(vrmCameraAngleXNumInput.value) || 0,
      cameraAngleY: parseFloat(vrmCameraAngleYNumInput.value) || 0
    }
  };
}

async function applyCharacterSettingsToForm(char: CharacterSettings) {
  showCharacterWindowInput.checked = char.showWindow !== false;
  modelTypeSelect.value = char.modelType || 'live2d';
  winWidthInput.value = String(char.window.width);
  winHeightInput.value = String(char.window.height);
  modelPathInput.value = char.model.path;
  modelScaleInput.value = String(char.model.scale);
  modelScaleNumInput.value = String(char.model.scale);
  modelXInput.value = String(char.model.x);
  modelXNumInput.value = String(char.model.x);
  modelYInput.value = String(char.model.y);
  modelYNumInput.value = String(char.model.y);
  resolutionInput.value = String(char.resolution || 2);
  resolutionNumInput.value = String(char.resolution || 2);
  fpsInput.value = String(char.fps || 30);
  fpsNumInput.value = String(char.fps || 30);
  anchorXInput.value = String(char.model.anchorX);
  anchorYInput.value = String(char.model.anchorY);
  await updateMotionOptions(char.model.path);
  currentStateMotionMap = char.stateMotionMap ? { ...char.stateMotionMap } : {};
  if (char.emotionMap && Object.keys(char.emotionMap).length > 0) {
    currentEmotionMap = JSON.parse(JSON.stringify(char.emotionMap));
  } else {
    currentEmotionMap = JSON.parse(JSON.stringify(DEFAULT_EMOTION_MAP));
  }
  await updateMotionTestButtons(char.model.path);
  idleMotionInput.value = char.idleMotion || '';
  tapMotionInput.value = char.tapMotion || '';
  physicsEnabledInput.checked = char.physicsEnabled !== false;
  lipsyncDisableMouthFormInput.checked = char.disableMouthForm ?? false;
  const vrm = char.vrm || { cameraDistance: 1.5, cameraHeight: 1.3, lightIntensity: 1.0, modelX: 0, modelY: 0 };
  vrmCameraDistanceInput.value = String(vrm.cameraDistance);
  vrmCameraDistanceNumInput.value = String(vrm.cameraDistance);
  vrmCameraHeightInput.value = String(vrm.cameraHeight);
  vrmCameraHeightNumInput.value = String(vrm.cameraHeight);
  vrmLightIntensityInput.value = String(vrm.lightIntensity);
  vrmLightIntensityNumInput.value = String(vrm.lightIntensity);
  vrmModelXInput.value = String(vrm.modelX ?? 0);
  vrmModelXNumInput.value = String(vrm.modelX ?? 0);
  vrmModelYInput.value = String(vrm.modelY ?? 0);
  vrmModelYNumInput.value = String(vrm.modelY ?? 0);
  vrmCameraAngleXInput.value = String(vrm.cameraAngleX ?? 0);
  vrmCameraAngleXNumInput.value = String(vrm.cameraAngleX ?? 0);
  vrmCameraAngleYInput.value = String(vrm.cameraAngleY ?? 0);
  vrmCameraAngleYNumInput.value = String(vrm.cameraAngleY ?? 0);
  updateModelTypeVisibility();
  schedulePreview();
}

async function saveModelPreset() {
  const name = await modalPrompt(t('settings.character.preset.namePrompt'));
  if (!name) return;
  const char = collectCurrentCharacterSettings();
  const preset: ModelPreset = { id: crypto.randomUUID(), name, character: char, createdAt: new Date().toISOString() };
  try {
    await platform.saveModelPreset(preset);
    showToast(t('settings.character.preset.saved', { name }));
    await populateModelPresets();
    modelPresetSelect.value = preset.id;
  } catch (err) {
    console.error('モデルプリセット保存失敗:', err);
    showStatus(t('settings.character.preset.saveFailed'), 'error');
  }
}

async function loadSelectedModelPreset() {
  const presetId = modelPresetSelect.value;
  if (!presetId) return;
  try {
    const presets: ModelPreset[] = await platform.getModelPresets();
    const preset = presets.find(p => p.id === presetId);
    if (!preset) return;
    applyCharacterSettingsToForm(preset.character);
    showToast(t('settings.character.preset.loaded', { name: preset.name }));
  } catch (err) {
    console.error('モデルプリセット読込失敗:', err);
  }
}

async function deleteSelectedModelPreset() {
  const presetId = modelPresetSelect.value;
  if (!presetId) return;
  const selectedName = modelPresetSelect.selectedOptions[0]?.textContent || presetId;
  if (!await modalConfirm(t('settings.character.preset.deleteConfirm', { name: selectedName }))) return;
  try {
    await platform.deleteModelPreset(presetId);
    showToast(t('settings.character.preset.deleted'));
    await populateModelPresets();
  } catch (err) {
    console.error('Model preset delete failed:', err);
    showStatus(t('settings.character.preset.deleteFailed'), 'error');
  }
}

// ====== initTab ======
export async function initTab(settings: Settings): Promise<void> {
  const char = settings.character || DEFAULT_CHARACTER;

  // Get all DOM elements
  winWidthInput = document.getElementById('win-width') as HTMLInputElement;
  winHeightInput = document.getElementById('win-height') as HTMLInputElement;
  modelPathInput = document.getElementById('model-path') as HTMLInputElement;
  modelScaleInput = document.getElementById('model-scale') as HTMLInputElement;
  modelScaleNumInput = document.getElementById('model-scale-num') as HTMLInputElement;
  modelXInput = document.getElementById('model-x') as HTMLInputElement;
  modelXNumInput = document.getElementById('model-x-num') as HTMLInputElement;
  modelYInput = document.getElementById('model-y') as HTMLInputElement;
  modelYNumInput = document.getElementById('model-y-num') as HTMLInputElement;
  resolutionInput = document.getElementById('resolution') as HTMLInputElement;
  resolutionNumInput = document.getElementById('resolution-num') as HTMLInputElement;
  fpsInput = document.getElementById('fps') as HTMLInputElement;
  fpsNumInput = document.getElementById('fps-num') as HTMLInputElement;
  anchorXInput = document.getElementById('anchor-x') as HTMLInputElement;
  anchorYInput = document.getElementById('anchor-y') as HTMLInputElement;
  idleMotionInput = document.getElementById('idle-motion') as HTMLSelectElement;
  tapMotionInput = document.getElementById('tap-motion') as HTMLSelectElement;
  physicsEnabledInput = document.getElementById('physics-enabled') as HTMLInputElement;
  browseBtn = document.getElementById('browse-btn') as HTMLButtonElement;
  lipsyncEnabledInput = document.getElementById('lipsync-enabled') as HTMLInputElement;
  lipsyncModeSelect = document.getElementById('lipsync-mode') as HTMLSelectElement;
  lipsyncDisableMouthFormInput = document.getElementById('lipsync-disable-mouth-form') as HTMLInputElement;
  lipsyncScaleInput = document.getElementById('lipsync-scale') as HTMLInputElement;
  lipsyncScaleNumInput = document.getElementById('lipsync-scale-num') as HTMLInputElement;
  showCharacterWindowInput = document.getElementById('show-character-window') as HTMLInputElement;
  modelTypeSelect = document.getElementById('model-type') as HTMLSelectElement;
  live2dModelSettings = document.getElementById('live2d-model-settings') as HTMLDivElement;
  vrmModelSettings = document.getElementById('vrm-model-settings') as HTMLDivElement;
  modelPathHint = document.getElementById('model-path-hint') as HTMLDivElement;

  vrmCameraDistanceInput = document.getElementById('vrm-camera-distance') as HTMLInputElement;
  vrmCameraDistanceNumInput = document.getElementById('vrm-camera-distance-num') as HTMLInputElement;
  vrmCameraHeightInput = document.getElementById('vrm-camera-height') as HTMLInputElement;
  vrmCameraHeightNumInput = document.getElementById('vrm-camera-height-num') as HTMLInputElement;
  vrmLightIntensityInput = document.getElementById('vrm-light-intensity') as HTMLInputElement;
  vrmLightIntensityNumInput = document.getElementById('vrm-light-intensity-num') as HTMLInputElement;
  vrmModelXInput = document.getElementById('vrm-model-x') as HTMLInputElement;
  vrmModelXNumInput = document.getElementById('vrm-model-x-num') as HTMLInputElement;
  vrmModelYInput = document.getElementById('vrm-model-y') as HTMLInputElement;
  vrmModelYNumInput = document.getElementById('vrm-model-y-num') as HTMLInputElement;
  vrmCameraAngleXInput = document.getElementById('vrm-camera-angle-x') as HTMLInputElement;
  vrmCameraAngleXNumInput = document.getElementById('vrm-camera-angle-x-num') as HTMLInputElement;
  vrmCameraAngleYInput = document.getElementById('vrm-camera-angle-y') as HTMLInputElement;
  vrmCameraAngleYNumInput = document.getElementById('vrm-camera-angle-y-num') as HTMLInputElement;

  dragPad = document.getElementById('drag-pad') as HTMLDivElement;
  dragPadCursor = document.getElementById('drag-pad-cursor') as HTMLDivElement;
  dragPadXNum = document.getElementById('drag-pad-x-num') as HTMLInputElement;
  dragPadYNum = document.getElementById('drag-pad-y-num') as HTMLInputElement;
  dragPadXLabel = document.getElementById('drag-pad-x-label') as HTMLLabelElement;
  dragPadYLabel = document.getElementById('drag-pad-y-label') as HTMLLabelElement;
  dragPadHint = document.getElementById('drag-pad-hint') as HTMLDivElement;
  dragPadModePositionBtn = document.getElementById('drag-pad-mode-position') as HTMLButtonElement;
  dragPadModeCameraBtn = document.getElementById('drag-pad-mode-camera') as HTMLButtonElement;

  modelPresetSelect = document.getElementById('model-preset-select') as HTMLSelectElement;
  modelPresetLoadBtn = document.getElementById('model-preset-load-btn') as HTMLButtonElement;
  modelPresetDeleteBtn = document.getElementById('model-preset-delete-btn') as HTMLButtonElement;
  modelPresetSaveBtn = document.getElementById('model-preset-save-btn') as HTMLButtonElement;


  allMotionsSelect = document.getElementById('all-motions-select') as HTMLSelectElement;
  playAllMotionBtn = document.getElementById('play-all-motion-btn') as HTMLButtonElement;

  // ---- Character ----
  winWidthInput.value = String(char.window.width);
  winHeightInput.value = String(char.window.height);
  modelPathInput.value = char.model.path;
  modelScaleInput.value = String(char.model.scale);
  modelScaleNumInput.value = String(char.model.scale);
  modelXInput.value = String(char.model.x);
  modelXNumInput.value = String(char.model.x);
  modelYInput.value = String(char.model.y);
  modelYNumInput.value = String(char.model.y);
  resolutionInput.value = String(char.resolution || 2);
  resolutionNumInput.value = String(char.resolution || 2);
  fpsInput.value = String(char.fps || 30);
  fpsNumInput.value = String(char.fps || 30);
  originalResolution = char.resolution || 2;
  anchorXInput.value = String(char.model.anchorX);
  anchorYInput.value = String(char.model.anchorY);

  // emotionMap復元
  if (char.emotionMap && Object.keys(char.emotionMap).length > 0) {
    currentEmotionMap = JSON.parse(JSON.stringify(char.emotionMap));
  } else {
    currentEmotionMap = JSON.parse(JSON.stringify(DEFAULT_EMOTION_MAP));
  }

  await updateMotionOptions(char.model.path);
  idleMotionInput.value = char.idleMotion || '';
  tapMotionInput.value = char.tapMotion || '';

  // Show character window
  showCharacterWindowInput.checked = char.showWindow !== false;

  // VRM / モデルタイプ
  modelTypeSelect.value = char.modelType || 'live2d';
  originalModelType = modelTypeSelect.value;
  const vrm = char.vrm || { cameraDistance: 1.5, cameraHeight: 1.3, lightIntensity: 1.0, modelX: 0, modelY: 0 };
  vrmCameraDistanceInput.value = String(vrm.cameraDistance);
  vrmCameraDistanceNumInput.value = String(vrm.cameraDistance);
  vrmCameraHeightInput.value = String(vrm.cameraHeight);
  vrmCameraHeightNumInput.value = String(vrm.cameraHeight);
  vrmLightIntensityInput.value = String(vrm.lightIntensity);
  vrmLightIntensityNumInput.value = String(vrm.lightIntensity);
  vrmModelXInput.value = String(vrm.modelX ?? 0);
  vrmModelXNumInput.value = String(vrm.modelX ?? 0);
  vrmModelYInput.value = String(vrm.modelY ?? 0);
  vrmModelYNumInput.value = String(vrm.modelY ?? 0);
  vrmCameraAngleXInput.value = String(vrm.cameraAngleX ?? 0);
  vrmCameraAngleXNumInput.value = String(vrm.cameraAngleX ?? 0);
  vrmCameraAngleYInput.value = String(vrm.cameraAngleY ?? 0);
  vrmCameraAngleYNumInput.value = String(vrm.cameraAngleY ?? 0);
  updateModelTypeVisibility();

  modelTypeSelect.addEventListener('change', () => { updateModelTypeVisibility(); schedulePreview(); });
  lipsyncEnabledInput.checked = settings.lipSync?.enabled ?? true;
  lipsyncModeSelect.value = settings.lipSync?.mode ?? 'simple';
  lipsyncDisableMouthFormInput.checked = char.disableMouthForm ?? false;
  lipsyncScaleInput.value = String(char.lipSyncScale ?? 1.0);
  lipsyncScaleNumInput.value = String(char.lipSyncScale ?? 1.0);
  physicsEnabledInput.checked = char.physicsEnabled !== false;

  // Motion test buttons
  await updateMotionTestButtons(char.model.path);
  await populateAllMotions();
  playAllMotionBtn.addEventListener('click', () => {
    const selected = allMotionsSelect.value;
    if (selected) (platform as any).sendMotionTrigger?.(`file:${selected}`);
  });

  // Add emotion button
  document.getElementById('add-emotion-btn')?.addEventListener('click', async () => {
    const label = await modalPrompt(t('settings.character.emotionMap.addPrompt'));
    if (!label || !label.trim()) return;
    let idx = 0;
    while (currentEmotionMap[`emotion_${idx}`]) idx++;
    const key = `emotion_${idx}`;
    currentEmotionMap[key] = { motion: '', label: label.trim(), tags: [] };
    renderEmotionMapUI();
  });

  // Slider syncs
  syncSliders('model-scale', 'model-scale-num', schedulePreview);
  syncSliders('model-x', 'model-x-num', schedulePreview);
  syncSliders('model-y', 'model-y-num', schedulePreview);
  syncSliders('resolution', 'resolution-num');
  syncSliders('fps', 'fps-num', schedulePreview);
  syncSliders('lipsync-scale', 'lipsync-scale-num');
  syncSliders('vrm-camera-distance', 'vrm-camera-distance-num', schedulePreview);
  syncSliders('vrm-camera-height', 'vrm-camera-height-num', schedulePreview);
  syncSliders('vrm-light-intensity', 'vrm-light-intensity-num', schedulePreview);
  syncSliders('vrm-model-x', 'vrm-model-x-num', schedulePreview);
  syncSliders('vrm-model-y', 'vrm-model-y-num', schedulePreview);
  syncSliders('vrm-camera-angle-x', 'vrm-camera-angle-x-num', schedulePreview);
  syncSliders('vrm-camera-angle-y', 'vrm-camera-angle-y-num', schedulePreview);
  anchorXInput?.addEventListener('input', schedulePreview);
  anchorYInput?.addEventListener('input', schedulePreview);
  idleMotionInput?.addEventListener('change', schedulePreview);
  tapMotionInput?.addEventListener('change', schedulePreview);
  document.getElementById('idle-motion-browse')?.addEventListener('click', () => browseMotionFile(idleMotionInput));
  document.getElementById('tap-motion-browse')?.addEventListener('click', () => browseMotionFile(tapMotionInput));

  // ---- Drag Pad ----
  let isDragPadActive = false;
  if (dragPad) {
    dragPad.addEventListener('mousedown', (e) => { isDragPadActive = true; onDragPadMove(e); });
    document.addEventListener('mousemove', (e) => { if (isDragPadActive) onDragPadMove(e); });
    document.addEventListener('mouseup', () => { isDragPadActive = false; });
    dragPad.addEventListener('wheel', (e) => { e.preventDefault(); onDragPadWheel(e); }, { passive: false });
  }
  dragPadModePositionBtn?.addEventListener('click', () => switchDragPadMode('position'));
  dragPadModeCameraBtn?.addEventListener('click', () => switchDragPadMode('camera'));
  dragPadXNum?.addEventListener('input', onDragPadNumInput);
  dragPadYNum?.addEventListener('input', onDragPadNumInput);
  requestAnimationFrame(() => updateDragPadCursor());

  // ---- Model Presets ----
  await populateModelPresets();
  modelPresetSaveBtn.addEventListener('click', saveModelPreset);
  modelPresetLoadBtn.addEventListener('click', loadSelectedModelPreset);
  modelPresetDeleteBtn.addEventListener('click', deleteSelectedModelPreset);


  // ---- Browse ----
  browseBtn.addEventListener('click', async () => {
    const filePath = await platform.selectModelFile();
    if (filePath) {
      modelPathInput.value = filePath;
      await updateMotionOptions(filePath);
      await updateMotionTestButtons(filePath);
    }
  });
}

export async function collectSettings(settings: Settings): Promise<void> {
  const bounds = await platform.getCharacterWindowBounds();
  settings.character = {
    showWindow: showCharacterWindowInput.checked,
    window: {
      width: parseInt(winWidthInput.value) || 300,
      height: parseInt(winHeightInput.value) || 200,
      x: bounds?.x,
      y: bounds?.y
    },
    model: {
      path: modelPathInput.value || DEFAULT_CHARACTER.model.path,
      scale: parseFloat(modelScaleNumInput.value || modelScaleInput.value) || 0.2,
      x: parseFloat(modelXNumInput.value || modelXInput.value) || 0.5,
      y: parseFloat(modelYNumInput.value || modelYInput.value) || 0.0,
      anchorX: parseFloat(anchorXInput.value) || 0.5,
      anchorY: parseFloat(anchorYInput.value) || 0.0
    },
    resolution: parseFloat(resolutionInput.value) || 2,
    fps: parseInt(fpsNumInput.value || fpsInput.value) || 30,
    idleMotion: idleMotionInput.value || 'Idle',
    tapMotion: tapMotionInput.value || 'Tap@Body',
    modelType: modelTypeSelect.value as 'live2d' | 'vrm',
    physicsEnabled: physicsEnabledInput.checked,
    disableMouthForm: lipsyncDisableMouthFormInput.checked,
    lipSyncScale: parseFloat(lipsyncScaleNumInput.value || lipsyncScaleInput.value) || 1.0,
    vrm: {
      cameraDistance: parseFloat(vrmCameraDistanceNumInput.value) || 1.5,
      cameraHeight: parseFloat(vrmCameraHeightNumInput.value) || 1.3,
      lightIntensity: parseFloat(vrmLightIntensityNumInput.value) || 1.0,
      modelX: parseFloat(vrmModelXNumInput.value) || 0,
      modelY: parseFloat(vrmModelYNumInput.value) || 0,
      cameraAngleX: parseFloat(vrmCameraAngleXNumInput.value) || 0,
      cameraAngleY: parseFloat(vrmCameraAngleYNumInput.value) || 0
    }
  };

  settings.lipSync = {
    enabled: lipsyncEnabledInput.checked,
    mode: lipsyncModeSelect.value as 'simple' | 'amplitude' | 'phoneme'
  };

  // Window mode (desktop / docked) — restart required on change
}

/** Get resolution/modelType for restart check */
export function getRestartValues() {
  return {
    resolution: parseFloat(resolutionNumInput?.value || resolutionInput?.value || '2') || 2,
    modelType: modelTypeSelect?.value || 'live2d',
  };
}

/** For reset button */
export async function resetToDefaults(): Promise<void> {
  winWidthInput.value = String(DEFAULT_CHARACTER.window.width);
  winHeightInput.value = String(DEFAULT_CHARACTER.window.height);
  modelPathInput.value = DEFAULT_CHARACTER.model.path;
  modelScaleInput.value = String(DEFAULT_CHARACTER.model.scale);
  modelScaleNumInput.value = String(DEFAULT_CHARACTER.model.scale);
  modelXInput.value = String(DEFAULT_CHARACTER.model.x);
  modelXNumInput.value = String(DEFAULT_CHARACTER.model.x);
  modelYInput.value = String(DEFAULT_CHARACTER.model.y);
  modelYNumInput.value = String(DEFAULT_CHARACTER.model.y);
  resolutionInput.value = String(DEFAULT_CHARACTER.resolution);
  resolutionNumInput.value = String(DEFAULT_CHARACTER.resolution);
  fpsInput.value = '30';
  fpsNumInput.value = '30';
  anchorXInput.value = String(DEFAULT_CHARACTER.model.anchorX);
  anchorYInput.value = String(DEFAULT_CHARACTER.model.anchorY);
  await updateMotionOptions(DEFAULT_CHARACTER.model.path);
  await updateMotionTestButtons(DEFAULT_CHARACTER.model.path);
  currentStateMotionMap = {};
  currentEmotionMap = JSON.parse(JSON.stringify(DEFAULT_EMOTION_MAP));
  renderStateMotionUI();
  renderEmotionMapUI();
  idleMotionInput.value = DEFAULT_CHARACTER.idleMotion;
  tapMotionInput.value = DEFAULT_CHARACTER.tapMotion;
  physicsEnabledInput.checked = true;
  modelTypeSelect.value = 'vrm';
  updateModelTypeVisibility();
  vrmCameraDistanceInput.value = '1.5'; vrmCameraDistanceNumInput.value = '1.5';
  vrmCameraHeightInput.value = '1.3'; vrmCameraHeightNumInput.value = '1.3';
  vrmLightIntensityInput.value = '1.0'; vrmLightIntensityNumInput.value = '1.0';
  vrmModelXInput.value = '0'; vrmModelXNumInput.value = '0';
  vrmModelYInput.value = '0'; vrmModelYNumInput.value = '0';
  vrmCameraAngleXInput.value = '0'; vrmCameraAngleXNumInput.value = '0';
  vrmCameraAngleYInput.value = '0'; vrmCameraAngleYNumInput.value = '0';
  updateModelTypeVisibility();
  await applyPreview();
}

/** Called by navigateToTab to refresh cursor on character tab */
export function refreshDragPadCursor(): void {
  requestAnimationFrame(() => updateDragPadCursor());
}

/** Re-render dynamic UI sections after locale switch */
export async function rerenderDynamicUI(): Promise<void> {
  await renderStateMotionUI();
  await renderEmotionMapUI();
}
