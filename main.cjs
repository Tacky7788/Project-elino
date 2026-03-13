const { app, ipcMain, shell, BrowserWindow: SetupBrowserWindow } = require("electron");
const path = require("path");
const fs = require("fs").promises;
const fsSync = require("fs");
const http = require("http");
const { createReadStream } = require("fs");
const { wrapIpcMain, startWebServer } = require("./src/core/web-server.cjs");

// ipcMainをラップしてHTTPエンドポイントも自動登録
wrapIpcMain(ipcMain);

// GPU描画最適化
app.commandLine.appendSwitch('enable-gpu-rasterization');
app.commandLine.appendSwitch('enable-zero-copy');
app.commandLine.appendSwitch('ignore-gpu-blocklist');

// ====== ログファイル出力 ======
// console.log/error をファイルにも書き出す（デバッグ用）
const LOG_FILE = path.join(__dirname, 'app-log.txt');
try { fsSync.writeFileSync(LOG_FILE, `=== eito started at ${new Date().toISOString()} ===\n`); } catch(_) {}
const _origLog = console.log;
const _origError = console.error;
const _origWarn = console.warn;
function _writeLog(prefix, args) {
    try {
        const line = `[${new Date().toISOString()}] ${prefix} ${args.map(a => typeof a === 'string' ? a : JSON.stringify(a, null, 0)).join(' ')}\n`;
        fsSync.appendFileSync(LOG_FILE, line);
    } catch(_) {}
}
console.log = (...args) => { _origLog(...args); _writeLog('LOG', args); };
console.error = (...args) => { _origError(...args); _writeLog('ERR', args); };
console.warn = (...args) => { _origWarn(...args); _writeLog('WRN', args); };
const brain = require("./src/core/brain.cjs");
const llmProvider = require("./src/core/llm-provider.cjs");
const { CommentSourceManager } = require("./src/core/comment-source.cjs");
const constants = require("./src/core/constants.cjs");
const {
    COMPANION_DIR, USER_FILE, SETTINGS_FILE, CONFIG_FILE,
    MEMORY_FILE, DEFAULT_MEMORY_V2, DEFAULT_USER, DEFAULT_STATE, DEFAULT_SETTINGS,
    updateSlotPaths, getFilePaths
} = constants;
const {
    buildSystemPrompt, buildBroadcastSystemPrompt, buildProactiveSystemPrompt, buildStateMessage
} = require("./src/core/prompt-builders.cjs");
const { registerTtsHandlers } = require("./src/core/ipc-tts.cjs");
// Google OAuth removed for public release (credentials were hardcoded)
const googleOAuth = null;

// ====== モジュール読み込み ======
const ipcExport = require("./src/core/ipc-export.cjs");
const ipcFile = require("./src/core/ipc-file.cjs");
const ipcSlot = require("./src/core/ipc-slot.cjs");
const ipcData = require("./src/core/ipc-data.cjs");
const ipcWindow = require("./src/core/ipc-window.cjs");
const ipcOpenClaw = require("./src/core/ipc-openclaw.cjs");
const ipcLlm = require("./src/core/ipc-llm.cjs");
const ipcMemoryApply = require("./src/core/ipc-memory-apply.cjs");
const ipcVrchat = require("./src/core/ipc-vrchat.cjs");
const oscClient = require("./src/core/osc-client.cjs");
const brainTick = require("./src/core/brain-tick.cjs");

// app.disableHardwareAcceleration(); // WebGL(VRM/Live2D)がCPUフォールバックになるため無効化

// ====== 環境判定 ======
const isDev = process.env.NODE_ENV === 'development';
const DEV_SERVER_PORT = process.env.DEV_PORT || 5173;
const DEV_SERVER_URL = `http://localhost:${DEV_SERVER_PORT}`;

// ====== 定数設定 ======
const CONFIG = {
    SUMMARY_CHUNK_SIZE: 10,
    HISTORY_DEFAULT_LIMIT: 20,
    PROACTIVE_STARTUP_DELAY_MS: isDev ? 30000 : 120000,
    PROACTIVE_CHECK_INTERVAL_MS: isDev ? 60000 : 300000,
};

// ====== ウィンドウ参照 ======
let characterWindow = null;
let chatWindow = null;
let settingsWindow = null;
let vrOverlayWindow = null;
let dockedWindow = null;

// ====== Single Writer: キャッシュ + キュー ======
let _memoryV2Cache = null;
let _stateCache = null;
let _settingsCache = null;
let _memoryV2Dirty = false;
let _stateDirty = false;
let _writeQueued = false;
let _flushRetryCount = 0;
const FLUSH_MAX_RETRIES = 3;

// ====== Transient State ======
const transientState = {
    doNotDisturb: false,
    isMicListening: false,
    lastBrainSpokeAt: 0,
    isLLMStreaming: false
};

