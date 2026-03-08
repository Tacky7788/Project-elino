'use strict';

const path = require('path');
const fs = require('fs').promises;
const { app, dialog } = require('electron');

// semver comparison (a > b → 1, a < b → -1, equal → 0)
function compareVersions(a, b) {
    const pa = a.split('.').map(Number);
    const pb = b.split('.').map(Number);
    for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
        const na = pa[i] || 0;
        const nb = pb[i] || 0;
        if (na > nb) return 1;
        if (na < nb) return -1;
    }
    return 0;
}

function register(ipcMain, ctx) {
    const {
        constants, ensureCompanionDir,
        setMemoryV2Cache, setStateCache, setSettingsCache,
        setMemoryV2Dirty, setStateDirty,
    } = ctx;
    const {
        USER_FILE, SETTINGS_FILE, ACTIVE_SLOTS_FILE,
        CUSTOM_PRESETS_FILE, SLOTS_DIR, COMPANION_DIR,
    } = constants;

    // ====== Data Export ======
    ipcMain.handle('export-data', async () => {
        try {
            const result = await dialog.showSaveDialog({
                title: 'コンパニオンデータをエクスポート',
                defaultPath: `companion-backup-${new Date().toISOString().slice(0, 10)}.json`,
                filters: [{ name: 'JSON', extensions: ['json'] }]
            });
            if (result.canceled || !result.filePath) return { success: false, error: 'キャンセルされました' };

            const exportData = {};
            const filesToExport = [
                { key: 'user', path: USER_FILE },
                { key: 'settings', path: SETTINGS_FILE },
                { key: 'active', path: ACTIVE_SLOTS_FILE },
                { key: 'customPresets', path: CUSTOM_PRESETS_FILE },
            ];
            for (const f of filesToExport) {
                try {
                    exportData[f.key] = JSON.parse(await fs.readFile(f.path, 'utf-8'));
                } catch { exportData[f.key] = null; }
            }

            // slots/ 全スロットデータ
            exportData.slots = {};
            try {
                const slotDirs = await fs.readdir(SLOTS_DIR);
                for (const slotId of slotDirs) {
                    const slotDir = path.join(SLOTS_DIR, slotId);
                    const stat = await fs.stat(slotDir);
                    if (!stat.isDirectory()) continue;
                    exportData.slots[slotId] = {};
                    const slotFiles = ['profile.json', 'personality.json', 'memory.json', 'state.json', 'history.jsonl'];
                    for (const fname of slotFiles) {
                        try {
                            const content = await fs.readFile(path.join(slotDir, fname), 'utf-8');
                            exportData.slots[slotId][fname] = fname.endsWith('.jsonl') ? content : JSON.parse(content);
                        } catch { /* ファイルなし */ }
                    }
                }
            } catch { /* slots/がない */ }

            exportData._exportVersion = 1;
            exportData._exportDate = new Date().toISOString();
            exportData._appVersion = app.getVersion();

            await fs.writeFile(result.filePath, JSON.stringify(exportData, null, 2), 'utf-8');
            return { success: true, filePath: result.filePath };
        } catch (err) {
            return { success: false, error: err.message };
        }
    });

    // ====== Data Import ======
    ipcMain.handle('import-data', async () => {
        try {
            const result = await dialog.showOpenDialog({
                title: 'コンパニオンデータをインポート',
                filters: [{ name: 'JSON', extensions: ['json'] }],
                properties: ['openFile']
            });
            if (result.canceled || result.filePaths.length === 0) return { success: false, error: 'キャンセルされました' };

            const raw = await fs.readFile(result.filePaths[0], 'utf-8');
            const data = JSON.parse(raw);
            if (!data._exportVersion) return { success: false, error: '有効なバックアップファイルではありません' };

            // 共有ファイルの復元
            if (data.user) await fs.writeFile(USER_FILE, JSON.stringify(data.user, null, 2), 'utf-8');
            if (data.settings) {
                await fs.writeFile(SETTINGS_FILE, JSON.stringify(data.settings, null, 2), 'utf-8');
                setSettingsCache(null);
            }
            if (data.active) await fs.writeFile(ACTIVE_SLOTS_FILE, JSON.stringify(data.active, null, 2), 'utf-8');
            if (data.customPresets) await fs.writeFile(CUSTOM_PRESETS_FILE, JSON.stringify(data.customPresets, null, 2), 'utf-8');

            // スロットデータの復元
            if (data.slots) {
                for (const [slotId, slotData] of Object.entries(data.slots)) {
                    const slotDir = path.join(SLOTS_DIR, slotId);
                    await fs.mkdir(slotDir, { recursive: true });
                    for (const [fname, content] of Object.entries(slotData)) {
                        const filePath = path.join(slotDir, fname);
                        if (fname.endsWith('.jsonl')) {
                            await fs.writeFile(filePath, content, 'utf-8');
                        } else {
                            await fs.writeFile(filePath, JSON.stringify(content, null, 2), 'utf-8');
                        }
                    }
                }
            }

            // キャッシュをクリア
            setMemoryV2Cache(null);
            setStateCache(null);
            setMemoryV2Dirty(false);
            setStateDirty(false);

            return { success: true };
        } catch (err) {
            return { success: false, error: err.message };
        }
    });

    // ====== Update Check ======
    ipcMain.handle('check-for-updates', async () => {
        try {
            const currentVersion = app.getVersion();
            const pjson = require(path.join(ctx.appRoot, 'package.json'));
            const repoUrl = pjson.repository?.url || '';
            const match = repoUrl.match(/github\.com[/:]([^/]+\/[^/.]+)/);
            if (!match) return { hasUpdate: false, currentVersion, error: 'リポジトリURLが未設定です' };
            const repo = match[1];
            const https = require('https');
            const response = await new Promise((resolve, reject) => {
                const req = https.get(`https://api.github.com/repos/${repo}/releases/latest`, {
                    headers: { 'User-Agent': 'desktop-companion-mvp' }
                }, (res) => {
                    let data = '';
                    res.on('data', chunk => data += chunk);
                    res.on('end', () => resolve({ statusCode: res.statusCode, data }));
                });
                req.on('error', reject);
                req.setTimeout(10000, () => { req.destroy(); reject(new Error('タイムアウト')); });
            });
            if (response.statusCode === 404) {
                return { hasUpdate: false, currentVersion, error: 'リリースが見つかりません' };
            }
            if (response.statusCode !== 200) {
                return { hasUpdate: false, currentVersion, error: `GitHub API エラー (${response.statusCode})` };
            }
            const release = JSON.parse(response.data);
            const latestVersion = (release.tag_name || '').replace(/^v/, '');
            const hasUpdate = latestVersion && latestVersion !== currentVersion && compareVersions(latestVersion, currentVersion) > 0;
            return {
                hasUpdate,
                currentVersion,
                latestVersion,
                releaseUrl: release.html_url || ''
            };
        } catch (err) {
            return { hasUpdate: false, currentVersion: app.getVersion(), error: err.message };
        }
    });

    ipcMain.handle('get-app-version', () => app.getVersion());
}

module.exports = { register };
