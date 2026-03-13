'use strict';

const path = require('path');
const { app, BrowserWindow, screen, Tray, Menu, nativeImage, nativeTheme } = require('electron');

let _ctx = null;

async function createCharacterWindow() {
    const { isDev, DEV_SERVER_URL, appRoot, loadSettings, safeSend } = _ctx;
    const { DEFAULT_SETTINGS } = _ctx.constants;

    const { width, height } = screen.getPrimaryDisplay().workAreaSize;
    const settings = await loadSettings();
    const charSettings = settings.character || DEFAULT_SETTINGS.character;
    const subtitleExtra = (settings.streaming?.enabled && settings.streaming?.subtitle?.enabled) ? 80 : 0;
    const charHeight = charSettings.window.height + subtitleExtra;

    const savedX = (charSettings.window.x != null) ? charSettings.window.x : (width - charSettings.window.width - 20);
    const savedY = (charSettings.window.y != null) ? charSettings.window.y : (height - charHeight - 20);

    const winOptions = {
        width: charSettings.window.width,
        height: charHeight,
        x: savedX,
        y: savedY,
        frame: false,
        transparent: true,
        alwaysOnTop: true,
        resizable: false,
        skipTaskbar: true,
    };

    const win = new BrowserWindow({
        ...winOptions,
        webPreferences: {
            devTools: isDev,
            nodeIntegration: false,
            contextIsolation: true,
            sandbox: true,
            webSecurity: true,
            preload: path.join(appRoot, 'preload.cjs')
        },
    });

    if (isDev) {
        win.loadURL(`${DEV_SERVER_URL}/character.html`);
    } else {
        win.loadFile(path.join(appRoot, 'dist', 'renderer', 'character.html'));
    }
    // DevTools: open from tray menu when needed

    win.on('close', (e) => {
        if (!app.isQuitting) {
            e.preventDefault();
            win.hide();
        }
    });

    win.on('closed', () => { _ctx.characterWindow = null; });

    _ctx.characterWindow = win;
}

async function createChatWindow() {
    const { isDev, DEV_SERVER_URL, appRoot, loadSettings } = _ctx;
    const { DEFAULT_SETTINGS } = _ctx.constants;

    const { width, height } = screen.getPrimaryDisplay().workAreaSize;
    const settings = await loadSettings();
    const charSettings = settings.character || DEFAULT_SETTINGS.character;

    const chatWidth = 400;
    const chatHeight = 600;

    const theme = settings.theme || 'system';
    const isDark = theme === 'dark' || (theme === 'system' && nativeTheme.shouldUseDarkColors);
    const bgColor = isDark ? '#1e1e1e' : '#ffffff';

    const win = new BrowserWindow({
        width: chatWidth,
        height: chatHeight,
        x: width - charSettings.window.width - chatWidth - 40,
        y: height - chatHeight - 20,
        frame: false,
        transparent: false,
        backgroundColor: bgColor,
        alwaysOnTop: false,
        resizable: false,
        skipTaskbar: true,
        show: false,
        webPreferences: {
            devTools: isDev,
            nodeIntegration: false,
            contextIsolation: true,
            sandbox: false, // AudioContext（リップシンク振幅解析）に必要
            preload: path.join(appRoot, 'preload.cjs')
        },
    });

    if (isDev) {
        win.loadURL(`${DEV_SERVER_URL}/`);
    } else {
        win.loadFile(path.join(appRoot, 'dist', 'renderer', 'index.html'));
    }
    // DevTools: open from tray menu when needed

    win.on('close', (e) => {
        if (!app.isQuitting) {
            e.preventDefault();
            win.hide();
        }
    });

    win.on('closed', () => { _ctx.chatWindow = null; });

    _ctx.chatWindow = win;
}

function createSettingsWindow() {
    const { isDev, DEV_SERVER_URL, appRoot } = _ctx;

    if (_ctx.settingsWindow) {
        _ctx.settingsWindow.focus();
        return;
    }

    const iconPath = path.join(appRoot, 'assets', 'icon.png');
    const win = new BrowserWindow({
        width: 720,
        height: 650,
        minWidth: 600,
        minHeight: 500,
        resizable: true,
        minimizable: false,
        maximizable: false,
        icon: iconPath,
        webPreferences: {
            devTools: isDev,
            nodeIntegration: false,
            contextIsolation: true,
            sandbox: true,
            preload: path.join(appRoot, 'preload.cjs')
        }
    });

    win.setMenu(null);
    if (isDev) {
        win.loadURL(`${DEV_SERVER_URL}/settings.html`);
    } else {
        win.loadFile(path.join(appRoot, 'dist', 'renderer', 'settings.html'));
    }

    // DevTools: open from tray menu when needed

    win.on('closed', () => { _ctx.settingsWindow = null; });

    _ctx.settingsWindow = win;
}