// ====== Streaming/配信 ======
const commentSource = new CommentSourceManager();
let _subtitleText = '';
let _subtitleClearTimer = null;
let _broadcastCommentQueue = [];

// ====== ヘルパー関数 ======

function safeSend(win, channel, ...args) {
    try {
        if (win && !win.isDestroyed() && win.webContents) {
            win.webContents.send(channel, ...args);
        }
    } catch (e) {
        // タイミング競合を吸収
    }
    // WebSocketクライアントにもブロードキャスト
    if (ctx.webBroadcast) {
        ctx.webBroadcast(channel, args.length === 1 ? args[0] : args);
    }
}

function forwardSubtitle(delta) {
    if (!characterWindow || characterWindow.isDestroyed()) return;
    const clean = delta.replace(/<!--CONFIG_UPDATE:.*?-->/gs, '');
    if (!clean) return;
    _subtitleText += clean;
    safeSend(characterWindow, 'subtitle-update', { text: _subtitleText, clear: false });
}

function clearSubtitleAfterDelay(fadeMs) {
    if (_subtitleClearTimer) clearTimeout(_subtitleClearTimer);
    _subtitleClearTimer = setTimeout(() => {
        if (characterWindow && !characterWindow.isDestroyed()) {
            safeSend(characterWindow, 'subtitle-update', { text: '', clear: true });
        }
        _subtitleClearTimer = null;
    }, fadeMs);
    _subtitleText = '';
}

async function atomicWrite(filePath, data) {
    const tmp = filePath + '.tmp';
    await fs.writeFile(tmp, data, 'utf-8');
    try {
        await fs.rename(tmp, filePath);
    } catch (renameErr) {
        await fs.copyFile(tmp, filePath);
        await fs.unlink(tmp).catch(() => {});
    }
}

function markDirty(target) {
    if (target === 'memory' || target === 'both') _memoryV2Dirty = true;
    if (target === 'state' || target === 'both') _stateDirty = true;
    if (!_writeQueued) {
        _writeQueued = true;
        const isBroadcast = _settingsCache?.streaming?.broadcastMode && _settingsCache?.streaming?.enabled;
        setTimeout(flushDirty, isBroadcast ? 5000 : 500);
    }
}

let _isFlushing = false;
async function flushDirty() {
    _writeQueued = false;
    if (_isFlushing) {
        setTimeout(flushDirty, 500);
        return;
    }
    _isFlushing = true;
    try {
        if (_memoryV2Dirty && _memoryV2Cache) {
            _memoryV2Cache.updatedAt = new Date().toISOString();
            await atomicWrite(getFilePaths().MEMORY_V2_FILE, JSON.stringify(_memoryV2Cache, null, 2));
            _memoryV2Dirty = false;
        }
        if (_stateDirty && _stateCache) {
            await atomicWrite(getFilePaths().STATE_FILE, JSON.stringify(_stateCache, null, 2));
            _stateDirty = false;
        }
        _flushRetryCount = 0;
    } catch (err) {
        console.error('❌ flush失敗:', err);
        _flushRetryCount++;
        if (_flushRetryCount < FLUSH_MAX_RETRIES) {
            setTimeout(flushDirty, 2000);
        } else {
            console.error('❌ flush最大リトライ超過、諦め');
            _flushRetryCount = 0;
        }
    } finally {
        _isFlushing = false;
    }
}

// ====== ロード関数 ======

async function ensureCompanionDir() {
    try {
        await fs.mkdir(COMPANION_DIR, { recursive: true });
    } catch (err) {
        console.error('companionディレクトリ作成失敗:', err);
    }
}

async function loadConfig() {
    let fileConfig = { openaiApiKey: '', anthropicApiKey: '', googleApiKey: '', groqApiKey: '', deepseekApiKey: '', elevenlabsApiKey: '', googleTtsApiKey: '' };
    try {
        const data = await fs.readFile(CONFIG_FILE, 'utf-8');
        fileConfig = { ...fileConfig, ...JSON.parse(data) };
    } catch (err) { /* ファイルがなければデフォルト */ }
    if (process.env.OPENAI_API_KEY && !fileConfig.openaiApiKey) {
        fileConfig.openaiApiKey = process.env.OPENAI_API_KEY;
    }
    return fileConfig;
}

// deep merge: デフォルト設定にユーザー設定を再帰的にマージ
function deepMerge(defaults, saved) {
    const result = { ...defaults };
    for (const key of Object.keys(saved)) {
        if (saved[key] !== undefined) {
            if (typeof defaults[key] === 'object' && defaults[key] !== null && !Array.isArray(defaults[key])
                && typeof saved[key] === 'object' && saved[key] !== null && !Array.isArray(saved[key])) {
                result[key] = deepMerge(defaults[key], saved[key]);
            } else {
                result[key] = saved[key];
            }
        }
    }
    return result;
}

