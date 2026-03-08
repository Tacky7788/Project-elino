'use strict';

const WebSocket = require('ws');

// ====== OpenClaw WebSocket state ======
let _openclawWs = null;
let _openclawConnected = false;
let _openclawReqId = 0;
let _openclawPendingCallbacks = new Map();
let _openclawChatListeners = new Map();
const OPENCLAW_SESSION_KEY = 'agent:main:main';

let _ctx = null;

function resetOpenClawSession() {
    if (_openclawWs) {
        _openclawWs.close();
        _openclawWs = null;
    }
    _openclawConnected = false;
    _openclawPendingCallbacks.clear();
    _openclawChatListeners.clear();
    console.log('🔧 OpenClaw WebSocket session reset');
}

function _openclawNextId() {
    return `dc-${++_openclawReqId}`;
}

function _openclawSendRpc(method, params) {
    return new Promise((resolve, reject) => {
        if (!_openclawWs || _openclawWs.readyState !== WebSocket.OPEN) {
            return reject(new Error('WebSocket not connected'));
        }
        const id = _openclawNextId();
        _openclawPendingCallbacks.set(id, { resolve, reject });
        _openclawWs.send(JSON.stringify({ type: 'req', id, method, params }));
        setTimeout(() => {
            if (_openclawPendingCallbacks.has(id)) {
                _openclawPendingCallbacks.delete(id);
                reject(new Error('RPC timeout'));
            }
        }, 120000);
    });
}

async function _openclawConnect(openclawSettings) {
    if (_openclawWs && _openclawWs.readyState === WebSocket.OPEN && _openclawConnected) {
        return;
    }
    if (_openclawWs) {
        _openclawWs.close();
        _openclawWs = null;
        _openclawConnected = false;
    }

    const httpUrl = openclawSettings.gatewayUrl || 'http://127.0.0.1:18789';
    const wsUrl = httpUrl.replace(/^http/, 'ws');
    const originUrl = httpUrl.replace(/\/$/, '');
    console.log(`🔧 OpenClaw WebSocket connecting to ${wsUrl}`);

    return new Promise((resolve, reject) => {
        const ws = new WebSocket(wsUrl, { headers: { Origin: originUrl } });
        let connectResolved = false;

        ws.on('open', () => {
            console.log('🔧 OpenClaw WebSocket connected, waiting for challenge...');
        });

        ws.on('message', (data) => {
            let msg;
            try { msg = JSON.parse(data.toString()); } catch { return; }

            // チャレンジ
            if (msg.type === 'event' && msg.event === 'connect.challenge') {
                const connectReq = {
                    type: 'req',
                    id: _openclawNextId(),
                    method: 'connect',
                    params: {
                        minProtocol: 3,
                        maxProtocol: 3,
                        client: {
                            id: 'webchat',
                            displayName: 'Desktop Companion',
                            version: '1.0.0',
                            platform: 'electron',
                            deviceFamily: 'desktop',
                            modelIdentifier: 'electron',
                            mode: 'webchat',
                        },
                        caps: ['tool-events'],
                        auth: {
                            token: openclawSettings.token || ''
                        }
                    }
                };
                _openclawPendingCallbacks.set(connectReq.id, {
                    resolve: (payload) => {
                        console.log('🔧 OpenClaw WebSocket authenticated');
                        _openclawConnected = true;
                        connectResolved = true;
                        resolve();
                    },
                    reject: (err) => {
                        connectResolved = true;
                        reject(err);
                    }
                });
                ws.send(JSON.stringify(connectReq));
                return;
            }

            // RPC応答
            if (msg.type === 'res' && msg.id) {
                const cb = _openclawPendingCallbacks.get(msg.id);
                if (cb) {
                    _openclawPendingCallbacks.delete(msg.id);
                    if (msg.ok) {
                        cb.resolve(msg.payload);
                    } else {
                        cb.reject(new Error(msg.error?.message || 'RPC error'));
                    }
                }
                return;
            }

            // チャットイベント
            if (msg.type === 'event' && msg.event === 'chat' && msg.payload) {
                const { runId } = msg.payload;
                const listener = _openclawChatListeners.get(runId);
                if (listener) {
                    listener(msg.payload);
                }
                return;
            }
        });

        ws.on('error', (err) => {
            console.error('🔧 OpenClaw WebSocket error:', err.message);
            if (!connectResolved) {
                connectResolved = true;
                reject(err);
            }
        });

        ws.on('close', (code, reason) => {
            console.log(`🔧 OpenClaw WebSocket closed: ${code} ${reason?.toString()}`);
            _openclawConnected = false;
            _openclawWs = null;
            for (const [id, cb] of _openclawPendingCallbacks) {
                cb.reject(new Error('WebSocket closed'));
            }
            _openclawPendingCallbacks.clear();
            _openclawChatListeners.clear();
            if (!connectResolved) {
                connectResolved = true;
                reject(new Error('WebSocket closed before connect'));
            }
        });

        _openclawWs = ws;

        setTimeout(() => {
            if (!connectResolved) {
                connectResolved = true;
                ws.close();
                reject(new Error('Connection timeout'));
            }
        }, 10000);
    });
}

