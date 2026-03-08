import { platform } from '../platform';
// Settings > Personality + Slots + Presets tab
import type { Settings, Personality } from '../types';
import { t, getLocale } from '../locales';
import { modalPrompt, modalConfirm, showToast, showStatus } from './shared';

// DOM elements
let presetTabsBar: HTMLElement;
let presetEditor: HTMLElement;
let presetNameInput: HTMLInputElement;
let personalityModeToggle: HTMLInputElement;
let modeLabelSimple: HTMLSpanElement;
let modeLabelFreeEdit: HTMLSpanElement;
let simpleModeEditor: HTMLDivElement;
let freeEditModeEditor: HTMLDivElement;
let personalityFreeEditTextarea: HTMLTextAreaElement;
let personalityTraitsTextarea: HTMLTextAreaElement;
let personalitySpeechTextarea: HTMLTextAreaElement;
let personalityForbiddenTextarea: HTMLTextAreaElement;
let personalityCoreIdentityTextarea: HTMLTextAreaElement;
let personalityIdentityInput: HTMLInputElement;
let personalityWeaknessesTextarea: HTMLTextAreaElement;
let personalityQuirksTextarea: HTMLTextAreaElement;
let personalityExamplesTextarea: HTMLTextAreaElement;
let reactionsAgreeInput: HTMLInputElement;
let reactionsDisagreeInput: HTMLInputElement;
let reactionsExcitedInput: HTMLInputElement;
let reactionsTeaseInput: HTMLInputElement;
let reactionsComfortInput: HTMLInputElement;
let presetApplyBtn: HTMLButtonElement;
let presetSaveBtn: HTMLButtonElement;
let presetDeleteBtn: HTMLButtonElement;
let slotSelect: HTMLSelectElement;
let slotSwitchBtn: HTMLButtonElement;
let slotDuplicateBtn: HTMLButtonElement;
let slotCreateBtn: HTMLButtonElement;
let slotRenameBtn: HTMLButtonElement;
let slotDeleteBtn: HTMLButtonElement;
let companionNameInput: HTMLInputElement;
let callUserInput: HTMLInputElement;
let userNameSettingInput: HTMLInputElement;
let userInterestsSettingInput: HTMLInputElement;
let saveBasicSettingsBtn: HTMLButtonElement;

// State
interface PresetEntry {
  id: string;
  name: string;
  nameEn?: string;
  builtin: boolean;
  personality: Personality;
}

let allPresets: PresetEntry[] = [];
export let selectedPresetId: string | null = null;
let currentPersonalityMode: 'simple' | 'freeEdit' = 'simple';

function parseSlashList(val: string): string[] {
  return val.split(/[\/／]/).map(s => s.trim()).filter(Boolean);
}

export function getEditorPersonality(): Personality {
  return {
    traits: personalityTraitsTextarea.value.split('\n').map(s => s.trim()).filter(Boolean),
    speechStyle: personalitySpeechTextarea.value.split('\n').map(s => s.trim()).filter(Boolean),
    guidance: personalityForbiddenTextarea.value.split('\n').map(s => s.trim()).filter(Boolean),
    coreIdentity: personalityCoreIdentityTextarea.value.split('\n').map(s => s.trim()).filter(Boolean),
    identity: personalityIdentityInput.value.trim() || undefined,
    weaknesses: personalityWeaknessesTextarea.value.split('\n').map(s => s.trim()).filter(Boolean),
    quirks: personalityQuirksTextarea.value.split('\n').map(s => s.trim()).filter(Boolean),
    reactions: {
      agree: parseSlashList(reactionsAgreeInput.value),
      disagree: parseSlashList(reactionsDisagreeInput.value),
      excited: parseSlashList(reactionsExcitedInput.value),
      tease: parseSlashList(reactionsTeaseInput.value),
      comfort: parseSlashList(reactionsComfortInput.value),
    },
    exampleConversation: personalityExamplesTextarea.value.split('\n').map(s => s.trim()).filter(Boolean),
    conversationExamples: personalityExamplesTextarea.value.split('\n').map(s => s.trim()).filter(Boolean),
  };
}

function handlePersonalityModeSwitch(newMode: 'simple' | 'freeEdit') {
  if (currentPersonalityMode === newMode) return;
  if (newMode === 'freeEdit') {
    simpleModeEditor.style.display = 'none';
    freeEditModeEditor.style.display = 'block';
    modeLabelSimple.classList.remove('active');
    modeLabelFreeEdit.classList.add('active');
  } else {
    simpleModeEditor.style.display = 'block';
    freeEditModeEditor.style.display = 'none';
    modeLabelSimple.classList.add('active');
    modeLabelFreeEdit.classList.remove('active');
  }
  currentPersonalityMode = newMode;
}