function createTray() {
    const iconPath = path.join(_ctx.appRoot, 'assets', 'icon.png');
    const icon = nativeImage.createFromPath(iconPath);
    const tray = new Tray(icon.isEmpty() ? nativeImage.createEmpty() : icon);

    const contextMenu = Menu.buildFromTemplate([
        {
            label: '表示', click: () => {
                const cw = _ctx.characterWindow;
                const chatW = _ctx.chatWindow;
                const dw = _ctx.dockedWindow;
                if (cw) cw.show();
                if (chatW) chatW.show();
                if (dw) dw.show();
            }
        },
        {
            label: '非表示', click: () => {
                const cw = _ctx.characterWindow;
                const chatW = _ctx.chatWindow;
                const dw = _ctx.dockedWindow;
                if (cw) cw.hide();
                if (chatW) chatW.hide();
                if (dw) dw.hide();
            }
        },
        {
            label: 'チャット開閉', click: () => {
                const chatW = _ctx.chatWindow;
                const dw = _ctx.dockedWindow;
                if (dw) {
                    dw.isVisible() ? dw.hide() : dw.show();
                } else if (chatW) {
                    chatW.isVisible() ? chatW.hide() : chatW.show();
                }
            }
        },
        { type: 'separator' },
        { label: '設定', click: () => createSettingsWindow() },
        { type: 'separator' },
        { label: 'DevTools (Chat)', click: () => {
            const w = _ctx.dockedWindow || _ctx.chatWindow;
            w && w.webContents.openDevTools({ mode: 'detach' });
        }},
        { label: 'DevTools (Char)', click: () => {
            const w = _ctx.dockedWindow || _ctx.characterWindow;
            w && w.webContents.openDevTools({ mode: 'detach' });
        }},
        { type: 'separator' },
        { label: '終了', click: () => { app.isQuitting = true; app.quit(); } }
    ]);

    tray.setToolTip('Desktop Companion');
    tray.setContextMenu(contextMenu);
    tray.on('click', () => {
        const dw = _ctx.dockedWindow;
        if (dw) {
            dw.isVisible() ? dw.hide() : dw.show();
            return;
        }
        const cw = _ctx.characterWindow;
        const chatW = _ctx.chatWindow;
        if (cw) {
            cw.isVisible() ? cw.hide() : cw.show();
        }
        if (chatW && cw && cw.isVisible()) {
            chatW.isVisible() ? chatW.hide() : chatW.show();
        }
    });
}