async function loadSettings() {
    if (_settingsCache) return _settingsCache;
    try {
        const data = await fs.readFile(SETTINGS_FILE, 'utf-8');
        const saved = JSON.parse(data);
        const merged = deepMerge(DEFAULT_SETTINGS, saved);
        _settingsCache = merged;
        return merged;
    } catch (err) {
        return DEFAULT_SETTINGS;
    }
}

async function loadProfile() {
    try {
        const data = await fs.readFile(getFilePaths().PROFILE_FILE, 'utf-8');
        return JSON.parse(data);
    } catch (err) {
        return constants.DEFAULT_PROFILE;
    }
}

async function loadPersonality() {
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
        return constants.DEFAULT_PERSONALITY;
    }
}

async function loadMemoryV2() {
    try {
        const data = await fs.readFile(getFilePaths().MEMORY_V2_FILE, 'utf-8');
        const saved = JSON.parse(data);
        // デフォルトスキーマとdeep merge（新フィールド追加時に自動補完）
        // 配列フィールドは保存値を優先（デフォルトの空配列で上書きしない）
        const defaults = JSON.parse(JSON.stringify(DEFAULT_MEMORY_V2));
        return deepMergeMemory(defaults, saved);
    } catch (err) {
        return JSON.parse(JSON.stringify(DEFAULT_MEMORY_V2));
    }
}

// memoryV2用deep merge: 配列は保存値優先、オブジェクトは再帰マージ
function deepMergeMemory(defaults, saved) {
    const result = { ...defaults };
    for (const key of Object.keys(saved)) {
        if (saved[key] === undefined) continue;
        if (Array.isArray(saved[key])) {
            // 配列は保存値をそのまま使う（デフォルトの空配列で上書きしない）
            result[key] = saved[key];
        } else if (typeof defaults[key] === 'object' && defaults[key] !== null
            && typeof saved[key] === 'object' && saved[key] !== null) {
            result[key] = deepMergeMemory(defaults[key], saved[key]);
        } else {
            result[key] = saved[key];
        }
    }
    return result;
}

async function loadMemoryV2Cached() {
    if (_memoryV2Cache) return _memoryV2Cache;
    _memoryV2Cache = await loadMemoryV2();
    return _memoryV2Cache;
}

async function loadStateCached() {
    if (_stateCache) return _stateCache;
    _stateCache = await loadState();
    return _stateCache;
}

async function loadState() {
    try {
        const data = await fs.readFile(getFilePaths().STATE_FILE, 'utf-8');
        const saved = JSON.parse(data);
        return { ...DEFAULT_STATE, ...saved };
    } catch (err) {
        return { ...DEFAULT_STATE };
    }
}

async function saveState(state) {
    await ensureCompanionDir();
    state.rev = (state.rev || 0) + 1;
    _stateCache = state;
    markDirty('state');
}

async function loadUser() {
    try {
        const data = await fs.readFile(USER_FILE, 'utf-8');
        return JSON.parse(data);
    } catch (err) {
        return DEFAULT_USER;
    }
}

// history読み込みキャッシュ（3秒TTL）
let _historyCacheLines = null;
let _historyCacheAt = 0;
const HISTORY_CACHE_TTL_MS = 3000;

async function loadHistory(limit = 10) {
    const now = Date.now();
    if (_historyCacheLines && now - _historyCacheAt < HISTORY_CACHE_TTL_MS) {
        return limit > 0 ? _historyCacheLines.slice(-limit) : [..._historyCacheLines];
    }
    try {
        const data = await fs.readFile(getFilePaths().HISTORY_FILE, 'utf-8');
        const lines = data.trim().split('\n').filter(Boolean);
        _historyCacheLines = lines.map(line => JSON.parse(line));
        _historyCacheAt = now;
        return limit > 0 ? _historyCacheLines.slice(-limit) : [..._historyCacheLines];
    } catch (err) {
        return [];
    }
}

function invalidateHistoryCache() {
    _historyCacheLines = null;
    _historyCacheAt = 0;
}

async function updateStreamingMode(settings) {
    const streaming = settings.streaming;
    if (!streaming?.enabled || streaming.commentSource === 'none') {
        commentSource.stop();
        _broadcastCommentQueue = [];
        console.log('📺 配信コメントソース: 停止');
        return;
    }
    const config = await loadConfig();
    const googleApiKey = config.googleApiKey || process.env.GOOGLE_GENERATIVE_AI_API_KEY || '';
    const filter = streaming.commentFilter || {};
    commentSource.setCallbacks({
        onComment: (comment) => {
            if (filter.ignoreHashPrefix && comment.text.startsWith('#')) return;
            if (filter.minLengthChars && comment.text.length < (filter.minLengthChars || 2)) return;

            console.log(`💬 コメント受信: [${comment.platform}] ${comment.author}: ${comment.text}`);
            if (chatWindow && !chatWindow.isDestroyed()) {
                safeSend(chatWindow, 'comment-received', comment);
            }

            if (streaming.broadcastMode) {
                if (!_broadcastCommentQueue.some(c => c.id === comment.id)) {
                    _broadcastCommentQueue.push({
                        ...comment,
                        timestamp: Date.now()
                    });
                    const maxSize = filter.maxQueueSize || 20;
                    if (_broadcastCommentQueue.length > maxSize) {
                        _broadcastCommentQueue = _broadcastCommentQueue.slice(-maxSize);
                    }
                }
            }
        },
        onError: (error) => {
            console.error('💬 コメントソースエラー:', error);
        }
    });
    await commentSource.start(streaming, googleApiKey);
    console.log(`📺 配信コメントソース開始: ${streaming.commentSource}${streaming.broadcastMode ? ' (配信モード)' : ''}`);
}