function loadPersonalityIntoEditor(personality: Personality) {
  const isEn = getLocale() === 'en';
  const p = personality as any;
  personalityTraitsTextarea.value = (isEn && p.traitsEn ? p.traitsEn : personality.traits)?.join('\n') || '';
  personalitySpeechTextarea.value = (isEn && p.speechStyleEn ? p.speechStyleEn : personality.speechStyle)?.join('\n') || '';
  personalityForbiddenTextarea.value = (isEn && p.guidanceEn ? p.guidanceEn : (personality.guidance || personality.forbidden))?.join('\n') || '';
  personalityCoreIdentityTextarea.value = (isEn && p.coreIdentityEn ? p.coreIdentityEn : personality.coreIdentity)?.join('\n') || '';
  personalityIdentityInput.value = (isEn && p.identityEn) ? p.identityEn : (personality.identity || '');
  personalityWeaknessesTextarea.value = (isEn && p.weaknessesEn ? p.weaknessesEn : personality.weaknesses)?.join('\n') || '';
  personalityQuirksTextarea.value = (isEn && p.quirksEn ? p.quirksEn : personality.quirks)?.join('\n') || '';
  reactionsAgreeInput.value = (isEn && p.reactionsEn?.agree ? p.reactionsEn.agree : personality.reactions?.agree)?.join(' / ') || '';
  reactionsDisagreeInput.value = (isEn && p.reactionsEn?.disagree ? p.reactionsEn.disagree : personality.reactions?.disagree)?.join(' / ') || '';
  reactionsExcitedInput.value = (isEn && p.reactionsEn?.excited ? p.reactionsEn.excited : personality.reactions?.excited)?.join(' / ') || '';
  reactionsTeaseInput.value = (isEn && p.reactionsEn?.tease ? p.reactionsEn.tease : personality.reactions?.tease)?.join(' / ') || '';
  reactionsComfortInput.value = (isEn && p.reactionsEn?.comfort ? p.reactionsEn.comfort : personality.reactions?.comfort)?.join(' / ') || '';
  personalityExamplesTextarea.value = (isEn && p.conversationExamplesEn ? p.conversationExamplesEn : (p.conversationExamples || personality.exampleConversation))?.join('\n') || '';
  personalityFreeEditTextarea.value = (isEn && p.freeEditPromptEn) ? p.freeEditPromptEn : (personality.freeEditPrompt || '');

  currentPersonalityMode = personality.mode || 'simple';
  personalityModeToggle.checked = currentPersonalityMode === 'freeEdit';

  if (currentPersonalityMode === 'freeEdit') {
    simpleModeEditor.style.display = 'none';
    freeEditModeEditor.style.display = 'block';
    modeLabelSimple.classList.remove('active');
    modeLabelFreeEdit.classList.add('active');
  } else {
    simpleModeEditor.style.display = 'block';
    freeEditModeEditor.style.display = 'none';
    modeLabelSimple.classList.add('active');
    modeLabelFreeEdit.classList.remove('active');
  }
}

function renderPresetTabs() {
  presetTabsBar.innerHTML = '';
  allPresets.forEach(p => {
    const tab = document.createElement('button');
    tab.className = 'preset-tab' + (p.id === selectedPresetId ? ' active' : '');
    tab.textContent = (getLocale() === 'en' && p.nameEn) ? p.nameEn : p.name;
    tab.dataset.id = p.id;
    tab.addEventListener('click', () => selectPresetTab(p.id));
    presetTabsBar.appendChild(tab);
  });
  const addBtn = document.createElement('button');
  addBtn.className = 'preset-tab-add';
  addBtn.textContent = t('settings.personality.preset.addNew');
  addBtn.title = t('settings.personality.preset.addNewTitle');
  addBtn.addEventListener('click', createNewPreset);
  presetTabsBar.appendChild(addBtn);
}

function selectPresetTab(id: string) {
  selectedPresetId = id;
  const preset = allPresets.find(p => p.id === id);
  if (!preset) return;
  presetTabsBar.querySelectorAll('.preset-tab').forEach(tab => {
    (tab as HTMLElement).classList.toggle('active', (tab as HTMLElement).dataset.id === id);
  });
  presetEditor.style.display = 'block';
  presetNameInput.value = (getLocale() === 'en' && preset.nameEn) ? preset.nameEn : preset.name;
  presetNameInput.readOnly = preset.builtin;
  loadPersonalityIntoEditor(preset.personality);
  if (preset.builtin) {
    presetSaveBtn.textContent = t('settings.personality.preset.saveAsCustom');
    presetDeleteBtn.style.display = 'none';
  } else {
    presetSaveBtn.textContent = t('common.save');
    presetDeleteBtn.style.display = '';
  }
}

