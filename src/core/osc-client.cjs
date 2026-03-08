'use strict';

const { Client } = require('node-osc');

let oscClient = null;
let _lastExpressionParam = null;

function connect(host = '127.0.0.1', port = 9000) {
    disconnect();
    try {
        oscClient = new Client(host, port);
        console.log(`🎮 VRChat OSC接続: ${host}:${port}`);
    } catch (err) {
        console.error('❌ OSC接続失敗:', err.message);
        oscClient = null;
    }
}

function disconnect() {
    if (oscClient) {
        try { oscClient.close(); } catch (_) {}
        oscClient = null;
        _lastExpressionParam = null;
        console.log('🎮 VRChat OSC切断');
    }
}

function isConnected() {
    return oscClient !== null;
}

// メッセージ分割（句読点で切る）
function splitMessage(text, maxLen) {
    if (text.length <= maxLen) return [text];
    const chunks = [];
    let remaining = text;
    while (remaining.length > 0) {
        if (remaining.length <= maxLen) { chunks.push(remaining); break; }
        let cutAt = maxLen;
        const breakPoints = ['。', '！', '？', '、', '…', '. ', '! ', '? '];
        for (const bp of breakPoints) {
            const idx = remaining.lastIndexOf(bp, maxLen);
            if (idx > maxLen * 0.5) { cutAt = idx + bp.length; break; }
        }
        chunks.push(remaining.substring(0, cutAt));
        remaining = remaining.substring(cutAt);
    }
    return chunks;
}

// 144文字超えたら分割送信
function sendChatbox(message, immediate = true, playSound = false) {
    if (!oscClient) return false;
    try {
        const chunks = splitMessage(message, 144);
        for (let i = 0; i < chunks.length; i++) {
            if (i === 0) {
                oscClient.send('/chatbox/input', chunks[i], immediate, playSound);
            } else {
                setTimeout(() => {
                    if (oscClient) oscClient.send('/chatbox/input', chunks[i], true, false);
                }, i * 3000);
            }
        }
        return true;
    } catch (err) {
        console.error('❌ OSC chatbox送信失敗:', err.message);
        return false;
    }
}

// 表情パラメータ送信（前回のリセット付き）
function sendExpressionParameter(paramName, paramType = 'bool') {
    if (!oscClient) return false;
    try {
        // 前回立てたパラメータをリセット
        if (_lastExpressionParam && _lastExpressionParam !== paramName) {
            const resetValue = paramType === 'bool' ? false : (paramType === 'int' ? 0 : 0.0);
            oscClient.send(`/avatar/parameters/${_lastExpressionParam}`, resetValue);
        }
        // 新しいパラメータを立てる
        if (paramName) {
            const setValue = paramType === 'bool' ? true : (paramType === 'int' ? 1 : 1.0);
            oscClient.send(`/avatar/parameters/${paramName}`, setValue);
            _lastExpressionParam = paramName;
        } else {
            _lastExpressionParam = null;
        }
        return true;
    } catch (err) {
        console.error('❌ OSC expression送信失敗:', err.message);
        return false;
    }
}

// 汎用パラメータ送信
function sendParameter(name, value) {
    if (!oscClient) return false;
    try {
        oscClient.send(`/avatar/parameters/${name}`, value);
        return true;
    } catch (err) {
        console.error('❌ OSC parameter送信失敗:', err.message);
        return false;
    }
}

// 設定変更時の再接続ハンドリング
function handleSettingsChange(newSettings, oldSettings) {
    const wasEnabled = oldSettings?.vrchat?.enabled;
    const isEnabled = newSettings?.vrchat?.enabled;

    if (isEnabled && !wasEnabled) {
        connect(newSettings.vrchat.host, newSettings.vrchat.sendPort);
    } else if (!isEnabled && wasEnabled) {
        disconnect();
    } else if (isEnabled && wasEnabled) {
        if (newSettings.vrchat.host !== oldSettings?.vrchat?.host ||
            newSettings.vrchat.sendPort !== oldSettings?.vrchat?.sendPort) {
            connect(newSettings.vrchat.host, newSettings.vrchat.sendPort);
        }
    }
}

module.exports = {
    connect, disconnect, isConnected,
    sendChatbox, sendParameter, sendExpressionParameter,
    handleSettingsChange
};
