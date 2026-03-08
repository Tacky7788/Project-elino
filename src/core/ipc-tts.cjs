// ====== TTS IPCハンドラ（5エンジン・13ハンドラ + 3ヘルパー） ======

// 母音→口形状マッピング
function vowelToMouthShape(vowel) {
    const map = {
        'a': { mouthOpenY: 1.0, mouthForm: 0.0 },   // 大きく開く
        'i': { mouthOpenY: 0.4, mouthForm: 0.7 },   // 横に開く
        'u': { mouthOpenY: 0.3, mouthForm: -0.5 },  // すぼめる
        'e': { mouthOpenY: 0.6, mouthForm: 0.4 },   // 中くらい横
        'o': { mouthOpenY: 0.7, mouthForm: -0.3 },  // 丸く開く
        'N': { mouthOpenY: 0.1, mouthForm: 0.0 },   // ほぼ閉じ
        'cl': { mouthOpenY: 0.0, mouthForm: 0.0 },  // 促音（閉じ）
        'pau': { mouthOpenY: 0.0, mouthForm: 0.0 }, // ポーズ（閉じ）
    };
    return map[vowel] || { mouthOpenY: 0.0, mouthForm: 0.0 };
}

// VOICEVOX audio_queryからPhonemeEvent配列を生成
function extractPhonemeTimeline(queryData) {
    const phonemes = [];
    let currentTime = 0;

    // pre_phoneme_length (pause before speech)
    if (queryData.prePhonemeLength) {
        currentTime += queryData.prePhonemeLength;
    }

    for (const phrase of (queryData.accent_phrases || [])) {
        for (const mora of (phrase.moras || [])) {
            // 子音部分（口をすぼめるか閉じる）
            if (mora.consonant_length && mora.consonant_length > 0) {
                currentTime += mora.consonant_length;
            }

            // 母音部分
            const vowel = mora.vowel || 'a';
            const duration = mora.vowel_length || 0.1;
            const shape = vowelToMouthShape(vowel);

            phonemes.push({
                time: currentTime,
                duration: duration,
                vowel: vowel,
                mouthOpenY: shape.mouthOpenY,
                mouthForm: shape.mouthForm
            });

            currentTime += duration;
        }

        // pause_mora（フレーズ間のポーズ）
        if (phrase.pause_mora) {
            const pauseDuration = phrase.pause_mora.vowel_length || 0.1;
            phonemes.push({
                time: currentTime,
                duration: pauseDuration,
                vowel: 'pau',
                mouthOpenY: 0.0,
                mouthForm: 0.0
            });
            currentTime += pauseDuration;
        }
    }

    return phonemes;
}

/**
 * VOICEVOX互換API (audio_query → synthesis) の共通処理。
 * VOICEVOX, AivisSpeech で共用。
 */
async function synthesizeVoicevoxCompatible(baseUrl, text, speakerId, speed, pitch, intonationScale) {
    // 1. audio_query
    const queryResponse = await fetch(
        `${baseUrl}/audio_query?text=${encodeURIComponent(text)}&speaker=${speakerId}`,
        { method: 'POST' }
    );
    if (!queryResponse.ok) {
        const errText = await queryResponse.text().catch(() => '');
        throw new Error(`audio_query失敗: ${queryResponse.status} ${errText}`);
    }
    const queryData = await queryResponse.json().catch(() => { throw new Error('audio_queryのJSONパース失敗'); });

    // 2. 速度・ピッチ・抑揚設定を反映
    queryData.speedScale = speed ?? 1.0;
    queryData.pitchScale = pitch ?? 0;
    if (intonationScale !== undefined && intonationScale !== null) {
        queryData.intonationScale = intonationScale;
    }

    // 3. synthesis
    const synthResponse = await fetch(
        `${baseUrl}/synthesis?speaker=${speakerId}`,
        {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(queryData)
        }
    );
    if (!synthResponse.ok) {
        throw new Error('synthesis失敗');
    }

    const audioBuffer = await synthResponse.arrayBuffer();
    return { audioBuffer, queryData };
}

// ====== ハンドラ登録 ======