async function savePreset() {
  const preset = allPresets.find(p => p.id === selectedPresetId);
  if (!preset) return;
  const personality = getEditorPersonality();
  if (preset.builtin) {
    const newId = crypto.randomUUID();
    const newName = presetNameInput.value.trim() || `${preset.name}${t('settings.personality.preset.customSuffix')}`;
    const newPreset: PresetEntry = { id: newId, name: newName, builtin: false, personality };
    await platform.saveCustomPreset({ id: newId, name: newName, description: '', personality });
    allPresets.push(newPreset);
    renderPresetTabs();
    selectPresetTab(newId);
    showToast(t('settings.personality.preset.customSaved'));
  } else {
    const name = presetNameInput.value.trim() || preset.name;
    preset.name = name;
    preset.personality = personality;
    await platform.saveCustomPreset({ id: preset.id, name, description: '', personality });
    renderPresetTabs();
    showToast(t('settings.personality.preset.saved'));
  }
}

async function applyPreset() {
  try {
    const personality: Personality = getEditorPersonality();
    personality.mode = currentPersonalityMode;
    personality.freeEditPrompt = personalityFreeEditTextarea.value;
    const preset = allPresets.find(p => p.id === selectedPresetId);
    if (preset?.builtin) {
      await platform.applyPersonalityPreset(selectedPresetId!);
      const reloaded = await platform.getPersonality();
      reloaded.mode = personality.mode;
      reloaded.freeEditPrompt = personality.freeEditPrompt;
      await platform.savePersonality(reloaded);
      loadPersonalityIntoEditor(reloaded);
    } else {
      await platform.savePersonality(personality);
    }
    showToast(t('settings.personality.preset.applied'));
  } catch (err) {
    console.error('人格適用失敗:', err);
    showStatus(t('settings.personality.preset.applyFailed'), 'error');
  }
}

async function createNewPreset() {
  const existingCount = allPresets.filter(p => !p.builtin).length;
  const newId = crypto.randomUUID();
  const newName = t('settings.personality.preset.newName', { count: existingCount + 1 });
  const personality: Personality = { traits: [], speechStyle: [], forbidden: [] };
  const newPreset: PresetEntry = { id: newId, name: newName, builtin: false, personality };
  await platform.saveCustomPreset({ id: newId, name: newName, description: '', personality });
  allPresets.push(newPreset);
  renderPresetTabs();
  selectPresetTab(newId);
  showToast(t('settings.personality.preset.newCreated'));
}

async function deletePreset() {
  const preset = allPresets.find(p => p.id === selectedPresetId);
  if (!preset || preset.builtin) return;
  if (!await modalConfirm(t('settings.personality.preset.deleteConfirm', { name: preset.name }))) return;
  await platform.deleteCustomPreset(preset.id);
  const idx = allPresets.indexOf(preset);
  allPresets.splice(idx, 1);
  renderPresetTabs();
  if (allPresets.length > 0) {
    selectPresetTab(allPresets[Math.min(idx, allPresets.length - 1)].id);
  } else {
    presetEditor.style.display = 'none';
    selectedPresetId = null;
  }
  showToast(t('settings.personality.preset.deleted'));
}

// Basic settings
async function loadBasicSettings() {
  try {
    const profile = await platform.getProfile();
    companionNameInput.value = profile.companionName || '';
    callUserInput.value = profile.callUser || '';
    userInterestsSettingInput.value = (profile.interests || []).join(', ');
  } catch (err) { console.error('プロフィール読み込み失敗:', err); }
  try {
    const user = await platform.getUser();
    userNameSettingInput.value = user.name || '';
  } catch (err) { console.error('ユーザー情報読み込み失敗:', err); }
}

async function saveBasicSettings() {
  try {
    const profile = await platform.getProfile();
    profile.companionName = companionNameInput.value.trim() || '相棒';
    profile.callUser = callUserInput.value.trim() || '';
    profile.interests = userInterestsSettingInput.value.split(/[,、]/).map(s => s.trim()).filter(Boolean);
    await platform.saveProfile(profile);
  } catch (err) {
    console.error('プロフィール保存失敗:', err);
    showStatus(t('settings.personality.basic.profileSaveFailed'), 'error');
    return;
  }
  try {
    const user = await platform.getUser();
    user.name = userNameSettingInput.value.trim() || '';
    await platform.saveUser(user);
  } catch (err) {
    console.error('ユーザー情報保存失敗:', err);
    showStatus(t('settings.personality.basic.userSaveFailed'), 'error');
    return;
  }
  showToast(t('settings.personality.basic.saved'));
}

