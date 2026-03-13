'use strict';

const oscClient = require('./osc-client.cjs');
const vrchatListener = require('./vrchat-listener.cjs');
const path = require('path');
const fs = require('fs');
const https = require('https');
const { execFile } = require('child_process');
const os = require('os');

/** VB-CABLE Driverをダウンロードしてインストール */
async function installVbCable() {
    const tmpDir = path.join(os.tmpdir(), 'vbcable-install');
    if (!fs.existsSync(tmpDir)) fs.mkdirSync(tmpDir, { recursive: true });

    const zipPath = path.join(tmpDir, 'VBCABLE_Driver_Pack.zip');
    const extractDir = path.join(tmpDir, 'extracted');

    // 1. ダウンロード（VB-Audioサーバーの証明書チェーンが不完全なためrejectUnauthorized: false）
    const downloadUrl = 'https://download.vb-audio.com/Download_CABLE/VBCABLE_Driver_Pack43.zip';
    await new Promise((resolve, reject) => {
        const doGet = (url) => {
            const file = fs.createWriteStream(zipPath);
            https.get(url, { rejectUnauthorized: false }, (response) => {
                if (response.statusCode === 301 || response.statusCode === 302) {
                    file.close();
                    fs.unlinkSync(zipPath);
                    doGet(response.headers.location);
                    return;
                }
                response.pipe(file);
                file.on('finish', () => { file.close(); resolve(); });
            }).on('error', reject);
        };
        doGet(downloadUrl);
    });

    // 2. ZIP展開（AdmZipを使う、なければ PowerShellで展開）
    if (fs.existsSync(extractDir)) fs.rmSync(extractDir, { recursive: true });
    fs.mkdirSync(extractDir, { recursive: true });

    try {
        const AdmZip = require('adm-zip');
        const zip = new AdmZip(zipPath);
        zip.extractAllTo(extractDir, true);
    } catch (_e) {
        // adm-zipがなければPowerShellで展開
        await new Promise((resolve, reject) => {
            const ps = require('child_process').execFile('powershell', [
                '-NoProfile', '-Command',
                `Expand-Archive -Path '${zipPath}' -DestinationPath '${extractDir}' -Force`
            ]);
            ps.on('close', (code) => code === 0 ? resolve() : reject(new Error(`PowerShell exit ${code}`)));
            ps.on('error', reject);
        });
    }

    // 3. インストーラー実行（管理者権限が必要 → ShellExecute runas）
    const is64bit = os.arch() === 'x64';
    const exeName = is64bit ? 'VBCABLE_Setup_x64.exe' : 'VBCABLE_Setup.exe';
    const exePath = path.join(extractDir, exeName);

    if (!fs.existsSync(exePath)) {
        // ネストされたフォルダの場合を確認
        const entries = fs.readdirSync(extractDir);
        for (const entry of entries) {
            const nested = path.join(extractDir, entry, exeName);
            if (fs.existsSync(nested)) {
                return await runInstallerElevated(nested);
            }
        }
        throw new Error(`インストーラーが見つかりません: ${exeName}`);
    }

    return await runInstallerElevated(exePath);
}

function runInstallerElevated(exePath) {
    return new Promise((resolve, reject) => {
        // PowerShellのStart-Processで管理者昇格実行
        const ps = execFile('powershell', [
            '-NoProfile', '-Command',
            `Start-Process -FilePath '${exePath}' -Verb RunAs -Wait`
        ]);
        ps.on('close', (code) => {
            resolve({ success: true, code });
        });
        ps.on('error', (err) => {
            reject(new Error(`インストーラー起動失敗: ${err.message}`));
        });
    });
}

