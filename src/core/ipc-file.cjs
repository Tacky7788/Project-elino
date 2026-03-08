'use strict';

const path = require('path');
const fs = require('fs').promises;
const fsSync = require('fs');
const { dialog } = require('electron');
const pdfParse = require('pdf-parse');

// ====== Whisper Local state ======
let whisperPipeline = null;
let whisperModelLoading = false;
let whisperModelId = 'onnx-community/whisper-tiny';

async function getWhisperPipeline() {
    if (whisperPipeline) return whisperPipeline;
    if (whisperModelLoading) {
        while (whisperModelLoading && !whisperPipeline) {
            await new Promise(r => setTimeout(r, 200));
        }
        return whisperPipeline;
    }

    whisperModelLoading = true;
    try {
        console.log('🤖 ローカルWhisperモデル読み込み中:', whisperModelId);
        const { pipeline } = await import('@huggingface/transformers');
        whisperPipeline = await pipeline('automatic-speech-recognition', whisperModelId, {
            dtype: 'fp32',
        });
        console.log('✅ ローカルWhisperモデル読み込み完了');
        return whisperPipeline;
    } catch (err) {
        console.error('❌ ローカルWhisperモデル読み込みエラー:', err);
        throw err;
    } finally {
        whisperModelLoading = false;
    }
}

