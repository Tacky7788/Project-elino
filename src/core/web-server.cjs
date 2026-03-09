// Web Server: ipcMainのハンドラをHTTPエンドポイントとしても公開する
// Electronのmainプロセス内で動く。ブラウザからlocalhost経由でアクセス可能

const http = require('http');
const { WebSocketServer } = require('ws');
const path = require('path');
const fs = require('fs');

// ipcMain.handleで登録されたハンドラを収集するProxy
const handlerMap = new Map(); // channel -> handler(event, ...args)
const sendListeners = new Map(); // channel -> handler(event, ...args)

/**
 * ipcMainをラップして、handle/onの登録を傍受する
 * 既存のipc-*.cjsは変更不要
 */
function wrapIpcMain(originalIpcMain) {
  const origHandle = originalIpcMain.handle.bind(originalIpcMain);
  const origOn = originalIpcMain.on.bind(originalIpcMain);

  originalIpcMain.handle = (channel, handler) => {
    handlerMap.set(channel, handler);
    return origHandle(channel, handler);
  };

  originalIpcMain.on = (channel, handler) => {
    sendListeners.set(channel, handler);
    return origOn(channel, handler);
  };

  return originalIpcMain;
}

// IPC channel名 → HTTPルートに変換
// 'get-memory' → '/api/get-memory'
// 'memory:applyConversation' → '/api/memory/applyConversation'
function channelToRoute(channel) {
  return '/api/' + channel.replace(/:/g, '/');
}

/**
 * WebサーバーとWebSocketサーバーを起動
 */
function startWebServer(port, options = {}) {
  const { getWindows, staticDir } = options;

  // WebSocketクライアント管理
  const wsClients = new Set();

  const server = http.createServer(async (req, res) => {
    // CORS
    res.setHeader('Access-Control-Allow-Origin', 'http://127.0.0.1');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    if (req.method === 'OPTIONS') {
      res.writeHead(204);
      res.end();
      return;
    }

    const url = new URL(req.url, `http://localhost:${port}`);

    // API エンドポイント
    if (url.pathname.startsWith('/api/')) {
      await handleApiRequest(req, res, url);
      return;
    }

    // 静的ファイル配信（Web版UI）
    if (staticDir) {
      serveStatic(req, res, url, staticDir);
      return;
    }

    res.writeHead(404);
    res.end('Not Found');
  });

  // WebSocket サーバー
  const wss = new WebSocketServer({ server });
  wss.on('connection', (ws) => {
    wsClients.add(ws);
    ws.on('close', () => wsClients.delete(ws));

    // fakeEvent: event.sender.sendをWebSocketブロードキャストに変換
    function createFakeEvent() {
      return {
        sender: {
          send: (channel, ...args) => {
            broadcast(channel, args.length === 1 ? args[0] : args);
          }
        }
      };
    }

    ws.on('message', async (raw) => {
      try {
        const { event, data } = JSON.parse(raw);
        // ホワイトリストチェック
        if (!ALLOWED_API_CHANNELS.has(event)) return;
        // send系のIPC（fire-and-forget）
        const handler = sendListeners.get(event);
        if (handler) {
          handler(createFakeEvent(), data);
        }
        // handle系のIPC（リクエスト→レスポンス）をWS経由で呼ぶ場合
        const invokeHandler = handlerMap.get(event);
        if (invokeHandler) {
          try {
            const result = await invokeHandler(createFakeEvent(), data);
            ws.send(JSON.stringify({ event: `${event}:result`, data: result }));
          } catch (err) {
            ws.send(JSON.stringify({ event: `${event}:error`, data: err.message }));
          }
        }
      } catch { /* ignore */ }
    });
  });

  // ブロードキャスト関数: mainプロセスからWebクライアントにイベントを送る
  function broadcast(event, data) {
    const msg = JSON.stringify({ event, data });
    for (const ws of wsClients) {
      if (ws.readyState === 1) ws.send(msg);
    }
  }

  server.listen(port, '127.0.0.1', () => {
    console.log(`[Web Server] listening on http://127.0.0.1:${port}`);
  });

  server.on('error', (err) => {
    console.error('[Web Server] error:', err.message);
  });

  return { server, wss, broadcast, wsClients };
}