function register(ipcMain, ctx) {
    // 手動接続
    ipcMain.handle('vrchat:connect', (_e, { host, port }) => {
        oscClient.connect(host, port);
        return { success: true };
    });

    // 手動切断
    ipcMain.handle('vrchat:disconnect', () => {
        oscClient.disconnect();
        return { success: true };
    });

    // 接続状態取得
    ipcMain.handle('vrchat:status', () => {
        return { connected: oscClient.isConnected() };
    });

    // チャットボックスに送信
    ipcMain.handle('vrchat:chatbox', (_e, message) => {
        return { success: oscClient.sendChatbox(message) };
    });

    // アバターパラメータ送信
    ipcMain.handle('vrchat:parameter', (_e, { name, value }) => {
        return { success: oscClient.sendParameter(name, value) };
    });

    // VRオーバーレイウィンドウの開閉
    ipcMain.handle('vrchat:open-overlay', () => {
        const { createVrOverlayWindow } = require('./ipc-window.cjs');
        createVrOverlayWindow();
        return { success: true };
    });

    ipcMain.handle('vrchat:close-overlay', () => {
        if (ctx.vrOverlayWindow && !ctx.vrOverlayWindow.isDestroyed()) {
            ctx.vrOverlayWindow.close();
        }
        return { success: true };
    });

    // VRオーバーレイからのメッセージ→メインチャットに転送
    ipcMain.on('vr-overlay:send', (_e, text) => {
        const chatWindow = ctx.chatWindow;
        if (chatWindow && !chatWindow.isDestroyed()) {
            chatWindow.webContents.send('external-message', { text, source: 'vr-overlay' });
        }
    });

    // テスト送信（設定UIから、未接続なら一時接続）
    ipcMain.handle('vrchat:test', async (_e) => {
        const wasConnected = oscClient.isConnected();
        if (!wasConnected) {
            const settings = ctx.getSettingsCache() || await ctx.loadSettings();
            const host = settings?.vrchat?.host || '127.0.0.1';
            const port = settings?.vrchat?.sendPort || 9000;
            oscClient.connect(host, port);
        }
        const result = oscClient.sendChatbox('VRChat OSC接続テスト！');
        if (!wasConnected && !ctx.getSettingsCache()?.vrchat?.enabled) {
            oscClient.disconnect();
        }
        return { success: result };
    });

    // VRChat音声リスナー開始
    ipcMain.handle('vrchat:start-listener', async () => {
        try {
            const settings = ctx.getSettingsCache() || await ctx.loadSettings();
            const config = await ctx.loadConfig();
            const result = await vrchatListener.start({
                getSettings: () => ctx.getSettingsCache() || settings,
                getConfig: () => config,
                onTranscript: (text) => {
                    console.log(`[VRChat音声] ${text}`);
                    const chatWindow = ctx.chatWindow;
                    if (chatWindow && !chatWindow.isDestroyed()) {
                        chatWindow.webContents.send('vrchat-listener-transcript', text);
                    }
                },
                onStateChange: (state) => {
                    const chatWindow = ctx.chatWindow;
                    if (chatWindow && !chatWindow.isDestroyed()) {
                        chatWindow.webContents.send('vrchat-listener-state', state);
                    }
                }
            });
            return result;
        } catch (err) {
            console.error('[VRChat音声リスナー] 開始失敗:', err);
            return { success: false, error: err.message };
        }
    });

    // VRChat音声リスナー停止
    ipcMain.handle('vrchat:stop-listener', () => {
        return vrchatListener.stop();
    });

    // VRChat音声リスナー状態
    ipcMain.handle('vrchat:listener-status', () => {
        return vrchatListener.getStatus();
    });

    // VRChatプロセス検出
    ipcMain.handle('vrchat:find-process', async () => {
        const pid = await vrchatListener.findVRChatPid();
        return { found: !!pid, pid };
    });

    // VB-CABLEインストール
    ipcMain.handle('vrchat:install-vbcable', async () => {
        try {
            const result = await installVbCable();
            return { success: true, ...result };
        } catch (err) {
            console.error('VB-CABLEインストール失敗:', err);
            return { success: false, error: err.message };
        }
    });
}

module.exports = { register };