// ====== 共有コンテキスト ======

const ctx = {
    // ウィンドウ参照
    get characterWindow() { return characterWindow; },
    set characterWindow(w) { characterWindow = w; },
    get chatWindow() { return chatWindow; },
    set chatWindow(w) { chatWindow = w; },
    get settingsWindow() { return settingsWindow; },
    set settingsWindow(w) { settingsWindow = w; },
    get vrOverlayWindow() { return vrOverlayWindow; },
    set vrOverlayWindow(w) { vrOverlayWindow = w; },
    get dockedWindow() { return dockedWindow; },
    set dockedWindow(w) { dockedWindow = w; },

    // Single Writer キャッシュ
    getMemoryV2Cache: () => _memoryV2Cache,
    setMemoryV2Cache: (v) => { _memoryV2Cache = v; },
    getStateCache: () => _stateCache,
    setStateCache: (v) => { _stateCache = v; },
    getSettingsCache: () => _settingsCache,
    setSettingsCache: (v) => { _settingsCache = v; },
    getMemoryV2Dirty: () => _memoryV2Dirty,
    setMemoryV2Dirty: (v) => { _memoryV2Dirty = v; },
    getStateDirty: () => _stateDirty,
    setStateDirty: (v) => { _stateDirty = v; },

    // Transient state
    transientState,

    // 配信関連
    commentSource,
    getSubtitleText: () => _subtitleText,
    setSubtitleText: (v) => { _subtitleText = v; },
    getBroadcastQueue: () => _broadcastCommentQueue,
    setBroadcastQueue: (v) => { _broadcastCommentQueue = v; },

    // ヘルパー
    markDirty,
    flushDirty,
    safeSend,
    forwardSubtitle,
    clearSubtitleAfterDelay,
    atomicWrite,
    updateStreamingMode,

    // ロード関数
    loadConfig,
    loadSettings,
    loadProfile,
    loadPersonality,
    loadMemoryV2,
    loadMemoryV2Cached,
    loadStateCached,
    loadState,
    saveState,
    loadHistory,
    invalidateHistoryCache,
    loadUser,
    ensureCompanionDir,

    // 外部モジュール
    llmProvider,
    brain,
    googleOAuth,
    constants,
    buildSystemPrompt,
    buildBroadcastSystemPrompt,
    buildProactiveSystemPrompt,
    buildStateMessage,
    CommentSourceManager,

    // 設定定数
    CONFIG,
    isDev,
    DEV_SERVER_URL,
    DEV_SERVER_PORT,
    appRoot: __dirname,

    // cross-module (brain-tick)
    startBrainTick: (settings) => brainTick.startBrainTick(settings),
    stopBrainTick: () => brainTick.stopBrainTick(),
};

// ====== クラッシュハンドラ ======

process.on('uncaughtException', (err) => {
    console.error('💥 uncaughtException:', err);
    try {
        if (_stateDirty && _stateCache) {
            fsSync.writeFileSync(getFilePaths().STATE_FILE, JSON.stringify(_stateCache, null, 2), 'utf-8');
        }
        if (_memoryV2Dirty && _memoryV2Cache) {
            _memoryV2Cache.updatedAt = new Date().toISOString();
            fsSync.writeFileSync(getFilePaths().MEMORY_V2_FILE, JSON.stringify(_memoryV2Cache, null, 2), 'utf-8');
        }
    } catch (_) { /* 保存失敗してもクラッシュさせない */ }
});

process.on('unhandledRejection', (reason) => {
    console.error('💥 unhandledRejection:', reason);
});

// ====== モジュール初期化 + IPCハンドラ登録 ======

brainTick.init(ctx);

registerTtsHandlers(ipcMain, { loadConfig, loadSettings });

// ====== External API（ClaudeCode TTS連携） ======
let externalApiServer = null;
let _externalApiToken = null;

function generateApiToken() {
    return require('crypto').randomBytes(32).toString('hex');
}

