'use strict';

/**
 * VRChat音声リスナー
 * application-loopbackでVRChatプロセスの音声をキャプチャし、
 * VADで音声区間を検出、Whisper APIで文字起こしする。
 *
 * 設計: ELINO本体から独立。start/stopとイベントコールバックのみ。
 */

let capture = null;
try {
    capture = require('application-loopback');
} catch (e) {
    console.warn('[VRChatListener] application-loopback not available:', e.message);
}

// --- 定数（デフォルト値、settingsで上書き可能） ---
const CAPTURE_SAMPLE_RATE = 48000;  // WASAPIデフォルト
const TARGET_SAMPLE_RATE = 16000;   // Whisper最適
const CAPTURE_CHANNELS = 2;         // ステレオ想定
const BYTES_PER_SAMPLE = 2;         // Int16LE
const DEFAULT_VAD_THRESHOLD = 300;
const DEFAULT_SILENCE_DURATION = 1500;
const MIN_SEGMENT_MS = 800;
const MAX_SEGMENT_MS = 15000;
const DEFAULT_GAIN = 10;

// --- 状態 ---
let isActive = false;
let currentPid = null;
let audioBuffer = [];            // PCMチャンク蓄積
let segmentStartTime = null;
let lastVoiceTime = null;
let vadInterval = null;
let onTranscript = null;         // コールバック: (text) => void
let onStateChange = null;        // コールバック: (state) => void
let settingsGetter = null;       // () => settings
let configGetter = null;         // () => config（APIキー用）

/**
 * VRChatプロセスを探す
 */
async function findVRChatPid() {
    if (!capture) return null;
    try {
        const windows = await capture.getActiveWindowProcessIds();
        const vrc = windows.find(w =>
            w.title?.toLowerCase().includes('vrchat')
        );
        return vrc ? String(vrc.processId) : null;
    } catch (e) {
        console.error('[VRChatListener] PID取得失敗:', e.message);
        return null;
    }
}

/**
 * PCMバッファにゲインを適用（Int16LE）
 */
function applyGain(buf, gain) {
    const out = Buffer.alloc(buf.length);
    const samples = Math.floor(buf.length / 2);
    for (let i = 0; i < samples; i++) {
        let sample = buf.readInt16LE(i * 2);
        sample = Math.max(-32768, Math.min(32767, Math.round(sample * gain)));
        out.writeInt16LE(sample, i * 2);
    }
    return out;
}

/**
 * ステレオInt16LE → モノラルInt16LE（左右平均）
 */
function stereoToMono(buf) {
    const samplePairs = Math.floor(buf.length / 4); // 2ch * 2bytes
    const mono = Buffer.alloc(samplePairs * 2);
    for (let i = 0; i < samplePairs; i++) {
        const left = buf.readInt16LE(i * 4);
        const right = buf.readInt16LE(i * 4 + 2);
        const avg = Math.round((left + right) / 2);
        mono.writeInt16LE(avg, i * 2);
    }
    return mono;
}

/**
 * ダウンサンプリング（線形補間）
 */
function downsample(buf, fromRate, toRate) {
    if (fromRate === toRate) return buf;
    const ratio = fromRate / toRate;
    const srcSamples = Math.floor(buf.length / 2);
    const dstSamples = Math.floor(srcSamples / ratio);
    const out = Buffer.alloc(dstSamples * 2);
    for (let i = 0; i < dstSamples; i++) {
        const srcIdx = i * ratio;
        const idx0 = Math.floor(srcIdx);
        const idx1 = Math.min(idx0 + 1, srcSamples - 1);
        const frac = srcIdx - idx0;
        const s0 = buf.readInt16LE(idx0 * 2);
        const s1 = buf.readInt16LE(idx1 * 2);
        const sample = Math.round(s0 + (s1 - s0) * frac);
        out.writeInt16LE(sample, i * 2);
    }
    return out;
}

/**
 * Int16LE PCMをWAVに変換
 */
function pcmToWav(pcmBuffer, sampleRate, channels) {
    const dataLen = pcmBuffer.length;
    const header = Buffer.alloc(44);

    // RIFF header
    header.write('RIFF', 0);
    header.writeUInt32LE(36 + dataLen, 4);
    header.write('WAVE', 8);

    // fmt chunk
    header.write('fmt ', 12);
    header.writeUInt32LE(16, 16);        // chunk size
    header.writeUInt16LE(1, 20);         // PCM format
    header.writeUInt16LE(channels, 22);
    header.writeUInt32LE(sampleRate, 24);
    header.writeUInt32LE(sampleRate * channels * BYTES_PER_SAMPLE, 28);
    header.writeUInt16LE(channels * BYTES_PER_SAMPLE, 32);
    header.writeUInt16LE(16, 34);        // bits per sample

    // data chunk
    header.write('data', 36);
    header.writeUInt32LE(dataLen, 40);

    return Buffer.concat([header, pcmBuffer]);
}

/**
 * Whisper APIで文字起こし
 */
async function transcribe(wavBuffer) {
    const config = configGetter ? configGetter() : {};
    const settings = settingsGetter ? settingsGetter() : {};
    const apiKey = config?.openaiApiKey || process.env.OPENAI_API_KEY;
    if (!apiKey) {
        console.warn('[VRChatListener] OpenAI APIキー未設定');
        return null;
    }

    try {
        const file = new File([wavBuffer], 'vrchat-audio.wav', { type: 'audio/wav' });
        const formData = new FormData();
        formData.append('file', file);
        formData.append('model', settings?.stt?.whisperModel || 'whisper-1');
        // languageを指定しない → Whisperが自動検出する（多言語VRChat対応）

        const response = await fetch('https://api.openai.com/v1/audio/transcriptions', {
            method: 'POST',
            headers: { 'Authorization': `Bearer ${apiKey}` },
            body: formData
        });

        if (!response.ok) {
            const err = await response.text();
            console.error('[VRChatListener] Whisper APIエラー:', response.status, err);
            return null;
        }

        const result = await response.json();
        return result.text || null;
    } catch (e) {
        console.error('[VRChatListener] 文字起こしエラー:', e.message);
        return null;
    }
}

