'use strict';

// ====== Comment Source Manager ======
// YouTube Live Chat API ポーリング + OneComme WebSocket 統合

class CommentSourceManager {
    constructor() {
        this._onComment = null;   // callback(comment)
        this._onError = null;     // callback(error)
        this._youtubeTimer = null;
        this._youtubeNextPageToken = null;
        this._youtubeLiveChatId = null;
        this._onecommeWs = null;
        this._running = false;
        this._processedIds = new Set(); // dedup
    }

    setCallbacks({ onComment, onError }) {
        this._onComment = onComment;
        this._onError = onError;
    }

    async start(settings, apiKey) {
        this.stop();
        this._running = true;
        const source = settings.commentSource;

        if (source === 'youtube' && settings.youtube.videoId && apiKey) {
            await this._startYoutube(settings.youtube, apiKey, settings.commentFilter);
        } else if (source === 'onecomme') {
            this._startOnecomme(settings.onecomme.port, settings.commentFilter);
        }
    }

    stop() {
        this._running = false;
        if (this._youtubeTimer) {
            clearTimeout(this._youtubeTimer);
            this._youtubeTimer = null;
        }
        if (this._onecommeWs) {
            try { this._onecommeWs.close(); } catch (e) {}
            this._onecommeWs = null;
        }
        this._youtubeNextPageToken = null;
        this._youtubeLiveChatId = null;
        this._processedIds.clear();
    }

    // ====== YouTube Live Chat ======

    async _startYoutube(ytSettings, apiKey, filter) {
        try {
            // Step 1: Get liveChatId from video ID
            const videoUrl = `https://www.googleapis.com/youtube/v3/videos?part=liveStreamingDetails&id=${ytSettings.videoId}&key=${apiKey}`;
            const videoRes = await fetch(videoUrl);
            const videoData = await videoRes.json();

            if (videoData.error) {
                this._onError?.(`YouTube API Error: ${videoData.error.message}`);
                return;
            }

            if (!videoData.items || videoData.items.length === 0) {
                this._onError?.('動画が見つかりません');
                return;
            }

            this._youtubeLiveChatId = videoData.items[0]?.liveStreamingDetails?.activeLiveChatId;
            if (!this._youtubeLiveChatId) {
                this._onError?.('ライブチャットが有効ではありません');
                return;
            }

            console.log(`✅ YouTube Live Chat接続: chatId=${this._youtubeLiveChatId}`);

            // Step 2: Start polling
            this._pollYoutube(apiKey, ytSettings.pollingIntervalMs || 5000, filter);
        } catch (err) {
            this._onError?.(`YouTube接続エラー: ${err.message}`);
        }
    }

    async _pollYoutube(apiKey, intervalMs, filter) {
        if (!this._running || !this._youtubeLiveChatId) return;

        try {
            let url = `https://www.googleapis.com/youtube/v3/liveChat/messages?liveChatId=${this._youtubeLiveChatId}&part=snippet,authorDetails&key=${apiKey}`;
            if (this._youtubeNextPageToken) {
                url += `&pageToken=${this._youtubeNextPageToken}`;
            }

            const res = await fetch(url);
            const data = await res.json();

            if (data.error) {
                console.warn('YouTube API Error:', data.error.message);
                // quota 超過等の場合はリトライ間隔を延長
                this._youtubeTimer = setTimeout(
                    () => this._pollYoutube(apiKey, intervalMs, filter),
                    intervalMs * 3
                );
                return;
            }

            this._youtubeNextPageToken = data.nextPageToken;
            const apiInterval = data.pollingIntervalMillis || intervalMs;

            // Process messages
            for (const item of (data.items || [])) {
                const msgId = item.id;
                if (this._processedIds.has(msgId)) continue;
                this._processedIds.add(msgId);

                const text = item.snippet?.textMessageDetails?.messageText || item.snippet?.displayMessage || '';
                const author = item.authorDetails?.displayName || 'Viewer';

                // # フィルター
                if (filter?.ignoreHashPrefix && text.startsWith('#')) continue;
                // 空コメントスキップ
                if (!text.trim()) continue;

                this._onComment?.({
                    id: msgId,
                    author,
                    text,
                    platform: 'youtube'
                });
            }

            // processedIds の上限管理
            if (this._processedIds.size > 500) {
                const arr = [...this._processedIds];
                this._processedIds = new Set(arr.slice(-200));
            }

            // 次のポーリング（API推奨間隔を尊重）
            this._youtubeTimer = setTimeout(
                () => this._pollYoutube(apiKey, intervalMs, filter),
                Math.max(apiInterval, intervalMs)
            );
        } catch (err) {
            console.warn('YouTube polling error:', err.message);
            // エラー時はリトライ間隔を延長
            this._youtubeTimer = setTimeout(
                () => this._pollYoutube(apiKey, intervalMs, filter),
                intervalMs * 2
            );
        }
    }

