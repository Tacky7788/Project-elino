'use strict';

const fs = require('fs').promises;
const path = require('path');

// Custom Presets helpers (module-local)
let _loadCustomPresets, _saveCustomPresets;
let _loadModelPresets, _saveModelPresetsFile;

function register(ipcMain, ctx) {
    const {
        constants, ensureCompanionDir, loadConfig, loadSettings,
        loadMemoryV2Cached, loadStateCached, markDirty,
        setMemoryV2Cache, setSettingsCache,
        safeSend, flushDirty, updateStreamingMode,
        llmProvider, CommentSourceManager,
        CONFIG, isDev,
        stopBrainTick, startBrainTick,
    } = ctx;
    const {
        MEMORY_FILE, DEFAULT_MEMORY, DEFAULT_PROFILE, DEFAULT_PERSONALITY,
        PERSONALITY_PRESETS, CUSTOM_PRESETS_FILE, MODEL_PRESETS_FILE,
        USER_FILE, DEFAULT_USER, SETTINGS_FILE, DEFAULT_SETTINGS,
        DEFAULT_MEMORY_V2, CONFIG_FILE,
        getFilePaths,
    } = constants;

    // ---- Custom Presets helpers ----

    _loadCustomPresets = async function () {
        try {
            const data = await fs.readFile(CUSTOM_PRESETS_FILE, 'utf-8');
            return JSON.parse(data);
        } catch {
            return [];
        }
    };

    _saveCustomPresets = async function (presets) {
        await ensureCompanionDir();
        await fs.writeFile(CUSTOM_PRESETS_FILE, JSON.stringify(presets, null, 2), 'utf-8');
    };

    // ---- Model Presets helpers ----

    _loadModelPresets = async function () {
        try {
            return JSON.parse(await fs.readFile(MODEL_PRESETS_FILE, 'utf-8'));
        } catch {
            return [];
        }
    };

    _saveModelPresetsFile = async function (presets) {
        await ensureCompanionDir();
        await fs.writeFile(MODEL_PRESETS_FILE, JSON.stringify(presets, null, 2), 'utf-8');
    };

    // ====== Memory (v1) IPC ======

    ipcMain.handle('get-memory', async () => {
        try {
            const data = await fs.readFile(MEMORY_FILE, 'utf-8');
            return JSON.parse(data);
        } catch (err) {
            return DEFAULT_MEMORY;
        }
    });

    ipcMain.handle('save-memory', async (event, memory) => {
        await fs.writeFile(MEMORY_FILE, JSON.stringify(memory, null, 2), 'utf-8');
        console.log('💾 Memory saved (date:', memory.date, ')');
    });

    // ====== Profile IPC ======

    ipcMain.handle('get-profile', async () => {
        await ensureCompanionDir();
        try {
            const data = await fs.readFile(getFilePaths().PROFILE_FILE, 'utf-8');
            return JSON.parse(data);
        } catch (err) {
            await fs.writeFile(getFilePaths().PROFILE_FILE, JSON.stringify(DEFAULT_PROFILE, null, 2), 'utf-8');
            return DEFAULT_PROFILE;
        }
    });

    ipcMain.handle('save-profile', async (event, profile) => {
        await ensureCompanionDir();
        await fs.writeFile(getFilePaths().PROFILE_FILE, JSON.stringify(profile, null, 2), 'utf-8');
        console.log('Profile saved:', profile);
    });

    // ====== Personality IPC ======

    ipcMain.handle('get-personality', async () => {
        await ensureCompanionDir();
        try {
            const data = await fs.readFile(getFilePaths().PERSONALITY_FILE, 'utf-8');
            const personality = JSON.parse(data);
            // personality.md が存在すれば freeEditPrompt に読み込む
            const mdPath = path.join(path.dirname(getFilePaths().PERSONALITY_FILE), 'personality.md');
            try {
                const mdContent = await fs.readFile(mdPath, 'utf-8');
                if (mdContent.trim()) {
                    personality.freeEditPrompt = mdContent;
                }
            } catch { /* .md がなければJSON側を使う */ }
            return personality;
        } catch (err) {
            await fs.writeFile(getFilePaths().PERSONALITY_FILE, JSON.stringify(DEFAULT_PERSONALITY, null, 2), 'utf-8');
            return DEFAULT_PERSONALITY;
        }
    });

    ipcMain.handle('save-personality', async (event, personality) => {
        await ensureCompanionDir();
        let existing = {};
        try { existing = JSON.parse(await fs.readFile(getFilePaths().PERSONALITY_FILE, 'utf-8')); } catch {}
        const hasCoreIdentity = Array.isArray(personality.coreIdentity) && personality.coreIdentity.length > 0;
        const hasReactions = personality.reactions &&
            Object.values(personality.reactions).some(arr => Array.isArray(arr) && arr.length > 0);
        const merged = {
            ...existing,
            ...personality,
            mode: personality.mode || 'simple',
            freeEditPrompt: personality.freeEditPrompt || existing.freeEditPrompt || '',
            coreIdentity: hasCoreIdentity ? personality.coreIdentity : (existing.coreIdentity || []),
            reactions: hasReactions ? personality.reactions : (existing.reactions || {})
        };
        await fs.writeFile(getFilePaths().PERSONALITY_FILE, JSON.stringify(merged, null, 2), 'utf-8');
        // freeEditMode なら personality.md にも書き出す
        const mdPath = path.join(path.dirname(getFilePaths().PERSONALITY_FILE), 'personality.md');
        if (merged.mode === 'freeEdit' && merged.freeEditPrompt) {
            await fs.writeFile(mdPath, merged.freeEditPrompt, 'utf-8');
            console.log('📝 personality.md 更新');
        }
        const settings = await loadSettings();
        settings.activePersonalityPreset = 'custom';
        setSettingsCache(settings);
        await fs.writeFile(SETTINGS_FILE, JSON.stringify(settings, null, 2), 'utf-8');
        console.log('Personality saved (mode:', merged.mode + '):', JSON.stringify({ traits: merged.traits, speechStyle: merged.speechStyle }));
    });

    // ====== Personality Presets IPC ======

    ipcMain.handle('get-personality-presets', async () => {
        return PERSONALITY_PRESETS;
    });

    ipcMain.handle('apply-personality-preset', async (event, presetId) => {
        const builtin = PERSONALITY_PRESETS.find(p => p.id === presetId);
        if (builtin) {
            await ensureCompanionDir();
            await fs.writeFile(getFilePaths().PERSONALITY_FILE, JSON.stringify(builtin.personality, null, 2), 'utf-8');
            console.log(`Personality preset applied: ${builtin.name}, traits=[${builtin.personality.traits.join(', ')}]`);
        } else {
            const customPresets = await _loadCustomPresets();
            const custom = customPresets.find(p => p.id === presetId);
            if (custom) {
                await ensureCompanionDir();
                await fs.writeFile(getFilePaths().PERSONALITY_FILE, JSON.stringify(custom.personality, null, 2), 'utf-8');
                console.log(`Custom personality preset applied: ${custom.name}, traits=[${custom.personality.traits.join(', ')}]`);
            } else {
                throw new Error(`Preset not found: ${presetId}`);
            }
        }
        const settings = await loadSettings();
        settings.activePersonalityPreset = presetId;
        setSettingsCache(settings);
        await fs.writeFile(SETTINGS_FILE, JSON.stringify(settings, null, 2), 'utf-8');
    });

    // ====== Custom Presets IPC ======

    ipcMain.handle('get-custom-presets', async () => {
        return await _loadCustomPresets();
    });

    ipcMain.handle('save-custom-preset', async (event, preset) => {
        const presets = await _loadCustomPresets();
        const idx = presets.findIndex(p => p.id === preset.id);
        if (idx >= 0) {
            presets[idx] = preset;
        } else {
            presets.push(preset);
        }
        await _saveCustomPresets(presets);
        console.log(`Custom preset saved: ${preset.name}`);
    });

    ipcMain.handle('delete-custom-preset', async (event, presetId) => {
        const presets = await _loadCustomPresets();
        const filtered = presets.filter(p => p.id !== presetId);
        await _saveCustomPresets(filtered);
        console.log(`Custom preset deleted: ${presetId}`);
    });

    // ====== Model Presets IPC ======

    ipcMain.handle('model-presets:list', async () => {
        return await _loadModelPresets();
    });

    ipcMain.handle('model-presets:save', async (event, preset) => {
        const presets = await _loadModelPresets();
        presets.push(preset);
        await _saveModelPresetsFile(presets);
        console.log(`Model preset saved: ${preset.name}`);
    });

    ipcMain.handle('model-presets:delete', async (event, presetId) => {
        const presets = await _loadModelPresets();
        await _saveModelPresetsFile(presets.filter(p => p.id !== presetId));
        console.log(`Model preset deleted: ${presetId}`);
    });

    // ====== User IPC ======

    ipcMain.handle('get-user', async () => {
        await ensureCompanionDir();
        try {
            const data = await fs.readFile(USER_FILE, 'utf-8');
            return JSON.parse(data);
        } catch (err) {
            await fs.writeFile(USER_FILE, JSON.stringify(DEFAULT_USER, null, 2), 'utf-8');
            return DEFAULT_USER;
        }
    });

    ipcMain.handle('save-user', async (event, user) => {
        await ensureCompanionDir();
        user.updatedAt = new Date().toISOString();
        await fs.writeFile(USER_FILE, JSON.stringify(user, null, 2), 'utf-8');
        console.log('User saved');
    });

    // ====== Memory V2 IPC ======

    ipcMain.handle('get-memory-v2', async () => {
        await ensureCompanionDir();
        return await loadMemoryV2Cached();
    });

    ipcMain.handle('save-memory-v2', async (event, memory) => {
        await ensureCompanionDir();
        memory.updatedAt = new Date().toISOString();
        memory.rev = (memory.rev || 0) + 1;
        setMemoryV2Cache(memory);
        markDirty('memory');
        console.log('Memory V2 saved (queued), rev:', memory.rev);
    });

    ipcMain.handle('memory:openFolder', async () => {
        const { shell } = require('electron');
        const { MEMORY_V2_FILE } = getFilePaths();
        const path = require('path');
        const dir = path.dirname(MEMORY_V2_FILE);
        console.log('[memory:openFolder]', dir);
        const err = await shell.openPath(dir);
        if (err) console.warn('[memory:openFolder] error:', err);
    });

    // ====== State IPC ======

    ipcMain.handle('get-state', async () => {
        await ensureCompanionDir();
        return await loadStateCached();
    });

    ipcMain.handle('save-state', async (event, state) => {
        await ensureCompanionDir();
        state.rev = (state.rev || 0) + 1;
        ctx.setStateCache(state);
        markDirty('state');
        console.log('State saved (queued), rev:', state.rev);
    });

    // ====== Settings IPC ======

    ipcMain.handle('get-settings', async () => {
        await ensureCompanionDir();
        try {
            const data = await fs.readFile(SETTINGS_FILE, 'utf-8');
            return JSON.parse(data);
        } catch (err) {
            await fs.writeFile(SETTINGS_FILE, JSON.stringify(DEFAULT_SETTINGS, null, 2), 'utf-8');
            return DEFAULT_SETTINGS;
        }
    });

    ipcMain.handle('save-settings', async (event, settings) => {
        await ensureCompanionDir();
        // VRChat: 変更前の設定を保持
        let oldSettings = null;
        try { oldSettings = JSON.parse(await fs.readFile(SETTINGS_FILE, 'utf-8')); } catch (_) {}

        await fs.writeFile(SETTINGS_FILE, JSON.stringify(settings, null, 2), 'utf-8');
        setSettingsCache(null); // キャッシュ無効化
        console.log('Settings saved');

        // プロアクティブ設定が変更されたらbrainTickを再起動
        if (settings.proactive) {
            stopBrainTick();
            if (settings.proactive.enabled) {
                startBrainTick(settings);
            }
        }

        // チャットウィンドウに設定変更を通知
        const chatWindow = ctx.chatWindow;
        if (chatWindow && !chatWindow.isDestroyed()) {
            chatWindow.webContents.send('settings-changed-full', settings);
        }

        // 配信モード更新
        await updateStreamingMode(settings);

        // VRChat OSC: 設定変更時に接続/切断/再接続
        try {
            const oscClient = require('./osc-client.cjs');
            oscClient.handleSettingsChange(settings, oldSettings);
        } catch (err) {
            console.error('❌ VRChat設定変更処理失敗:', err.message);
        }
    });

    // selfGrowth: 性格変更の承認
    ipcMain.handle('self-growth-approve', async (event, { changes }) => {
        try {
            const paths = getFilePaths();
            let personality;
            try {
                personality = JSON.parse(await fs.readFile(paths.PERSONALITY_FILE, 'utf-8'));
            } catch {
                personality = { ...DEFAULT_PERSONALITY };
            }
            Object.assign(personality, changes);
            await fs.writeFile(paths.PERSONALITY_FILE, JSON.stringify(personality, null, 2), 'utf-8');
            console.log('✅ selfGrowth 承認・適用:', changes);

            // 変更履歴をsettings.jsonに追加
            try {
                const settings = await loadSettings();
                if (!settings.selfGrowth) settings.selfGrowth = {};
                if (!settings.selfGrowth.history) settings.selfGrowth.history = [];
                settings.selfGrowth.history.push({
                    date: new Date().toISOString(),
                    changes,
                });
                // 最大50件まで保持
                if (settings.selfGrowth.history.length > 50) {
                    settings.selfGrowth.history = settings.selfGrowth.history.slice(-50);
                }
                await fs.writeFile(SETTINGS_FILE, JSON.stringify(settings, null, 2), 'utf-8');
                setSettingsCache(null);
            } catch (histErr) {
                console.error('⚠️ selfGrowth履歴保存失敗:', histErr);
            }

            // 設定画面にも通知
            const settingsWin = ctx.settingsWindow;
            if (settingsWin && !settingsWin.isDestroyed()) {
                settingsWin.webContents.send('personality-updated-external');
            }
            const chatWindow = ctx.chatWindow;
            if (chatWindow && !chatWindow.isDestroyed()) {
                let summary = '';
                if (changes.traits) summary = '性格を更新しました';
                else if (changes.speechStyle) summary = '話し方を更新しました';
                else summary = '性格設定を更新しました';
                chatWindow.webContents.send('config-updated', { target: 'personality', summary });
            }
            return { ok: true };
        } catch (err) {
            console.error('❌ selfGrowth approve failed:', err);
            return { ok: false, error: err.message };
        }
    });

    // ====== Streaming テスト接続 IPC ======

    ipcMain.handle('streaming:test-youtube', async (event, videoId) => {
        const config = await loadConfig();
        const apiKey = config.googleApiKey || process.env.GOOGLE_GENERATIVE_AI_API_KEY || '';
        if (!apiKey) return { success: false, error: 'Google APIキーが設定されていません' };
        return CommentSourceManager.testYoutube(videoId, apiKey);
    });

    ipcMain.handle('streaming:test-onecomme', async (event, port) => {
        return CommentSourceManager.testOnecomme(port);
    });

    // ====== Broadcast Mode Start/Stop IPC ======

    ipcMain.handle('broadcast:start', async () => {
        const settings = ctx.getSettingsCache() || await loadSettings();
        settings.streaming = { ...settings.streaming, enabled: true, broadcastMode: true };
        setSettingsCache(settings);
        await updateStreamingMode(settings);
        console.log('📺 配信モード開始');
    });

    ipcMain.handle('broadcast:stop', async () => {
        const settings = ctx.getSettingsCache() || await loadSettings();
        settings.streaming = { ...settings.streaming, broadcastMode: false };
        setSettingsCache(settings);
        ctx.setBroadcastQueue([]);
        ctx.commentSource.stop();
        await flushDirty();
        console.log('📺 配信モード終了');
    });

    // Resource path for production (Live2D files)
    ipcMain.handle('get-resource-path', async () => {
        if (isDev) {
            return null;
        }
        const path = require('path');
        const fs = require('fs');
        const packed = path.join(process.resourcesPath, 'live2d');
        if (fs.existsSync(packed)) {
            return packed;
        }
        // npm run start (unpackaged production): fall back to public/
        return path.join(__dirname, '..', '..', 'public', 'live2d');
    });

    // ====== History IPC ======

    ipcMain.handle('append-history', async (event, record) => {
        await ensureCompanionDir();
        const line = JSON.stringify(record) + '\n';
        await fs.appendFile(getFilePaths().HISTORY_FILE, line, 'utf-8');
        // キャッシュ無効化
        if (ctx.invalidateHistoryCache) ctx.invalidateHistoryCache();
    });

    ipcMain.handle('get-history', async (event, limit = 20) => {
        // loadHistoryキャッシュ経由（ディスク読み込み削減）
        if (ctx.loadHistory) {
            return ctx.loadHistory(limit);
        }
        // フォールバック
        await ensureCompanionDir();
        try {
            const data = await fs.readFile(getFilePaths().HISTORY_FILE, 'utf-8');
            const lines = data.trim().split('\n').filter(Boolean);
            const parsed = [];
            for (const line of lines.slice(-limit)) {
                try { parsed.push(JSON.parse(line)); } catch { /* 壊れた行をスキップ */ }
            }
            return parsed;
        } catch (err) {
            return [];
        }
    });

    ipcMain.handle('get-history-count', async () => {
        await ensureCompanionDir();
        try {
            const data = await fs.readFile(getFilePaths().HISTORY_FILE, 'utf-8');
            const lines = data.trim().split('\n').filter(Boolean);
            return lines.length;
        } catch (err) {
            return 0;
        }
    });

    // 要約実行
    ipcMain.handle('summarize-history', async () => {
        await ensureCompanionDir();

        try {
            const data = await fs.readFile(getFilePaths().HISTORY_FILE, 'utf-8');
            const lines = data.trim().split('\n').filter(Boolean);

            if (lines.length < CONFIG.SUMMARY_CHUNK_SIZE) {
                return { success: false, reason: '履歴が少なすぎます' };
            }

            const oldMessages = lines.slice(0, CONFIG.SUMMARY_CHUNK_SIZE).map(line => JSON.parse(line));
            const conversationText = oldMessages.map(m => `${m.role}: ${m.text}`).join('\n');

            const config = await loadConfig();
            const settings = await loadSettings();
            const util = await llmProvider.resolveUtilityCredential(settings, config, CONFIG_FILE);
            if (!util) {
                return { success: false, reason: 'ユーティリティLLMのAPIキー未設定' };
            }

            const summaryResult = await llmProvider.generateText({
                provider: util.provider,
                model: util.model,
                apiKey: util.apiKey,
                credentialType: util.credentialType,
                systemPrompt: 'この会話を3行以内で要約してください。重要な事実や話題を抽出してください。',
                prompt: conversationText,
                maxTokens: 512,
                temperature: 0.3
            });

            const summary = summaryResult.text;
            if (!summary) throw new Error('要約結果が空です');

            // memory V2 に summaries として追加
            const memoryV2 = await ctx.loadMemoryV2();
            const { addSummary } = require('./memory-utils.cjs');
            addSummary(memoryV2, {
                date: new Date().toISOString().split('T')[0],
                content: summary
            });
            memoryV2.updatedAt = new Date().toISOString();
            memoryV2.rev = (memoryV2.rev || 0) + 1;

            await fs.writeFile(getFilePaths().MEMORY_V2_FILE, JSON.stringify(memoryV2, null, 2), 'utf-8');

            const remainingLines = lines.slice(CONFIG.SUMMARY_CHUNK_SIZE);
            await fs.writeFile(getFilePaths().HISTORY_FILE, remainingLines.join('\n') + '\n', 'utf-8');

            console.log('✅ 要約完了:', summary);
            return { success: true, summary };
        } catch (err) {
            console.error('❌ 要約失敗:', err);
            return { success: false, reason: err.message };
        }
    });

    // ====== Config IPC ======

    ipcMain.handle('get-config', async () => {
        const config = await loadConfig();
        return { hasApiKey: !!config.openaiApiKey };
    });

    ipcMain.handle('save-config', async (event, config) => {
        await fs.writeFile(CONFIG_FILE, JSON.stringify(config, null, 2), 'utf-8');
        console.log('Config saved (APIキーは伏せる)');
    });

    // Config Extended (multi-provider)
    ipcMain.handle('get-config-extended', async () => {
        const config = await loadConfig();
        const { googleOAuth } = ctx;
        const oauthStatus = googleOAuth.getStatus(config);
        return {
            hasAnthropicKey: !!llmProvider.resolveApiKey('claude', config),
            hasOpenaiKey: !!llmProvider.resolveApiKey('openai', config),
            hasGoogleKey: !!llmProvider.resolveApiKey('gemini', config) || oauthStatus.loggedIn,
            hasGroqKey: !!llmProvider.resolveApiKey('groq', config),
            hasDeepseekKey: !!llmProvider.resolveApiKey('deepseek', config),
            hasElevenlabsKey: !!(config.elevenlabsApiKey || process.env.ELEVENLABS_API_KEY),
            anthropicFromEnv: !!process.env.ANTHROPIC_API_KEY,
            openaiFromEnv: !!process.env.OPENAI_API_KEY,
            googleFromEnv: !!process.env.GOOGLE_GENERATIVE_AI_API_KEY,
            groqFromEnv: !!process.env.GROQ_API_KEY,
            deepseekFromEnv: !!process.env.DEEPSEEK_API_KEY,
            elevenlabsFromEnv: !!process.env.ELEVENLABS_API_KEY,
            googleOAuth: oauthStatus.loggedIn,
            googleOAuthEmail: oauthStatus.email || '',
            googleOAuthClientId: config.googleOAuthClientId || '',
            googleOAuthClientSecret: config.googleOAuthClientSecret || '',
            // 汎用プロバイダーAPIキー（保存済みの値を返す）
            savedApiKeys: Object.fromEntries(
                Object.entries(config).filter(([k]) => k.endsWith('ApiKey') || k === 'cloudflareAccountId')
            ),
        };
    });

    ipcMain.handle('save-config-extended', async (event, newConfig) => {
        const existing = await loadConfig();
        const merged = { ...existing, ...newConfig };
        await fs.writeFile(CONFIG_FILE, JSON.stringify(merged, null, 2), 'utf-8');
        console.log('Config extended saved');
    });

    // ====== Google OAuth IPC ======

    ipcMain.handle('oauth:google-start', async () => {
        const config = await loadConfig();
        const { googleOAuth } = ctx;
        return googleOAuth.startOAuthFlow(config, CONFIG_FILE);
    });

    ipcMain.handle('oauth:google-logout', async () => {
        const config = await loadConfig();
        const { googleOAuth } = ctx;
        await googleOAuth.logout(config, CONFIG_FILE);
    });

    ipcMain.handle('oauth:google-status', async () => {
        const config = await loadConfig();
        const { googleOAuth } = ctx;
        return googleOAuth.getStatus(config);
    });

    ipcMain.handle('get-model-registry', async () => {
        return llmProvider.MODEL_REGISTRY;
    });

    ipcMain.handle('get-available-providers', async () => {
        const config = await loadConfig();
        return llmProvider.getAvailableProviders(config);
    });
}

module.exports = { register };