/**
 * ハルシネーション判定
 */
const HALLUCINATION_PATTERNS = [
    'ご視聴ありがとうございました',
    'チャンネル登録',
    'お疲れ様でした',
    'ありがとうございました',
    'Thank you for watching',
    'Thanks for watching',
    'Subscribe',
    'MoizMedia',
];

function isHallucination(text) {
    if (!text || text.length <= 1) return true;
    const t = text.trim();
    return HALLUCINATION_PATTERNS.some(p => t.includes(p));
}

/**
 * 蓄積したPCMを処理→文字起こし
 */
async function processSegment() {
    if (audioBuffer.length === 0) return;

    const pcm = Buffer.concat(audioBuffer);
    audioBuffer = [];
    segmentStartTime = null;

    // ステレオ → モノラル
    const mono = stereoToMono(pcm);

    // ゲイン適用（設定値 or デフォルト）
    const settings = settingsGetter ? settingsGetter() : {};
    const gain = settings?.vrchat?.audioListener?.gain ?? DEFAULT_GAIN;
    const amplified = applyGain(mono, gain);

    // 48kHz → 16kHz ダウンサンプリング
    const resampled = downsample(amplified, CAPTURE_SAMPLE_RATE, TARGET_SAMPLE_RATE);

    // WAV変換（16kHz, 1ch）
    const wav = pcmToWav(resampled, TARGET_SAMPLE_RATE, 1);

    console.log(`[VRChatListener] セグメント送信: ${(resampled.length / 1024).toFixed(0)}KB (${(pcm.length / 1024).toFixed(0)}KB raw)`);

    // Whisper
    const text = await transcribe(wav);
    if (text && !isHallucination(text)) {
        console.log(`[VRChatListener] 認識結果: "${text}"`);
        if (onTranscript) onTranscript(text);
    }
}

/**
 * キャプチャ開始
 */
async function start(options = {}) {
    if (isActive) return { success: false, error: 'Already active' };
    if (!capture) return { success: false, error: 'application-loopback not available' };

    onTranscript = options.onTranscript || null;
    onStateChange = options.onStateChange || null;
    settingsGetter = options.getSettings || null;
    configGetter = options.getConfig || null;

    // VRChatを探す
    const pid = await findVRChatPid();
    if (!pid) return { success: false, error: 'VRChat not found' };

    currentPid = pid;
    isActive = true;
    audioBuffer = [];
    segmentStartTime = null;
    lastVoiceTime = null;

    console.log(`[VRChatListener] 開始: PID=${pid}`);
    if (onStateChange) onStateChange('listening');

    try {
        capture.startAudioCapture(pid, {
            onData: (chunk) => {
                if (!isActive) return;

                const buf = Buffer.from(chunk.buffer, chunk.byteOffset, chunk.byteLength);

                // ピーク検出（Int16LE）
                const samples = Math.floor(buf.length / 2);
                let peak = 0;
                for (let i = 0; i < samples; i++) {
                    const s = Math.abs(buf.readInt16LE(i * 2));
                    if (s > peak) peak = s;
                }

                const now = Date.now();
                const curSettings = settingsGetter ? settingsGetter() : {};
                const al = curSettings?.vrchat?.audioListener ?? {};
                const vadThreshold = al.vadThreshold ?? DEFAULT_VAD_THRESHOLD;
                const silenceDuration = al.silenceDuration ?? DEFAULT_SILENCE_DURATION;
                const hasVoice = peak > vadThreshold;

                if (hasVoice) {
                    if (!segmentStartTime) segmentStartTime = now;
                    lastVoiceTime = now;
                    audioBuffer.push(Buffer.from(buf));
                } else if (segmentStartTime) {
                    // 無音だけどセグメント中 → バッファに追加（後続の無音も含める）
                    audioBuffer.push(Buffer.from(buf));
                }

                // セグメント確定判定
                if (segmentStartTime) {
                    const segLen = now - segmentStartTime;

                    // 無音が続いた → セグメント確定
                    if (lastVoiceTime && (now - lastVoiceTime > silenceDuration) && segLen >= MIN_SEGMENT_MS) {
                        processSegment();
                    }
                    // 最大長超過 → 強制確定
                    else if (segLen >= MAX_SEGMENT_MS) {
                        processSegment();
                    }
                }
            }
        });
    } catch (e) {
        isActive = false;
        currentPid = null;
        return { success: false, error: e.message };
    }

    return { success: true, pid };
}

/**
 * キャプチャ停止
 */
function stop() {
    if (!isActive || !currentPid) return { success: false };

    try {
        capture.stopAudioCapture(currentPid);
    } catch (e) {
        console.warn('[VRChatListener] 停止エラー:', e.message);
    }

    isActive = false;
    audioBuffer = [];
    segmentStartTime = null;
    currentPid = null;

    console.log('[VRChatListener] 停止');
    if (onStateChange) onStateChange('stopped');

    return { success: true };
}

function getStatus() {
    return { active: isActive, pid: currentPid };
}

module.exports = { start, stop, getStatus, findVRChatPid };