// Web API で公開を許可するIPCチャンネルのホワイトリスト
// 内部操作（get-memory, save-settings等）は公開しない
const ALLOWED_API_CHANNELS = new Set([
  // 会話系
  'llm:stream',
  'get-profile',
  'get-personality',
  'get-state',
  'get-emotion-state',
  // 設定読み取り（書き込みは不可）
  'get-settings',
  'get-config',
  // チャット制御
  'toggle-chat',
  'open-chat',
  'close-chat',
  // TTS
  'tts:openai-synthesize',
  'voicevox:synthesize',
  // バージョン
  'get-app-version',
]);

// API リクエスト処理
async function handleApiRequest(req, res, url) {
  // /api/channel/name → channel:name
  const routePath = url.pathname.slice(5); // '/api/' を除去
  const channel = routePath.replace(/\//g, ':').replace(/:$/, '');

  // ホワイトリストチェック
  if (!ALLOWED_API_CHANNELS.has(channel)) {
    res.writeHead(403, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: `Access denied: ${channel}` }));
    return;
  }

  // GETリクエストのクエリパラメータ
  const queryParams = Object.fromEntries(url.searchParams);

  const handler = handlerMap.get(channel);
  // channel名のバリエーション: 'get-memory' or 'get:memory'
  const altChannel = channel.replace(/:/g, '-');
  const altHandler = !handler ? handlerMap.get(altChannel) : null;
  const finalHandler = handler || altHandler;

  if (!finalHandler) {
    res.writeHead(404, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: `Unknown endpoint: ${channel}` }));
    return;
  }

  try {
    let args;
    if (req.method === 'POST') {
      const body = await readBody(req);
      args = body;
    } else {
      // GETの場合はクエリパラメータを引数に
      args = Object.keys(queryParams).length > 0 ? queryParams : undefined;
    }

    const fakeEvent = { sender: { send: () => {} } };
    const result = await finalHandler(fakeEvent, args);

    // ArrayBuffer / Buffer の場合はバイナリで返す
    if (result instanceof ArrayBuffer || Buffer.isBuffer(result)) {
      res.writeHead(200, { 'Content-Type': 'application/octet-stream' });
      res.end(Buffer.from(result));
      return;
    }

    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(result ?? { ok: true }));
  } catch (err) {
    console.error(`[Web Server] Error handling ${channel}:`, err.message);
    res.writeHead(500, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: err.message }));
  }
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let data = '';
    req.on('data', chunk => data += chunk);
    req.on('end', () => {
      try {
        resolve(data ? JSON.parse(data) : undefined);
      } catch {
        reject(new Error('Invalid JSON'));
      }
    });
    req.on('error', reject);
  });
}

// 静的ファイル配信
const MIME_TYPES = {
  '.html': 'text/html',
  '.js': 'application/javascript',
  '.css': 'text/css',
  '.json': 'application/json',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.woff2': 'font/woff2',
  '.woff': 'font/woff',
  '.ttf': 'font/ttf',
  '.ico': 'image/x-icon',
  '.wasm': 'application/wasm',
};

function serveStatic(req, res, url, staticDir) {
  let filePath = path.join(staticDir, url.pathname === '/' ? 'index.html' : url.pathname);

  // セキュリティ: staticDir外へのアクセスを防ぐ
  if (!filePath.startsWith(staticDir)) {
    res.writeHead(403);
    res.end('Forbidden');
    return;
  }

  const ext = path.extname(filePath).toLowerCase();

  fs.readFile(filePath, (err, data) => {
    if (err) {
      // SPA フォールバック: ファイルが見つからない場合はindex.htmlを返す
      if (err.code === 'ENOENT' && !ext) {
        fs.readFile(path.join(staticDir, 'index.html'), (err2, indexData) => {
          if (err2) {
            res.writeHead(404);
            res.end('Not Found');
            return;
          }
          res.writeHead(200, { 'Content-Type': 'text/html' });
          res.end(indexData);
        });
        return;
      }
      res.writeHead(404);
      res.end('Not Found');
      return;
    }

    res.writeHead(200, { 'Content-Type': MIME_TYPES[ext] || 'application/octet-stream' });
    res.end(data);
  });
}

module.exports = { wrapIpcMain, startWebServer };