function startExternalApiServer(port) {
    if (externalApiServer) { externalApiServer.close(); externalApiServer = null; }
    // 起動時にトークン生成（毎回変わる）
    _externalApiToken = generateApiToken();
    // トークンをファイルに書き出し（外部ツールから読み取り用）
    const tokenPath = path.join(app.getPath('userData'), 'external-api-token.txt');
    try {
        fsSync.writeFileSync(tokenPath, _externalApiToken, 'utf-8');
        console.log(`[External API] token saved to ${tokenPath}`);
    } catch (e) {
        console.error('[External API] failed to save token:', e.message);
    }

    externalApiServer = http.createServer((req, res) => {
        // トークン認証
        const authHeader = req.headers['authorization'] || '';
        const token = authHeader.replace(/^Bearer\s+/i, '');
        if (token !== _externalApiToken) {
            res.writeHead(401, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: 'unauthorized' }));
            return;
        }

        if (req.method === 'POST' && req.url === '/speak') {
            let body = '';
            req.on('data', chunk => body += chunk);
            req.on('end', () => {
                try {
                    const { text } = JSON.parse(body);
                    console.log('[external:speak] chatWindow:', chatWindow ? 'exists' : 'null', 'text:', text?.slice(0, 30));
                    if (text && chatWindow && !chatWindow.isDestroyed()) {
                        chatWindow.webContents.send('external:speak', text);
                        console.log('[external:speak] sent to chatWindow');
                    }
                    res.writeHead(200, { 'Content-Type': 'application/json' });
                    res.end(JSON.stringify({ ok: true }));
                } catch (e) {
                    res.writeHead(400);
                    res.end(JSON.stringify({ error: 'invalid json' }));
                }
            });
        } else {
            res.writeHead(404);
            res.end();
        }
    });
    externalApiServer.listen(port, '127.0.0.1', () => {
        console.log(`[External API] listening on 127.0.0.1:${port}`);
    });
    externalApiServer.on('error', err => console.error('[External API] error:', err.message));
}

ipcMain.on('external-api:update', (_, { enabled, port }) => {
    if (enabled) startExternalApiServer(port);
    else if (externalApiServer) {
        externalApiServer.close(); externalApiServer = null; _externalApiToken = null;
        // トークンファイル削除
        try { fsSync.unlinkSync(path.join(app.getPath('userData'), 'external-api-token.txt')); } catch {}
    }
});

// External APIトークン取得（設定画面やClaude Code bridgeから使用）
ipcMain.handle('external-api:get-token', () => _externalApiToken);

ipcExport.register(ipcMain, ctx);
ipcFile.register(ipcMain, ctx);
ipcSlot.register(ipcMain, ctx);
ipcData.register(ipcMain, ctx);
ipcWindow.register(ipcMain, ctx);
ipcOpenClaw.register(ipcMain, ctx);
ipcLlm.register(ipcMain, ctx);
ipcMemoryApply.register(ipcMain, ctx);
ipcVrchat.register(ipcMain, ctx);

// Shell: 外部URLをシステムブラウザで開く
ipcMain.handle('open-external', (_e, url) => {
  if (typeof url === 'string' && (url.startsWith('https://') || url.startsWith('http://'))) {
    return shell.openExternal(url);
  }
});

// ====== Sample Model Auto-Download ======

const SAMPLE_MODELS = {
    vrm: {
        url: 'https://dist.ayaka.moe/vrm-models/VRoid-Hub/AvatarSample-A/AvatarSample_A.vrm',
        dest: 'AvatarSample-A/AvatarSample_A.vrm',
    },
    live2d: {
        url: 'https://dist.ayaka.moe/live2d-models/hiyori_pro_zh.zip',
        dest: 'hiyori_pro/hiyori_pro_zh.zip',
        extract: true,
    },
};

function httpsDownload(url, destPath) {
    const https = require('https');
    return new Promise((resolve, reject) => {
        const follow = (u) => {
            https.get(u, (res) => {
                if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
                    follow(res.headers.location);
                    return;
                }
                if (res.statusCode !== 200) {
                    reject(new Error(`Download failed: ${res.statusCode}`));
                    return;
                }
                const file = fsSync.createWriteStream(destPath);
                res.pipe(file);
                file.on('finish', () => { file.close(); resolve(); });
                file.on('error', reject);
            }).on('error', reject);
        };
        follow(url);
    });
}

async function extractZipToDir(zipPath, destDir) {
    const yauzl = require('yauzl');
    return new Promise((resolve, reject) => {
        yauzl.open(zipPath, { lazyEntries: true }, (err, zipfile) => {
            if (err) return reject(err);
            zipfile.readEntry();
            zipfile.on('entry', (entry) => {
                // path traversal防止
                const resolvedPath = path.resolve(destDir, entry.fileName);
                if (!resolvedPath.startsWith(path.resolve(destDir) + path.sep) && resolvedPath !== path.resolve(destDir)) {
                    console.warn(`⚠️ ZIP path traversal blocked: ${entry.fileName}`);
                    zipfile.readEntry();
                    return;
                }
                if (/\/$/.test(entry.fileName)) {
                    fsSync.mkdirSync(resolvedPath, { recursive: true });
                    zipfile.readEntry();
                } else {
                    const filePath = resolvedPath;
                    fsSync.mkdirSync(path.dirname(filePath), { recursive: true });
                    zipfile.openReadStream(entry, (err2, stream) => {
                        if (err2) return reject(err2);
                        const out = fsSync.createWriteStream(filePath);
                        stream.pipe(out);
                        out.on('finish', () => zipfile.readEntry());
                    });
                }
            });
            zipfile.on('end', resolve);
            zipfile.on('error', reject);
        });
    });
}