function registerTtsHandlers(ipcMain, { loadConfig, loadSettings }) {

    // ====== OpenAI TTS ======

    ipcMain.handle('tts:openai-synthesize', async (event, { text, voice, model, speed }) => {
        const config = await loadConfig();
        if (!config.openaiApiKey) {
            throw new Error('OpenAI APIキーが設定されていません');
        }

        try {
            const response = await fetch('https://api.openai.com/v1/audio/speech', {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${config.openaiApiKey}`,
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    model: model || 'tts-1',
                    input: text,
                    voice: voice || 'nova',
                    speed: speed || 1.0,
                    response_format: 'mp3'
                })
            });

            if (!response.ok) {
                const errorText = await response.text();
                throw new Error(`OpenAI TTS error: ${response.status} ${errorText}`);
            }

            const arrayBuffer = await response.arrayBuffer();
            console.log('🔊 OpenAI TTS:', text.substring(0, 30) + '...');
            return Buffer.from(arrayBuffer);
        } catch (err) {
            console.error('❌ OpenAI TTS error:', err);
            throw err;
        }
    });

    // ====== VOICEVOX ======

    ipcMain.handle('voicevox:check', async () => {
        try {
            const settings = await loadSettings();
            const baseUrl = settings.tts?.voicevox?.baseUrl || 'http://127.0.0.1:50021';
            const response = await fetch(`${baseUrl}/version`);
            if (response.ok) {
                const version = await response.text();
                return { available: true, version };
            }
            return { available: false, error: 'API応答なし' };
        } catch (err) {
            return { available: false, error: err.message };
        }
    });

    ipcMain.handle('voicevox:speakers', async () => {
        try {
            const settings = await loadSettings();
            const baseUrl = settings.tts?.voicevox?.baseUrl || 'http://127.0.0.1:50021';
            const response = await fetch(`${baseUrl}/speakers`);
            if (response.ok) {
                const speakers = await response.json();
                return { success: true, speakers };
            }
            return { success: false, error: 'API応答なし' };
        } catch (err) {
            return { success: false, error: err.message };
        }
    });

    ipcMain.handle('voicevox:synthesize-with-phonemes', async (event, { text, speakerId }) => {
        try {
            const settings = await loadSettings();
            const baseUrl = settings.tts?.voicevox?.baseUrl || 'http://127.0.0.1:50021';
            const speaker = speakerId ?? settings.tts?.voicevox?.speakerId ?? 0;

            // 1. audio_query でクエリ取得
            const queryResponse = await fetch(
                `${baseUrl}/audio_query?text=${encodeURIComponent(text)}&speaker=${speaker}`,
                { method: 'POST' }
            );
            if (!queryResponse.ok) {
                const errText = await queryResponse.text().catch(() => '');
                throw new Error(`audio_query失敗: ${queryResponse.status} ${errText}`);
            }
            const queryData = await queryResponse.json().catch(() => { throw new Error('audio_queryのJSONパース失敗'); });

            // 2. 速度・ピッチ・抑揚設定を反映
            const speed = settings.tts?.voicevox?.speed ?? 1.0;
            const pitch = settings.tts?.voicevox?.pitch ?? 0;
            const intonationScale = settings.tts?.voicevox?.intonationScale ?? 1.0;
            queryData.speedScale = speed;
            queryData.pitchScale = pitch;
            queryData.intonationScale = intonationScale;

            // 3. 音素タイムライン抽出（速度反映前のデータから計算し、速度で割る）
            const rawPhonemes = extractPhonemeTimeline(queryData);
            const phonemes = rawPhonemes.map(p => ({
                ...p,
                time: p.time / speed,
                duration: p.duration / speed
            }));

            // 4. synthesis で音声合成
            const synthResponse = await fetch(
                `${baseUrl}/synthesis?speaker=${speaker}`,
                {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(queryData)
                }
            );
            if (!synthResponse.ok) {
                throw new Error('synthesis失敗');
            }

            const audioBuffer = await synthResponse.arrayBuffer();
            return { audio: audioBuffer, phonemes };
        } catch (err) {
            console.error('❌ VOICEVOX合成(音素付き)エラー:', err);
            throw err;
        }
    });

    ipcMain.handle('voicevox:synthesize', async (event, { text, speakerId }) => {
        try {
            const settings = await loadSettings();
            const baseUrl = settings.tts?.voicevox?.baseUrl || 'http://127.0.0.1:50021';
            const speaker = speakerId ?? settings.tts?.voicevox?.speakerId ?? 0;

            // 1. audio_query でクエリ取得
            const queryResponse = await fetch(
                `${baseUrl}/audio_query?text=${encodeURIComponent(text)}&speaker=${speaker}`,
                { method: 'POST' }
            );
            if (!queryResponse.ok) {
                const errText = await queryResponse.text().catch(() => '');
                throw new Error(`audio_query失敗: ${queryResponse.status} ${errText}`);
            }
            const queryData = await queryResponse.json().catch(() => { throw new Error('audio_queryのJSONパース失敗'); });

            // 2. synthesis で音声合成
            const synthResponse = await fetch(
                `${baseUrl}/synthesis?speaker=${speaker}`,
                {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(queryData)
                }
            );
            if (!synthResponse.ok) {
                throw new Error('synthesis失敗');
            }

            // ArrayBuffer として返す
            const audioBuffer = await synthResponse.arrayBuffer();
            return audioBuffer;
        } catch (err) {
            console.error('❌ VOICEVOX合成エラー:', err);
            throw err;
        }
    });

    // ====== ElevenLabs TTS ======

    ipcMain.handle('tts:elevenlabs-synthesize', async (event, { text, voiceId, model, stability, similarityBoost, speed }) => {
        const config = await loadConfig();
        const apiKey = config.elevenlabsApiKey || process.env.ELEVENLABS_API_KEY;
        if (!apiKey) {
            throw new Error('ElevenLabs APIキーが設定されていません');
        }
        if (!voiceId) {
            throw new Error('ElevenLabs Voice IDが設定されていません');
        }

        try {
            const response = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${voiceId}`, {
                method: 'POST',
                headers: {
                    'xi-api-key': apiKey,
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    text,
                    model_id: model || 'eleven_multilingual_v2',
                    voice_settings: {
                        stability: stability ?? 0.5,
                        similarity_boost: similarityBoost ?? 0.75,
                        speed: speed ?? 1.0
                    }
                })
            });

            if (!response.ok) {
                const errorText = await response.text();
                throw new Error(`ElevenLabs TTS error: ${response.status} ${errorText}`);
            }

            const arrayBuffer = await response.arrayBuffer();
            console.log('🔊 ElevenLabs TTS:', text.substring(0, 30) + '...');
            return Buffer.from(arrayBuffer);
        } catch (err) {
            console.error('❌ ElevenLabs TTS error:', err);
            throw err;
        }
    });

    // ====== Google Cloud TTS ======

    ipcMain.handle('tts:google-synthesize', async (event, { text, languageCode, voiceName, speakingRate, pitch, useGeminiKey }) => {
        const config = await loadConfig();
        let apiKey;
        if (useGeminiKey) {
            apiKey = config.googleApiKey || process.env.GOOGLE_GENERATIVE_AI_API_KEY;
        } else {
            apiKey = config.googleTtsApiKey || process.env.GOOGLE_TTS_API_KEY || config.googleApiKey || process.env.GOOGLE_GENERATIVE_AI_API_KEY;
        }
        if (!apiKey) {
            throw new Error('Google APIキーが設定されていません');
        }

        try {
            const response = await fetch(`https://texttospeech.googleapis.com/v1/text:synthesize?key=${apiKey}`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    input: { text },
                    voice: {
                        languageCode: languageCode || 'ja-JP',
                        name: voiceName || 'ja-JP-Neural2-B'
                    },
                    audioConfig: {
                        audioEncoding: 'MP3',
                        speakingRate: speakingRate ?? 1.0,
                        pitch: pitch ?? 0
                    }
                })
            });

            if (!response.ok) {
                const errorText = await response.text();
                throw new Error(`Google TTS error: ${response.status} ${errorText}`);
            }

            const data = await response.json();
            // Google TTS returns base64 encoded audio
            const audioBuffer = Buffer.from(data.audioContent, 'base64');
            console.log('🔊 Google TTS:', text.substring(0, 30) + '...');
            return audioBuffer;
        } catch (err) {
            console.error('❌ Google TTS error:', err);
            throw err;
        }
    });

    // ====== AivisSpeech (VOICEVOX互換) ======

    ipcMain.handle('aivis-speech:check', async () => {
        try {
            const settings = await loadSettings();
            const baseUrl = settings.tts?.aivisSpeech?.baseUrl || 'http://127.0.0.1:10101';
            const response = await fetch(`${baseUrl}/version`);
            if (response.ok) {
                const version = await response.text();
                return { available: true, version };
            }
            return { available: false, error: 'API応答なし' };
        } catch (err) {
            return { available: false, error: err.message };
        }
    });

    ipcMain.handle('aivis-speech:speakers', async () => {
        try {
            const settings = await loadSettings();
            const baseUrl = settings.tts?.aivisSpeech?.baseUrl || 'http://127.0.0.1:10101';
            const response = await fetch(`${baseUrl}/speakers`);
            if (response.ok) {
                const speakers = await response.json();
                return { success: true, speakers };
            }
            return { success: false, error: 'API応答なし' };
        } catch (err) {
            return { success: false, error: err.message };
        }
    });

    ipcMain.handle('aivis-speech:synthesize', async (event, { text, speakerId }) => {
        try {
            const settings = await loadSettings();
            const baseUrl = settings.tts?.aivisSpeech?.baseUrl || 'http://127.0.0.1:10101';
            const speaker = speakerId ?? settings.tts?.aivisSpeech?.speakerId ?? 0;
            const speed = settings.tts?.aivisSpeech?.speed ?? 1.0;
            const pitch = settings.tts?.aivisSpeech?.pitch ?? 0;
            const intonationScale = settings.tts?.aivisSpeech?.intonationScale ?? 1.0;

            const { audioBuffer } = await synthesizeVoicevoxCompatible(baseUrl, text, speaker, speed, pitch, intonationScale);
            return audioBuffer;
        } catch (err) {
            console.error('❌ AivisSpeech合成エラー:', err);
            throw err;
        }
    });

    ipcMain.handle('aivis-speech:synthesize-with-phonemes', async (event, { text, speakerId }) => {
        try {
            const settings = await loadSettings();
            const baseUrl = settings.tts?.aivisSpeech?.baseUrl || 'http://127.0.0.1:10101';
            const speaker = speakerId ?? settings.tts?.aivisSpeech?.speakerId ?? 0;
            const speed = settings.tts?.aivisSpeech?.speed ?? 1.0;
            const pitch = settings.tts?.aivisSpeech?.pitch ?? 0;
            const intonationScale = settings.tts?.aivisSpeech?.intonationScale ?? 1.0;

            const { audioBuffer, queryData } = await synthesizeVoicevoxCompatible(baseUrl, text, speaker, speed, pitch, intonationScale);

            // 音素タイムライン抽出（速度反映）
            const rawPhonemes = extractPhonemeTimeline(queryData);
            const phonemes = rawPhonemes.map(p => ({
                ...p,
                time: p.time / speed,
                duration: p.duration / speed
            }));

            return { audio: audioBuffer, phonemes };
        } catch (err) {
            console.error('❌ AivisSpeech合成(音素付き)エラー:', err);
            throw err;
        }
    });

    // ====== Style-Bert-VITS2 ======

    ipcMain.handle('style-bert-vits2:check', async () => {
        try {
            const settings = await loadSettings();
            const baseUrl = settings.tts?.styleBertVits2?.baseUrl || 'http://127.0.0.1:5000';
            const response = await fetch(`${baseUrl}/models/info`);
            if (response.ok) {
                return { available: true };
            }
            return { available: false, error: 'API応答なし' };
        } catch (err) {
            return { available: false, error: err.message };
        }
    });

    ipcMain.handle('style-bert-vits2:synthesize', async (event, { text, modelId, speakerId, style, styleWeight, language, speed }) => {
        try {
            const settings = await loadSettings();
            const baseUrl = settings.tts?.styleBertVits2?.baseUrl || 'http://127.0.0.1:5000';

            const params = new URLSearchParams({
                text,
                model_id: String(modelId ?? 0),
                speaker_id: String(speakerId ?? 0),
                style: style || 'Neutral',
                style_weight: String(styleWeight ?? 5),
                language: language || 'JP',
                speed: String(speed ?? 1.0)
            });

            const response = await fetch(`${baseUrl}/voice?${params.toString()}`);
            if (!response.ok) {
                const errorText = await response.text().catch(() => '');
                throw new Error(`Style-Bert-VITS2 error: ${response.status} ${errorText}`);
            }

            const arrayBuffer = await response.arrayBuffer();
            console.log('🔊 Style-Bert-VITS2:', text.substring(0, 30) + '...');
            return Buffer.from(arrayBuffer);
        } catch (err) {
            console.error('❌ Style-Bert-VITS2 error:', err);
            throw err;
        }
    });
}

module.exports = { registerTtsHandlers };