function register(ipcMain, ctx) {
    _ctx = ctx;
    const { safeSend, transientState, loadMemoryV2Cached } = ctx;

    // チャットウィンドウ制御
    ipcMain.handle('toggle-chat', () => {
        const w = ctx.chatWindow;
        if (w) { w.isVisible() ? w.hide() : w.show(); }
    });

    ipcMain.handle('open-chat', () => {
        const w = ctx.chatWindow;
        if (w) w.show();
    });

    ipcMain.handle('close-chat', () => {
        const w = ctx.chatWindow;
        if (w) w.hide();
    });

    // 設定ウィンドウ
    ipcMain.handle('open-settings-window', () => {
        createSettingsWindow();
    });

    ipcMain.handle('close-settings-window', () => {
        const w = ctx.settingsWindow;
        if (w) w.close();
    });

    // Brain state sync (Interrupt Gate)
    ipcMain.on('brain:set-state', (event, updates) => {
        if (updates.doNotDisturb !== undefined) transientState.doNotDisturb = updates.doNotDisturb;
        if (updates.isMicListening !== undefined) transientState.isMicListening = updates.isMicListening;
        // broadcastコメント応答完了 → inflightコメントをキューから削除
        if (updates.commentsDone && Array.isArray(updates.commentsDone) && _ctx) {
            const doneIds = new Set(updates.commentsDone);
            const currentQueue = _ctx.getBroadcastQueue();
            _ctx.setBroadcastQueue(currentQueue.filter(c => !doneIds.has(c.id)));
        }
    });

    // 感情状態取得（テンポ制御 + 声トーン補正用）
    ipcMain.handle('get-emotion-state', async () => {
        const memoryV2 = await loadMemoryV2Cached();
        const emotions = memoryV2?.relationship?.emotions?.current;
        if (!emotions) return { arousal: 0.4, energy: 0.8, valence: 0.5, surprise: 0 };
        return {
            arousal: emotions.arousal ?? 0.4,
            energy: emotions.energy ?? 0.8,
            valence: emotions.valence ?? 0.5,
            surprise: emotions.surprise ?? 0
        };
    });

    // Character window: hit-test click-through（透明部分をクリックスルー）
    ipcMain.on('set-ignore-mouse-events', (event, ignore, opts) => {
        const w = ctx.characterWindow;
        if (w && !w.isDestroyed()) {
            w.setIgnoreMouseEvents(ignore, opts || {});
        }
    });

    // Character window: manual drag（-webkit-app-region: dragの代替）
    ipcMain.on('move-window-by', (event, dx, dy) => {
        const w = ctx.characterWindow;
        if (w && !w.isDestroyed()) {
            const [x, y] = w.getPosition();
            w.setPosition(x + dx, y + dy);
        }
    });

    // Lip Sync: chat → character 転送（desktopモード時のみ。dockedモードではIPC不要）
    ipcMain.on('lip-sync', (event, value, form) => {
        // dockedモードではsendLipSyncをrenderer側でパッチしているのでここには来ない
        const w = ctx.characterWindow;
        if (w && !w.isDestroyed()) {
            w.webContents.send('lip-sync', value, form);
        }
    });

    ipcMain.on('motion-trigger', (event, motion) => {
        // dockedモードではcharacterWindow = dockedWindowなのでそのまま動く
        const w = ctx.characterWindow;
        if (w && !w.isDestroyed()) {
            w.webContents.send('motion-trigger', motion);
        }
    });

    ipcMain.on('expression-change-send', (event, expression) => {
        const w = ctx.characterWindow;
        if (w && !w.isDestroyed()) {
            w.webContents.send('expression-change', expression);
        }
    });

    // 設定画面からTTSテスト（dockedモードではchatWindow = dockedWindowなので自動的にルーティング）
    ipcMain.on('tts-test-speak', (event, text) => {
        const w = ctx.chatWindow;
        if (w && !w.isDestroyed()) {
            w.webContents.send('tts-test-speak', text);
        }
    });

    ipcMain.handle('restart-app', () => {
        app.relaunch();
        app.exit(0);
    });

    // Docked mode: window controls (minimize/hide)
    ipcMain.handle('minimize-window', (event) => {
        const win = BrowserWindow.fromWebContents(event.sender);
        if (win) win.minimize();
    });

    ipcMain.handle('hide-window', (event) => {
        const win = BrowserWindow.fromWebContents(event.sender);
        if (win) win.hide();
    });

    // 設定をリアルタイム反映
    ipcMain.handle('apply-character-settings', async (event, charSettings) => {
        // dockedモードではウィンドウリサイズをスキップ（dockedWindowはcharacterWindowを兼ねる）
        if (ctx.dockedWindow) {
            // 設定変更イベントだけ送る（キャラレンダラーの更新に使われる）
            const dw = ctx.dockedWindow;
            if (dw && !dw.isDestroyed()) {
                dw.webContents.send('settings-changed', charSettings);
            }
            return { success: true };
        }

        const cw = ctx.characterWindow;

        // Show/hide character window
        if (charSettings.showWindow === false) {
            if (cw && !cw.isDestroyed()) {
                cw.hide();
            }
        } else {
            if (!cw || cw.isDestroyed()) {
                await createCharacterWindow();
            } else {
                cw.show();
            }
        }

        if (cw && !cw.isDestroyed() && charSettings.showWindow !== false) {
            if (cw.isFullScreen()) cw.setFullScreen(false);
            cw.setMovable(true);
            const current = cw.getBounds();
            const newX = (charSettings.window.x != null) ? charSettings.window.x : current.x;
            const newY = (charSettings.window.y != null) ? charSettings.window.y : current.y;
            cw.setBounds({
                width: charSettings.window.width,
                height: charSettings.window.height,
                x: newX,
                y: newY
            });
            cw.webContents.send('settings-changed', charSettings);
        }
        return { success: true };
    });

    // 接続ディスプレイ一覧を取得
    ipcMain.handle('get-displays', async () => {
        const displays = screen.getAllDisplays();
        const primary = screen.getPrimaryDisplay();
        return displays.map((d, i) => ({
            index: i,
            id: d.id,
            label: `${d.size.width}x${d.size.height}${d.id === primary.id ? ' (メイン)' : ''}`,
            width: d.size.width,
            height: d.size.height,
            isPrimary: d.id === primary.id
        }));
    });

    // キャラウィンドウの現在位置を取得
    ipcMain.handle('get-character-window-bounds', async () => {
        const cw = ctx.characterWindow;
        if (!cw) return null;
        const bounds = cw.getBounds();
        return { x: bounds.x, y: bounds.y, width: bounds.width, height: bounds.height };
    });
}