// Slot management
async function loadSlots() {
  try {
    const data = await platform.slotList();
    slotSelect.innerHTML = '';
    for (const slot of data.slots) {
      const option = document.createElement('option');
      option.value = slot.id;
      const displayName = (slot.name === 'Default' || slot.name === 'デフォルト') ? t('settings.personality.slots.defaultName') : slot.name;
      const presetLabel = t(`settings.personality.preset.${slot.presetBase}`) || slot.presetBase;
      option.textContent = `${displayName} (${presetLabel})`;
      if (slot.id === data.activeSlotId) option.selected = true;
      slotSelect.appendChild(option);
    }
  } catch (err) { console.error('スロット読み込み失敗:', err); }
}

function initSlotEvents() {
  slotSwitchBtn.addEventListener('click', async () => {
    const slotId = slotSelect.value;
    if (!slotId) return;
    try {
      await platform.slotSwitch(slotId);
      showToast(t('settings.personality.slots.switched'));
      await loadSlots();
      await loadBasicSettings();
    } catch (err) { showStatus(t('settings.personality.slots.switchFailed', { error: String(err) }), 'error'); }
  });

  slotDuplicateBtn.addEventListener('click', async () => {
    const name = await modalPrompt(t('settings.personality.slots.duplicatePrompt'));
    if (!name) return;
    try {
      await platform.slotDuplicate({ name });
      showToast(t('settings.personality.slots.created', { name }));
      await loadSlots();
    } catch (err) { showStatus(t('settings.personality.slots.duplicateFailed', { error: String(err) }), 'error'); }
  });

  slotCreateBtn.addEventListener('click', async () => {
    const name = await modalPrompt(t('settings.personality.slots.createPrompt'));
    if (!name) return;
    const presetId = await modalPrompt(t('settings.personality.slots.presetPrompt'), 'friendly');
    if (!presetId) return;
    try {
      await platform.slotCreate({ name, presetId });
      showToast(t('settings.personality.slots.created', { name }));
      await loadSlots();
    } catch (err) { showStatus(t('settings.personality.slots.createFailed', { error: String(err) }), 'error'); }
  });

  slotRenameBtn.addEventListener('click', async () => {
    const slotId = slotSelect.value;
    if (!slotId) return;
    const name = await modalPrompt(t('settings.personality.slots.renamePrompt'));
    if (!name) return;
    try {
      await platform.slotRename(slotId, name);
      showToast(t('settings.personality.slots.renamed', { name }));
      await loadSlots();
    } catch (err) { showStatus(t('settings.personality.slots.renameFailed', { error: String(err) }), 'error'); }
  });

  slotDeleteBtn.addEventListener('click', async () => {
    const slotId = slotSelect.value;
    if (!slotId) return;
    const selectedName = slotSelect.selectedOptions[0]?.textContent || slotId;
    if (!await modalConfirm(t('settings.personality.slots.deleteConfirm', { name: selectedName }))) return;
    try {
      await platform.slotDelete(slotId);
      showToast(t('settings.personality.slots.deleted'));
      await loadSlots();
    } catch (err) { showStatus(t('settings.personality.slots.deleteFailed', { error: String(err) }), 'error'); }
  });
}