// OpenClaw streaming
async function streamOpenClaw(event, openclawSettings, recentMessages) {
    const { forwardSubtitle, clearSubtitleAfterDelay, loadSettings } = _ctx;

    const lastUserMsg = [...recentMessages].reverse().find(m => m.role === 'user');
    let userText = '';
    if (lastUserMsg) {
        if (Array.isArray(lastUserMsg.content)) {
            userText = lastUserMsg.content
                .filter(item => item.type === 'text')
                .map(item => item.text)
                .join('\n') || '';
        } else {
            userText = lastUserMsg.content;
        }
    }
    if (!userText) {
        event.sender.send('llm:error', 'メッセージが空です');
        return;
    }

    console.log(`🔧 OpenClaw chat.send: "${userText.substring(0, 50)}..."`);

    try {
        await _openclawConnect(openclawSettings);
    } catch (err) {
        if (err.message.includes('ECONNREFUSED')) {
            event.sender.send('llm:error', `OpenClawに接続できません。サーバーが起動しているか確認してください`);
        } else {
            event.sender.send('llm:error', `OpenClaw接続エラー: ${err.message}`);
        }
        return;
    }

    const settings = await loadSettings();
    const runId = `dc-chat-${Date.now()}`;
    try {
        let fullText = '';
        const chatDone = new Promise((resolve, reject) => {
            const timeout = setTimeout(() => {
                _openclawChatListeners.delete(runId);
                reject(new Error('Chat response timeout'));
            }, 120000);

            _openclawChatListeners.set(runId, (payload) => {
                if (payload.state === 'delta') {
                    const text = payload.message?.content?.[0]?.text || '';
                    if (text && text.length > fullText.length) {
                        const delta = text.substring(fullText.length);
                        fullText = text;
                        event.sender.send('llm:delta', delta);
                        if (settings.streaming?.enabled && settings.streaming?.subtitle?.enabled) {
                            forwardSubtitle(delta);
                        }
                    }
                } else if (payload.state === 'final') {
                    clearTimeout(timeout);
                    _openclawChatListeners.delete(runId);
                    const finalText = payload.message?.content?.[0]?.text || '';
                    if (finalText.length > fullText.length) {
                        event.sender.send('llm:delta', finalText.substring(fullText.length));
                    }
                    resolve();
                } else if (payload.state === 'error') {
                    clearTimeout(timeout);
                    _openclawChatListeners.delete(runId);
                    reject(new Error(payload.errorMessage || 'Chat error'));
                } else if (payload.state === 'aborted') {
                    clearTimeout(timeout);
                    _openclawChatListeners.delete(runId);
                    resolve();
                }
            });
        });

        await _openclawSendRpc('chat.send', {
            sessionKey: OPENCLAW_SESSION_KEY,
            message: userText,
            idempotencyKey: runId,
        });

        await chatDone;
    } catch (err) {
        console.error('🔧 OpenClaw chat.send error:', err.message);
        event.sender.send('llm:error', `OpenClawエラー: ${err.message}`);
        _openclawChatListeners.delete(runId);
        return;
    }

    event.sender.send('llm:done');
    if (settings.streaming?.enabled && settings.streaming?.subtitle?.enabled) {
        clearSubtitleAfterDelay(settings.streaming.subtitle.fadeAfterMs || 3000);
    }
}

function register(ipcMain, ctx) {
    _ctx = ctx;

    ipcMain.on('openclaw:reset-session', () => {
        resetOpenClawSession();
    });

    ipcMain.handle('openclaw:test', async (event, params) => {
        const { gatewayUrl, token, agentId } = params;
        try {
            await _openclawConnect({ gatewayUrl, token, agentId });
            return { success: true };
        } catch (err) {
            if (err.message.includes('ECONNREFUSED')) {
                return { success: false, error: `接続拒否: サーバーが起動していません (${gatewayUrl})` };
            }
            if (err.message.includes('timeout') || err.message.includes('Timeout')) {
                return { success: false, error: 'タイムアウト: サーバーが応答しません' };
            }
            return { success: false, error: err.message };
        }
    });
}

module.exports = { register, streamOpenClaw, resetOpenClawSession };