async function downloadSampleModelIfNeeded() {
    const modelsDir = path.join(__dirname, 'public', 'live2d', 'models');
    try {
        await fs.mkdir(modelsDir, { recursive: true });
        const entries = await fs.readdir(modelsDir, { recursive: true });
        const hasModel = entries.some(f => /\.(vrm|model3\.json|moc3)$/i.test(f));
        if (hasModel) return;
    } catch { return; }

    console.log('No models found. Downloading sample models...');

    // Download VRM
    try {
        const vrmDir = path.join(modelsDir, 'AvatarSample-A');
        await fs.mkdir(vrmDir, { recursive: true });
        const vrmPath = path.join(modelsDir, SAMPLE_MODELS.vrm.dest);
        console.log('Downloading VRM sample...');
        await httpsDownload(SAMPLE_MODELS.vrm.url, vrmPath);
        console.log('VRM sample downloaded:', vrmPath);
    } catch (e) {
        console.error('Failed to download VRM sample:', e.message);
    }

    // Download Live2D model (zip)
    try {
        const live2dDir = path.join(modelsDir, 'hiyori_pro');
        await fs.mkdir(live2dDir, { recursive: true });
        const zipPath = path.join(modelsDir, SAMPLE_MODELS.live2d.dest);
        console.log('Downloading Live2D sample...');
        await httpsDownload(SAMPLE_MODELS.live2d.url, zipPath);
        console.log('Extracting Live2D sample...');
        await extractZipToDir(zipPath, live2dDir);
        await fs.unlink(zipPath).catch(() => {});
        console.log('Live2D sample ready:', live2dDir);
    } catch (e) {
        console.error('Failed to download Live2D sample:', e.message);
    }

    // Update settings to use VRM by default
    try {
        const settingsPath = getFilePaths().SETTINGS_FILE;
        let settings = {};
        try { settings = JSON.parse(fsSync.readFileSync(settingsPath, 'utf-8')); } catch {}
        if (!settings.character) settings.character = {};
        if (!settings.character.model) settings.character.model = {};
        settings.character.model.path = '/live2d/models/AvatarSample-A/AvatarSample_A.vrm';
        settings.character.modelType = 'vrm';
        await fs.writeFile(settingsPath, JSON.stringify(settings, null, 2), 'utf-8');
        console.log('Settings updated to use sample VRM');
    } catch (e) {
        console.error('Failed to update settings:', e.message);
    }
}

// ====== アプリケーション起動 ======

app.whenReady().then(async () => {
    // Live2D SDK check
    const CUBISM_CORE_PATH = path.join(__dirname, 'public', 'lib', 'live2dcubismcore.min.js');
    if (!fsSync.existsSync(CUBISM_CORE_PATH)) {
        let skipSetup = false;
        try {
            const settingsPath = getFilePaths().SETTINGS_FILE;
            const settings = JSON.parse(fsSync.readFileSync(settingsPath, 'utf-8'));
            skipSetup = !!settings.skipSdkSetup;
        } catch {}
        if (!skipSetup) {
            const sdkReady = await showSdkSetup();
            if (!sdkReady) {
                console.log('Live2D SDK skipped — VRM only mode');
            }
        }
    }

    // Download sample VRM model if no models exist
    await downloadSampleModelIfNeeded();

    await ensureCompanionDir();
    await ipcSlot.migrateToSlots();

    // Read windowMode and character visibility settings
    let showCharWindow = true;
    let windowMode = 'desktop';
    try {
        const s = JSON.parse(fsSync.readFileSync(SETTINGS_FILE, 'utf-8'));
        if (s.character?.showWindow === false) showCharWindow = false;
        if (s.windowMode) windowMode = s.windowMode;
        // debug: console.log(`📋 windowMode: ${windowMode}`);
    } catch (e) {
        console.log('⚠️ settings.json読み取り失敗:', e.message);
    }

    if (windowMode === 'docked') {
        // Dockedモード: キャラ+チャットを1ウィンドウに統合
        await ipcWindow.createDockedWindow();
    } else {
        // Desktopモード（デフォルト）: 分離ウィンドウ
        if (showCharWindow) {
            await ipcWindow.createCharacterWindow();
        }
        await ipcWindow.createChatWindow();
    }
    ipcWindow.createTray();

    // 初回セットアップチェック
    setTimeout(async () => {
        // dockedモードではdockedWindowがチャットUIを含む
        const setupTargetWindow = dockedWindow || chatWindow;
        if (setupTargetWindow) {
            const state = await loadStateCached();
            if (!state.setupComplete) {
                try {
                    const userData = JSON.parse(await fs.readFile(USER_FILE, 'utf-8'));
                    if (userData.name && userData.name.length > 0) {
                        console.log('🔧 setupComplete復旧: ユーザーデータ検出済み');
                        state.setupComplete = true;
                        markDirty('state');
                        return;
                    }
                } catch (e) {
                    // ファイルが無い → 本当に初回
                }
                console.log('🎉 初回セットアップ開始');
                setupTargetWindow.show();
                setupTargetWindow.webContents.send('start-setup');
            }
        }
    }, 1000);

    // brainTick 開始
    const settings = await loadSettings();
    if (settings.proactive.enabled) {
        brainTick.startBrainTick(settings);
    }

    // VRChat OSC接続
    if (settings.vrchat?.enabled) {
        oscClient.connect(settings.vrchat.host, settings.vrchat.sendPort);
    }

    // 配信モード開始
    await updateStreamingMode(settings);

    // External API自動起動
    if (settings.externalApi?.enabled) {
        startExternalApiServer(settings.externalApi.port || 5174);
    }

    // Web Server起動（設定で有効な場合のみ）
    startOrStopWebServer(settings);
});