function register(ipcMain, ctx) {
    const { loadConfig, appRoot } = ctx;

    // ====== STT (Whisper Local) ======

    ipcMain.handle('stt:transcribe-local', async (event, pcmBuffer, lang) => {
        try {
            const pipe = await getWhisperPipeline();
            const pcmData = new Float32Array(pcmBuffer);

            console.log('🎤 ローカルWhisper文字起こし開始... (samples:', pcmData.length, ')');
            const result = await pipe(pcmData, {
                language: lang || 'japanese',
                task: 'transcribe',
            });

            const text = result.text || '';
            console.log('🎤 ローカルWhisper結果:', text);
            return text;
        } catch (err) {
            console.error('❌ ローカルWhisperエラー:', err);
            throw err;
        }
    });

    ipcMain.handle('stt:local-model-status', async () => {
        return {
            loaded: whisperPipeline !== null,
            loading: whisperModelLoading,
            modelId: whisperModelId
        };
    });

    // ====== STT (Whisper API) ======

    ipcMain.handle('stt:transcribe', async (event, audioBuffer, lang, mimeType, whisperModel) => {
        const config = await loadConfig();
        if (!config.openaiApiKey) {
            throw new Error('OpenAI APIキーが設定されていません');
        }

        try {
            const mime = (mimeType || 'audio/webm').split(';')[0];
            const ext = mime.includes('ogg') ? 'ogg' : mime.includes('mp4') ? 'mp4' : 'webm';
            const buffer = Buffer.from(audioBuffer);
            const model = whisperModel || 'whisper-1';
            console.log(`🎤 Whisper送信: ${buffer.length} bytes, mime=${mime}, ext=${ext}, model=${model}`);

            const file = new File([buffer], `audio.${ext}`, { type: mime });

            const formData = new FormData();
            formData.append('file', file);
            formData.append('model', model);
            formData.append('language', lang || 'ja');

            const response = await fetch('https://api.openai.com/v1/audio/transcriptions', {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${config.openaiApiKey}`
                },
                body: formData
            });

            if (!response.ok) {
                const errorText = await response.text();
                throw new Error(`Whisper API error: ${response.status} ${errorText}`);
            }

            const result = await response.json();
            console.log('🎤 Whisper transcription:', result.text);
            return result.text || '';
        } catch (err) {
            console.error('❌ Whisper API error:', err);
            throw err;
        }
    });

    // ====== File Parsing (PDF) ======

    ipcMain.handle('parse-file', async (event, filePath) => {
        try {
            const ext = path.extname(filePath).toLowerCase();

            if (ext === '.pdf') {
                const dataBuffer = await fs.readFile(filePath);
                const data = await pdfParse(dataBuffer);
                return {
                    text: data.text,
                    pageCount: data.numpages
                };
            } else {
                throw new Error(`Unsupported file type: ${ext}`);
            }
        } catch (err) {
            console.error('File parse error:', err);
            throw err;
        }
    });

    // ====== Model File Selection ======

    ipcMain.handle('select-model-file', async () => {
        const result = await dialog.showOpenDialog({
            title: 'モデルファイルを選択',
            filters: [
                { name: 'Model Files', extensions: ['model3.json', 'vrm', 'zip'] }
            ],
            properties: ['openFile']
        });

        if (result.canceled || result.filePaths.length === 0) {
            return null;
        }

        const fullPath = result.filePaths[0];
        const ext = path.extname(fullPath).toLowerCase();

        // zip: 展開してmodel3.jsonまたはvrmを探す
        if (ext === '.zip') {
            try {
                const yauzl = require('yauzl');
                const zipName = path.basename(fullPath, '.zip');
                const destDir = path.join(appRoot, 'public', 'live2d', 'models', zipName);
                fsSync.mkdirSync(destDir, { recursive: true });

                await new Promise((resolve, reject) => {
                    yauzl.open(fullPath, { lazyEntries: true }, (err, zipfile) => {
                        if (err) return reject(err);
                        zipfile.readEntry();
                        zipfile.on('entry', (entry) => {
                            if (/\/$/.test(entry.fileName)) {
                                fsSync.mkdirSync(path.join(destDir, entry.fileName), { recursive: true });
                                zipfile.readEntry();
                            } else {
                                const filePath = path.join(destDir, entry.fileName);
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

                console.log(`📦 ZIP展開完了: ${fullPath} → ${destDir}`);

                // 展開したディレクトリからmodel3.jsonまたはvrmを探す
                const findModel = (dir) => {
                    const files = fsSync.readdirSync(dir, { recursive: true });
                    // model3.json優先
                    const model3 = files.find(f => f.endsWith('.model3.json'));
                    if (model3) return path.join(dir, model3);
                    const vrm = files.find(f => f.endsWith('.vrm'));
                    if (vrm) return path.join(dir, vrm);
                    return null;
                };

                const modelFile = findModel(destDir);
                if (!modelFile) {
                    console.error('❌ ZIP内にモデルファイルが見つかりません');
                    return null;
                }

                const publicLive2dPath = path.join(appRoot, 'public', 'live2d');
                const relativePath = modelFile.substring(publicLive2dPath.length).replace(/\\/g, '/');
                return '/live2d' + relativePath;
            } catch (err) {
                console.error('❌ ZIP展開失敗:', err.message);
                return null;
            }
        }

        // public/live2d/ 配下なら相対パス
        const publicLive2dPath = path.join(appRoot, 'public', 'live2d');
        if (fullPath.startsWith(publicLive2dPath)) {
            const relativePath = fullPath.substring(publicLive2dPath.length).replace(/\\/g, '/');
            return '/live2d' + relativePath;
        }

        // public/ 配下
        const publicPath = path.join(appRoot, 'public');
        if (fullPath.startsWith(publicPath)) {
            return fullPath.substring(publicPath.length).replace(/\\/g, '/');
        }

        // 外部パス: public/live2d/models/ にコピー
        try {
            const modelDir = path.dirname(fullPath);
            const modelDirName = path.basename(modelDir);
            const destDir = path.join(appRoot, 'public', 'live2d', 'models', modelDirName);

            if (!fsSync.existsSync(destDir)) {
                fsSync.cpSync(modelDir, destDir, { recursive: true });
                console.log(`📁 モデルをコピー: ${modelDir} → ${destDir}`);
            }

            const modelFileName = path.basename(fullPath);
            return `/live2d/models/${modelDirName}/${modelFileName}`.replace(/\\/g, '/');
        } catch (err) {
            console.error('❌ モデルコピー失敗:', err.message);
            return fullPath;
        }
    });

    // ====== Motion File Selection ======

    ipcMain.handle('select-motion-file', async () => {
        const result = await dialog.showOpenDialog({
            title: 'モーションファイルを選択',
            defaultPath: path.join(appRoot, 'public', 'live2d'),
            filters: [
                { name: 'Live2D Motion', extensions: ['json'] }
            ],
            properties: ['openFile']
        });

        if (result.canceled || result.filePaths.length === 0) {
            return null;
        }

        const fullPath = result.filePaths[0];

        if (!fullPath.endsWith('.motion3.json')) {
            return null;
        }

        const publicPath = path.join(appRoot, 'public');
        if (fullPath.startsWith(publicPath)) {
            return fullPath.substring(publicPath.length).replace(/\\/g, '/');
        }

        // 外部パス: public/live2d/motions/ にコピー
        try {
            const destDir = path.join(appRoot, 'public', 'live2d', 'motions');
            if (!fsSync.existsSync(destDir)) fsSync.mkdirSync(destDir, { recursive: true });
            const fileName = path.basename(fullPath);
            const destFile = path.join(destDir, fileName);
            fsSync.copyFileSync(fullPath, destFile);
            console.log(`📁 モーションコピー: ${fullPath} → ${destFile}`);
            return `/live2d/motions/${fileName}`;
        } catch (err) {
            console.error('❌ モーションコピー失敗:', err.message);
            return null;
        }
    });

    // モデルディレクトリ内の .motion3.json を一覧取得
    ipcMain.handle('list-model-motions', async (event, modelRelativePath) => {
        try {
            const modelDir = path.join(appRoot, 'public', path.dirname(modelRelativePath));
            const results = [];
            // ルート直下
            if (fsSync.existsSync(modelDir)) {
                for (const f of fsSync.readdirSync(modelDir)) {
                    if (f.endsWith('.motion3.json')) results.push(f);
                }
            }
            // motions/, motion/, states/ 等のサブフォルダも探索
            for (const sub of ['motions', 'motion', 'states', 'expressions']) {
                const subDir = path.join(modelDir, sub);
                if (fsSync.existsSync(subDir) && fsSync.statSync(subDir).isDirectory()) {
                    for (const f of fsSync.readdirSync(subDir)) {
                        if (f.endsWith('.motion3.json')) results.push(sub + '/' + f);
                    }
                }
            }
            return results;
        } catch (err) {
            console.error('❌ モーション一覧取得失敗:', err.message);
            return [];
        }
    });

    // model3.jsonからモーショングループ名・表情名を取得
    ipcMain.handle('get-model-info', async (event, modelRelativePath) => {
        try {
            const modelFile = path.join(appRoot, 'public', modelRelativePath);
            const content = JSON.parse(fsSync.readFileSync(modelFile, 'utf-8'));
            const refs = content.FileReferences || {};
            const motionGroups = Object.keys(refs.Motions || {});
            const expressions = (refs.Expressions || []).map(e => e.Name).filter(Boolean);
            return { motionGroups, expressions };
        } catch (err) {
            console.warn('model3.json解析失敗:', err.message);
            return { motionGroups: [], expressions: [] };
        }
    });

    // public/live2d/ 配下の全 .motion3.json を再帰スキャン
    ipcMain.handle('list-all-motions', async () => {
        try {
            const live2dDir = path.join(appRoot, 'public', 'live2d');
            const results = [];
            function scan(dir, prefix) {
                if (!fsSync.existsSync(dir)) return;
                for (const entry of fsSync.readdirSync(dir, { withFileTypes: true })) {
                    const rel = prefix + '/' + entry.name;
                    if (entry.isDirectory()) {
                        scan(path.join(dir, entry.name), rel);
                    } else if (entry.name.endsWith('.motion3.json')) {
                        results.push('/live2d' + rel);
                    }
                }
            }
            scan(live2dDir, '');
            return results;
        } catch (err) {
            console.error('全モーション一覧取得失敗:', err.message);
            return [];
        }
    });

    // ローカルモデルファイルを読み込んでBufferとして返す（VRM用）
    ipcMain.handle('read-model-file', async (event, filePath) => {
        try {
            const data = await fs.readFile(filePath);
            return { success: true, buffer: data.buffer };
        } catch (err) {
            console.error('❌ モデルファイル読み込み失敗:', err.message);
            return { success: false, error: err.message };
        }
    });
}

module.exports = { register };