export async function initTab(settings: Settings): Promise<void> {
  // Get DOM elements
  presetTabsBar = document.getElementById('preset-tabs-bar')!;
  presetEditor = document.getElementById('preset-editor')!;
  presetNameInput = document.getElementById('preset-name-input') as HTMLInputElement;
  personalityModeToggle = document.getElementById('personality-mode-toggle') as HTMLInputElement;
  modeLabelSimple = document.getElementById('mode-label-simple') as HTMLSpanElement;
  modeLabelFreeEdit = document.getElementById('mode-label-freeEdit') as HTMLSpanElement;
  simpleModeEditor = document.getElementById('simple-mode-editor') as HTMLDivElement;
  freeEditModeEditor = document.getElementById('free-edit-mode-editor') as HTMLDivElement;
  personalityFreeEditTextarea = document.getElementById('personality-free-edit') as HTMLTextAreaElement;
  personalityTraitsTextarea = document.getElementById('personality-traits') as HTMLTextAreaElement;
  personalitySpeechTextarea = document.getElementById('personality-speech') as HTMLTextAreaElement;
  personalityForbiddenTextarea = document.getElementById('personality-forbidden') as HTMLTextAreaElement;
  personalityCoreIdentityTextarea = document.getElementById('personality-core-identity') as HTMLTextAreaElement;
  personalityIdentityInput = document.getElementById('personality-identity') as HTMLInputElement;
  personalityWeaknessesTextarea = document.getElementById('personality-weaknesses') as HTMLTextAreaElement;
  personalityQuirksTextarea = document.getElementById('personality-quirks') as HTMLTextAreaElement;
  personalityExamplesTextarea = document.getElementById('personality-examples') as HTMLTextAreaElement;
  reactionsAgreeInput = document.getElementById('reactions-agree') as HTMLInputElement;
  reactionsDisagreeInput = document.getElementById('reactions-disagree') as HTMLInputElement;
  reactionsExcitedInput = document.getElementById('reactions-excited') as HTMLInputElement;
  reactionsTeaseInput = document.getElementById('reactions-tease') as HTMLInputElement;
  reactionsComfortInput = document.getElementById('reactions-comfort') as HTMLInputElement;
  presetApplyBtn = document.getElementById('preset-apply-btn') as HTMLButtonElement;
  presetSaveBtn = document.getElementById('preset-save-btn') as HTMLButtonElement;
  presetDeleteBtn = document.getElementById('preset-delete-btn') as HTMLButtonElement;
  slotSelect = document.getElementById('slot-select') as HTMLSelectElement;
  slotSwitchBtn = document.getElementById('slot-switch-btn') as HTMLButtonElement;
  slotDuplicateBtn = document.getElementById('slot-duplicate-btn') as HTMLButtonElement;
  slotCreateBtn = document.getElementById('slot-create-btn') as HTMLButtonElement;
  slotRenameBtn = document.getElementById('slot-rename-btn') as HTMLButtonElement;
  slotDeleteBtn = document.getElementById('slot-delete-btn') as HTMLButtonElement;
  companionNameInput = document.getElementById('companion-name') as HTMLInputElement;
  callUserInput = document.getElementById('call-user') as HTMLInputElement;
  userNameSettingInput = document.getElementById('user-name-setting') as HTMLInputElement;
  userInterestsSettingInput = document.getElementById('user-interests-setting') as HTMLInputElement;
  saveBasicSettingsBtn = document.getElementById('save-basic-settings-btn') as HTMLButtonElement;

  // Initialize preset tabs
  try {
    const builtins = await platform.getPersonalityPresets();
    const customs = await platform.getCustomPresets();
    allPresets = [
      ...builtins.map((p: any) => ({ id: p.id, name: p.name, nameEn: p.nameEn, builtin: true, personality: p.personality })),
      ...customs.filter((p: any) => p.id !== 'custom').map((p: any) => ({ id: p.id, name: p.name, builtin: false, personality: p.personality }))
    ];
    renderPresetTabs();
    const activeId = settings.activePersonalityPreset;
    if (activeId && allPresets.find(p => p.id === activeId)) {
      selectPresetTab(activeId);
    } else if (allPresets.length > 0) {
      selectPresetTab(allPresets[0].id);
    }
  } catch (err) { console.error('プリセット初期化失敗:', err); }

  presetApplyBtn.addEventListener('click', applyPreset);
  presetSaveBtn.addEventListener('click', savePreset);
  presetDeleteBtn.addEventListener('click', deletePreset);
  personalityModeToggle.addEventListener('change', () => {
    handlePersonalityModeSwitch(personalityModeToggle.checked ? 'freeEdit' : 'simple');
  });

  // Slots
  await loadSlots();
  initSlotEvents();

  // Basic settings
  await loadBasicSettings();
  saveBasicSettingsBtn.addEventListener('click', saveBasicSettings);
}

export async function collectSettings(settings: Settings): Promise<void> {
  // Save current preset content
  if (selectedPresetId) {
    const preset = allPresets.find(p => p.id === selectedPresetId);
    if (preset) {
      const personality = getEditorPersonality();
      if (!preset.builtin) {
        preset.name = presetNameInput.value.trim() || preset.name;
        preset.personality = personality;
        await platform.saveCustomPreset({ id: preset.id, name: preset.name, description: '', personality });
      }
      await platform.savePersonality(personality);
      settings.activePersonalityPreset = selectedPresetId;
    }
  }
}