let _webServerInstance = null;
function startOrStopWebServer(settings) {
    if (settings.webServer?.enabled) {
        if (_webServerInstance) { _webServerInstance.server.close(); _webServerInstance = null; }
        const webPort = settings.webServer?.port || 3939;
        const staticDir = isDev ? null : path.join(__dirname, 'dist', 'renderer');
        _webServerInstance = startWebServer(webPort, {
            staticDir,
            getWindows: () => ({ characterWindow, chatWindow, settingsWindow, vrOverlayWindow }),
        });
        ctx.webBroadcast = _webServerInstance.broadcast;
    } else {
        if (_webServerInstance) { _webServerInstance.server.close(); _webServerInstance = null; }
        ctx.webBroadcast = () => {};
    }
}

// 設定変更時にWeb Serverを再起動/停止するためにctxに公開
ctx.startOrStopWebServer = startOrStopWebServer;

// ====== 終了処理 ======

app.on('before-quit', () => {
    brainTick.stopBrainTick();
    oscClient.disconnect();
    try {
        if (_stateDirty && _stateCache) {
            fsSync.writeFileSync(getFilePaths().STATE_FILE, JSON.stringify(_stateCache, null, 2), 'utf-8');
            _stateDirty = false;
        }
        if (_memoryV2Dirty && _memoryV2Cache) {
            _memoryV2Cache.updatedAt = new Date().toISOString();
            fsSync.writeFileSync(getFilePaths().MEMORY_V2_FILE, JSON.stringify(_memoryV2Cache, null, 2), 'utf-8');
            _memoryV2Dirty = false;
        }
    } catch (e) {
        console.error('before-quit flush error:', e);
    }
});

app.on("window-all-closed", (e) => {
    if (!app.isQuitting) e.preventDefault();
    try {
        if (_stateDirty && _stateCache) {
            fsSync.writeFileSync(getFilePaths().STATE_FILE, JSON.stringify(_stateCache, null, 2), 'utf-8');
            _stateDirty = false;
        }
        if (_memoryV2Dirty && _memoryV2Cache) {
            _memoryV2Cache.updatedAt = new Date().toISOString();
            fsSync.writeFileSync(getFilePaths().MEMORY_V2_FILE, JSON.stringify(_memoryV2Cache, null, 2), 'utf-8');
            _memoryV2Dirty = false;
        }
    } catch (e2) {
        console.error('window-all-closed flush error:', e2);
    }
});

// ====== Live2D SDK Setup ======