async function createDockedWindow() {
    const { isDev, DEV_SERVER_URL, appRoot, loadSettings } = _ctx;
    const { DEFAULT_SETTINGS } = _ctx.constants;

    const { width, height } = screen.getPrimaryDisplay().workAreaSize;
    const settings = await loadSettings();

    const theme = settings.theme || 'system';
    const isDark = theme === 'dark' || (theme === 'system' && nativeTheme.shouldUseDarkColors);
    const bgColor = isDark ? '#18181b' : '#f8f9fa';

    const iconPath = path.join(appRoot, 'assets', 'icon.png');

    const win = new BrowserWindow({
        width: 900,
        height: 600,
        frame: false,
        transparent: false,
        backgroundColor: bgColor,
        alwaysOnTop: false,
        resizable: true,
        skipTaskbar: false,
        show: true,
        icon: iconPath,
        webPreferences: {
            devTools: isDev,
            nodeIntegration: false,
            contextIsolation: true,
            sandbox: false, // AudioContext（リップシンク振幅解析）に必要
            preload: path.join(appRoot, 'preload.cjs')
        },
    });

    if (isDev) {
        win.loadURL(`${DEV_SERVER_URL}/docked.html`);
    } else {
        win.loadFile(path.join(appRoot, 'dist', 'renderer', 'docked.html'));
    }

    win.on('close', (e) => {
        if (!app.isQuitting) {
            e.preventDefault();
            win.hide();
        }
    });

    win.on('closed', () => {
        _ctx.dockedWindow = null;
        _ctx.characterWindow = null;
        _ctx.chatWindow = null;
    });

    // dockedモードではcharacterWindowとchatWindowを同一ウィンドウに向ける
    // これによりIPC転送（lip-sync, expression-change等）がそのまま動く
    _ctx.dockedWindow = win;
    _ctx.characterWindow = win;
    _ctx.chatWindow = win;
    console.log('🪟 Dockedウィンドウ作成');
}

function createVrOverlayWindow() {
    const { isDev, DEV_SERVER_URL, appRoot } = _ctx;

    if (_ctx.vrOverlayWindow) {
        _ctx.vrOverlayWindow.focus();
        return;
    }

    const win = new BrowserWindow({
        width: 380,
        height: 300,
        frame: false,
        transparent: true,
        alwaysOnTop: true,
        resizable: true,
        skipTaskbar: false,
        show: true,
        backgroundColor: '#00000000',
        hasShadow: false,
        webPreferences: {
            devTools: isDev,
            nodeIntegration: false,
            contextIsolation: true,
            sandbox: true,
            preload: path.join(appRoot, 'preload.cjs')
        },
    });

    if (isDev) {
        win.loadURL(`${DEV_SERVER_URL}/vr-overlay.html`);
    } else {
        win.loadFile(path.join(appRoot, 'dist', 'renderer', 'vr-overlay.html'));
    }

    win.on('closed', () => { _ctx.vrOverlayWindow = null; });

    _ctx.vrOverlayWindow = win;
    console.log('🎮 VRオーバーレイウィンドウ作成');
}

module.exports = { register, createCharacterWindow, createChatWindow, createDockedWindow, createSettingsWindow, createTray, createVrOverlayWindow };