    // ====== OneComme WebSocket ======

    _startOnecomme(port, filter) {
        const WebSocket = require('ws');
        const url = `ws://127.0.0.1:${port}/sub?p=comments`;

        try {
            this._onecommeWs = new WebSocket(url);

            this._onecommeWs.on('open', () => {
                console.log(`✅ OneComme WebSocket接続: ${url}`);
            });

            this._onecommeWs.on('message', (rawData) => {
                try {
                    const parsed = JSON.parse(rawData.toString());

                    // OneComme sends: { type: "comments", data: [...] } or direct array
                    let comments = [];
                    if (parsed.type === 'comments' && Array.isArray(parsed.data)) {
                        comments = parsed.data;
                    } else if (parsed.type === 'connected' && Array.isArray(parsed.data?.comments)) {
                        comments = parsed.data.comments;
                    } else if (Array.isArray(parsed)) {
                        comments = parsed;
                    }

                    for (const c of comments) {
                        const commentData = c.data || c;
                        const text = commentData.comment || '';
                        const author = commentData.name || commentData.displayName || 'Viewer';
                        const msgId = commentData.id || `oc_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
                        const platform = c.service || 'onecomme';

                        if (this._processedIds.has(msgId)) continue;
                        this._processedIds.add(msgId);

                        // # フィルター
                        if (filter?.ignoreHashPrefix && text.startsWith('#')) continue;
                        // 空コメントスキップ
                        if (!text.trim()) continue;
                        // HTML タグを除去（OneCommeはimg等を含む場合がある）
                        const cleanText = text.replace(/<[^>]*>/g, '').trim();
                        if (!cleanText) continue;

                        this._onComment?.({
                            id: msgId,
                            author,
                            text: cleanText,
                            platform
                        });
                    }
                } catch (parseErr) {
                    // 非コメントメッセージは無視
                }
            });

            this._onecommeWs.on('error', (err) => {
                console.error('OneComme WebSocket error:', err.message);
                this._onError?.(`OneComme接続エラー: ${err.message}`);
            });

            this._onecommeWs.on('close', () => {
                console.log('OneComme WebSocket closed');
                // 自動再接続（5秒後、running中のみ）
                if (this._running) {
                    setTimeout(() => {
                        if (this._running) this._startOnecomme(port, filter);
                    }, 5000);
                }
            });
        } catch (err) {
            this._onError?.(`OneComme接続失敗: ${err.message}`);
        }
    }

    // ====== テスト接続 ======

    static async testYoutube(videoId, apiKey) {
        try {
            const url = `https://www.googleapis.com/youtube/v3/videos?part=liveStreamingDetails&id=${videoId}&key=${apiKey}`;
            const res = await fetch(url);
            const data = await res.json();

            if (data.error) return { success: false, error: data.error.message };
            if (!data.items || data.items.length === 0) return { success: false, error: '動画が見つかりません' };
            if (!data.items[0]?.liveStreamingDetails?.activeLiveChatId) {
                return { success: false, error: 'ライブチャットが有効ではありません（配信中ではない可能性）' };
            }
            return { success: true };
        } catch (err) {
            return { success: false, error: err.message };
        }
    }

    static testOnecomme(port) {
        return new Promise((resolve) => {
            const WebSocket = require('ws');
            const ws = new WebSocket(`ws://127.0.0.1:${port}/sub?p=comments`);
            const timeout = setTimeout(() => {
                try { ws.close(); } catch (e) {}
                resolve({ success: false, error: '接続タイムアウト' });
            }, 5000);

            ws.on('open', () => {
                clearTimeout(timeout);
                try { ws.close(); } catch (e) {}
                resolve({ success: true });
            });
            ws.on('error', (err) => {
                clearTimeout(timeout);
                resolve({ success: false, error: err.message });
            });
        });
    }
}

module.exports = { CommentSourceManager };