function showSdkSetup() {
    return new Promise((resolve) => {
        const setupWin = new SetupBrowserWindow({
            width: 560,
            height: 580,
            frame: false,
            resizable: false,
            webPreferences: {
                nodeIntegration: false,
                contextIsolation: true,
                preload: path.join(__dirname, 'preload.cjs'),
            },
        });

        const setupHtml = isDev
            ? path.join(__dirname, 'src', 'renderer', 'setup-sdk.html')
            : path.join(__dirname, 'dist', 'renderer', 'setup-sdk.html');
        setupWin.loadFile(setupHtml);

        let resolved = false;
        function done(result) {
            if (resolved) return;
            resolved = true;
            ipcMain.removeAllListeners('sdk-setup:open-download');
            ipcMain.removeAllListeners('sdk-setup:skip');
            ipcMain.removeAllListeners('sdk-setup:select-file');
            ipcMain.removeAllListeners('sdk-setup:copy-js');
            ipcMain.removeAllListeners('sdk-setup:extract');
            ipcMain.removeAllListeners('sdk-setup:drop-buffer');
            setupWin.close();
            resolve(result);
        }

        ipcMain.on('sdk-setup:open-download', () => {
            shell.openExternal('https://www.live2d.com/en/sdk/download/web/');
        });

        ipcMain.on('sdk-setup:skip', async (_event, dontShowAgain) => {
            if (dontShowAgain) {
                try {
                    const settingsPath = getFilePaths().SETTINGS_FILE;
                    let settings = {};
                    try { settings = JSON.parse(await fs.readFile(settingsPath, 'utf-8')); } catch {}
                    settings.skipSdkSetup = true;
                    await fs.writeFile(settingsPath, JSON.stringify(settings, null, 2), 'utf-8');
                } catch (e) { console.error('Failed to save skipSdkSetup:', e); }
            }
            done(false);
        });

        ipcMain.on('sdk-setup:select-file', async (event) => {
            const { dialog } = require('electron');
            const result = await dialog.showOpenDialog(setupWin, {
                title: 'Select Cubism SDK zip or live2dcubismcore.min.js',
                filters: [
                    { name: 'SDK files', extensions: ['zip', 'js'] },
                ],
                properties: ['openFile'],
            });
            if (!result.canceled && result.filePaths[0]) {
                event.sender.send('sdk-setup:file-selected', result.filePaths[0]);
            }
        });

        ipcMain.on('sdk-setup:drop-buffer', async (event, { name, buffer }) => {
            try {
                const targetDir = path.join(__dirname, 'public', 'lib');
                await fs.mkdir(targetDir, { recursive: true });
                const ext = name.split('.').pop().toLowerCase();
                if (ext === 'js') {
                    await fs.writeFile(path.join(targetDir, 'live2dcubismcore.min.js'), Buffer.from(buffer));
                    event.sender.send('sdk-setup:result', { success: true });
                    setTimeout(() => done(true), 1500);
                } else if (ext === 'zip') {
                    // Save temp zip then extract
                    const tmpZip = path.join(targetDir, '_tmp_sdk.zip');
                    await fs.writeFile(tmpZip, Buffer.from(buffer));
                    event.sender.send('sdk-setup:file-selected', tmpZip);
                    // Clean up temp after extraction handled by extract handler
                } else {
                    event.sender.send('sdk-setup:result', { success: false, error: 'Please drop a .zip or .js file' });
                }
            } catch (e) {
                console.error('SDK drop-buffer error:', e);
                event.sender.send('sdk-setup:result', { success: false, error: e.message });
            }
        });

        ipcMain.on('sdk-setup:copy-js', async (event, jsPath) => {
            try {
                const targetDir = path.join(__dirname, 'public', 'lib');
                await fs.mkdir(targetDir, { recursive: true });
                const targetFile = 'live2dcubismcore.min.js';
                await fs.copyFile(jsPath, path.join(targetDir, targetFile));
                event.sender.send('sdk-setup:result', { success: true });
                setTimeout(() => done(true), 1500);
            } catch (e) {
                console.error('SDK copy error:', e);
                event.sender.send('sdk-setup:result', { success: false, error: e.message });
            }
        });

        ipcMain.on('sdk-setup:extract', async (event, zipPath) => {
            try {
                const yauzl = require('yauzl');
                const targetDir = path.join(__dirname, 'public', 'lib');
                await fs.mkdir(targetDir, { recursive: true });

                const targetFile = 'live2dcubismcore.min.js';
                let found = false;

                await new Promise((resolveZip, rejectZip) => {
                    yauzl.open(zipPath, { lazyEntries: true }, (err, zipfile) => {
                        if (err) return rejectZip(err);
                        zipfile.readEntry();
                        zipfile.on('entry', (entry) => {
                            if (entry.fileName.endsWith(targetFile)) {
                                found = true;
                                zipfile.openReadStream(entry, (err2, readStream) => {
                                    if (err2) return rejectZip(err2);
                                    const outPath = path.join(targetDir, targetFile);
                                    const writeStream = fsSync.createWriteStream(outPath);
                                    readStream.pipe(writeStream);
                                    writeStream.on('close', () => {
                                        zipfile.close();
                                        resolveZip();
                                    });
                                });
                            } else {
                                zipfile.readEntry();
                            }
                        });
                        zipfile.on('end', () => {
                            if (!found) rejectZip(new Error('live2dcubismcore.min.js not found in zip'));
                        });
                    });
                });

                event.sender.send('sdk-setup:result', { success: true });
                setTimeout(() => done(true), 1500);
            } catch (e) {
                console.error('SDK extraction error:', e);
                event.sender.send('sdk-setup:result', { success: false, error: e.message });
            }
        });

        setupWin.on('closed', () => {
            done(false);
        });
    });
}
