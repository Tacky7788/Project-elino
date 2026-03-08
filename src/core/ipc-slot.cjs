'use strict';

const path = require('path');
const fs = require('fs').promises;

let _ctx = null;

async function loadActiveSlots() {
    const { ACTIVE_SLOTS_FILE } = _ctx.constants;
    try {
        const data = await fs.readFile(ACTIVE_SLOTS_FILE, 'utf-8');
        return JSON.parse(data);
    } catch {
        return null;
    }
}

async function saveActiveSlots(activeData) {
    const { ACTIVE_SLOTS_FILE } = _ctx.constants;
    await fs.writeFile(ACTIVE_SLOTS_FILE, JSON.stringify(activeData, null, 2), 'utf-8');
}

// 初回マイグレーション: 既存データ → slots/slot-1/
async function migrateToSlots() {
    const { constants, loadSettings } = _ctx;
    const { SLOTS_DIR, COMPANION_DIR, updateSlotPaths } = constants;

    const existing = await loadActiveSlots();
    if (existing) {
        updateSlotPaths(existing.activeSlotId);
        return;
    }

    console.log('📦 スロットシステムへのマイグレーション開始...');
    const slotId = 'slot-1';
    const slotDir = path.join(SLOTS_DIR, slotId);
    await fs.mkdir(slotDir, { recursive: true });

    const filesToMigrate = [
        { src: path.join(COMPANION_DIR, 'profile.json'), dst: path.join(slotDir, 'profile.json') },
        { src: path.join(COMPANION_DIR, 'personality.json'), dst: path.join(slotDir, 'personality.json') },
        { src: path.join(COMPANION_DIR, 'memory.json'), dst: path.join(slotDir, 'memory.json') },
        { src: path.join(COMPANION_DIR, 'history.jsonl'), dst: path.join(slotDir, 'history.jsonl') },
        { src: path.join(COMPANION_DIR, 'state.json'), dst: path.join(slotDir, 'state.json') }
    ];

    for (const { src, dst } of filesToMigrate) {
        try {
            await fs.copyFile(src, dst);
        } catch {
            // 新規インストール → 無視
        }
    }

    let slotName = 'Default';
    try {
        const profileData = await fs.readFile(path.join(slotDir, 'profile.json'), 'utf-8');
        const profile = JSON.parse(profileData);
        if (profile.companionName) slotName = profile.companionName;
    } catch { /* デフォルト名を使用 */ }

    let presetBase = 'friendly';
    try {
        const settings = await loadSettings();
        if (settings.activePersonalityPreset) presetBase = settings.activePersonalityPreset;
    } catch { /* デフォルトを使用 */ }

    const activeData = {
        activeSlotId: slotId,
        slots: [{
            id: slotId,
            name: slotName,
            presetBase: presetBase,
            createdAt: new Date().toISOString()
        }]
    };

    await saveActiveSlots(activeData);
    updateSlotPaths(slotId);
    console.log(`✅ マイグレーション完了: ${slotName} (${slotId})`);
}

async function switchSlot(newSlotId) {
    const {
        constants, flushDirty, safeSend,
        setMemoryV2Cache, setStateCache, setSettingsCache,
        getMemoryV2Dirty, getStateDirty,
    } = _ctx;
    const { updateSlotPaths } = constants;

    const activeData = await loadActiveSlots();
    if (!activeData) throw new Error('スロットデータが見つかりません');

    const targetSlot = activeData.slots.find(s => s.id === newSlotId);
    if (!targetSlot) throw new Error(`スロット ${newSlotId} が見つかりません`);

    if (activeData.activeSlotId === newSlotId) return targetSlot;

    // 現在のキャッシュをフラッシュ
    if (getMemoryV2Dirty() || getStateDirty()) {
        await flushDirty();
    }

    activeData.activeSlotId = newSlotId;
    await saveActiveSlots(activeData);
    updateSlotPaths(newSlotId);

    // キャッシュクリア
    setMemoryV2Cache(null);
    setStateCache(null);
    setSettingsCache(null);

    console.log(`🔄 スロット切替: ${targetSlot.name} (${newSlotId})`);

    // renderer に通知
    const chatWindow = _ctx.chatWindow;
    if (chatWindow && !chatWindow.isDestroyed()) {
        chatWindow.webContents.send('slot-changed', targetSlot);
    }

    return targetSlot;
}

function register(ipcMain, ctx) {
    _ctx = ctx;
    const {
        constants, ensureCompanionDir, loadProfile,
        flushDirty, getMemoryV2Dirty, getStateDirty,
    } = ctx;
    const {
        SLOTS_DIR, PERSONALITY_PRESETS,
        DEFAULT_PROFILE, DEFAULT_PERSONALITY, DEFAULT_MEMORY_V2, DEFAULT_STATE,
        getFilePaths,
    } = constants;

    ipcMain.handle('slot:list', async () => {
        const activeData = await loadActiveSlots();
        if (!activeData) return { activeSlotId: '', slots: [] };
        return activeData;
    });

    ipcMain.handle('slot:switch', async (event, slotId) => {
        await switchSlot(slotId);
    });

    ipcMain.handle('slot:create', async (event, { name, presetId }) => {
        const activeData = await loadActiveSlots();
        if (!activeData) throw new Error('スロットデータが見つかりません');

        const slotId = `slot-${Date.now()}`;
        const slotDir = path.join(SLOTS_DIR, slotId);
        await fs.mkdir(slotDir, { recursive: true });

        const preset = PERSONALITY_PRESETS.find(p => p.id === presetId);
        const personality = preset ? { ...preset.personality } : { ...DEFAULT_PERSONALITY };

        const profile = { ...DEFAULT_PROFILE, companionName: name };
        await fs.writeFile(path.join(slotDir, 'profile.json'), JSON.stringify(profile, null, 2), 'utf-8');
        await fs.writeFile(path.join(slotDir, 'personality.json'), JSON.stringify(personality, null, 2), 'utf-8');
        await fs.writeFile(path.join(slotDir, 'memory.json'), JSON.stringify(JSON.parse(JSON.stringify(DEFAULT_MEMORY_V2)), null, 2), 'utf-8');
        await fs.writeFile(path.join(slotDir, 'state.json'), JSON.stringify({ ...DEFAULT_STATE }, null, 2), 'utf-8');
        await fs.writeFile(path.join(slotDir, 'history.jsonl'), '', 'utf-8');

        const newSlot = {
            id: slotId,
            name: name,
            presetBase: presetId || 'custom',
            createdAt: new Date().toISOString()
        };

        activeData.slots.push(newSlot);
        await saveActiveSlots(activeData);

        await switchSlot(slotId);

        return newSlot;
    });

    ipcMain.handle('slot:duplicate', async (event, { name }) => {
        const activeData = await loadActiveSlots();
        if (!activeData) throw new Error('スロットデータが見つかりません');

        if (getMemoryV2Dirty() || getStateDirty()) {
            await flushDirty();
        }

        const currentSlotId = activeData.activeSlotId;
        const currentSlot = activeData.slots.find(s => s.id === currentSlotId);
        const newSlotId = `slot-${Date.now()}`;
        const srcDir = path.join(SLOTS_DIR, currentSlotId);
        const dstDir = path.join(SLOTS_DIR, newSlotId);
        await fs.mkdir(dstDir, { recursive: true });

        const files = ['profile.json', 'personality.json', 'memory.json', 'state.json', 'history.jsonl'];
        for (const file of files) {
            try {
                await fs.copyFile(path.join(srcDir, file), path.join(dstDir, file));
            } catch { /* スキップ */ }
        }

        try {
            const profileData = JSON.parse(await fs.readFile(path.join(dstDir, 'profile.json'), 'utf-8'));
            profileData.companionName = name;
            await fs.writeFile(path.join(dstDir, 'profile.json'), JSON.stringify(profileData, null, 2), 'utf-8');
        } catch { /* 無視 */ }

        const newSlot = {
            id: newSlotId,
            name: name,
            presetBase: currentSlot?.presetBase || 'custom',
            createdAt: new Date().toISOString()
        };

        activeData.slots.push(newSlot);
        await saveActiveSlots(activeData);
        await switchSlot(newSlotId);

        return newSlot;
    });

    ipcMain.handle('slot:delete', async (event, slotId) => {
        const activeData = await loadActiveSlots();
        if (!activeData) throw new Error('スロットデータが見つかりません');

        if (activeData.activeSlotId === slotId) {
            throw new Error('アクティブなスロットは削除できません');
        }

        if (activeData.slots.length <= 1) {
            throw new Error('最後のスロットは削除できません');
        }

        const slotDir = path.join(SLOTS_DIR, slotId);
        try {
            await fs.rm(slotDir, { recursive: true, force: true });
        } catch { /* 削除失敗 → 無視 */ }

        activeData.slots = activeData.slots.filter(s => s.id !== slotId);
        await saveActiveSlots(activeData);
    });

    ipcMain.handle('slot:rename', async (event, slotId, name) => {
        const activeData = await loadActiveSlots();
        if (!activeData) throw new Error('スロットデータが見つかりません');

        const slot = activeData.slots.find(s => s.id === slotId);
        if (!slot) throw new Error(`スロット ${slotId} が見つかりません`);

        slot.name = name;
        await saveActiveSlots(activeData);

        if (activeData.activeSlotId === slotId) {
            try {
                const profile = await loadProfile();
                profile.companionName = name;
                await fs.writeFile(getFilePaths().PROFILE_FILE, JSON.stringify(profile, null, 2), 'utf-8');
            } catch { /* 無視 */ }
        }
    });
}

module.exports = { register, migrateToSlots, switchSlot };
