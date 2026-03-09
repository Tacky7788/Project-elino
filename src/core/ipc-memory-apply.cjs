'use strict';

const { tokenize, extractKeywords, computeRetention, computeFinalScore } = require('./memory-search.cjs');
const { invalidateFact: vectorInvalidateFact } = require('./memory-vector.cjs');

let _ctx = null;

// ====== 感情→表情マッピング ======

function determineExpression(emotions, lastExpression = 'neutral', lastExpressionTime = 0) {
    const { valence, arousal, dominance, fatigue, uncertainty, surprise } = emotions;
    const now = Date.now();
    const HOLD_TIME = 2500;

    if (now - lastExpressionTime < HOLD_TIME) {
        return lastExpression;
    }

    let baseExpression = 'neutral';

    if (surprise > 0.5) {
        baseExpression = 'surprised';
    } else if (uncertainty > 0.7) {
        baseExpression = 'confused';
    } else if (uncertainty > 0.55 && dominance < 0.5) {
        baseExpression = 'thinking';
    } else if (valence < 0.45 && arousal > 0.6) {
        baseExpression = 'annoyed';
    } else if (dominance > 0.65 && arousal > 0.45 && arousal < 0.7) {
        baseExpression = 'focused';
    } else if (valence > 0.65 && arousal > 0.6) {
        baseExpression = 'happy';
    } else if (valence < 0.4) {
        baseExpression = 'sad';
    }

    // ヒステリシス
    if (lastExpression !== 'neutral' && baseExpression === 'neutral') {
        const shouldStay =
            (lastExpression === 'happy' && valence > 0.55) ||
            (lastExpression === 'sad' && valence < 0.5) ||
            (lastExpression === 'annoyed' && valence < 0.55) ||
            (lastExpression === 'focused' && dominance > 0.55);

        if (shouldStay) {
            baseExpression = lastExpression;
        }
    }

    if (fatigue > 0.6 && baseExpression !== 'surprised') {
        baseExpression += '_tired';
    }

    return baseExpression;
}

function determineMotion(current, prev) {
    if (!prev) return null;

    const valenceDelta = current.valence - prev.valence;
    const trustDelta = current.trust - prev.trust;

    if (valenceDelta > 0.25) return 'celebrate';
    if (trustDelta > 0.2) return 'nod';
    if (current.uncertainty > 0.65 && current.dominance < 0.4) return 'shrug';

    return null;
}

function calculateVoiceTone(emotions) {
    const { arousal, valence, surprise } = emotions;

    let speed = 0.9 + arousal * 0.25;
    if (surprise > 0.5) speed += 0.05;
    speed = Math.max(0.85, Math.min(1.15, speed));

    let pitch = (valence - 0.5) * 0.2;
    if (surprise > 0.5) pitch += 0.03;
    pitch = Math.max(-0.1, Math.min(0.1, pitch));

    return { speed: parseFloat(speed.toFixed(2)), pitch: parseFloat(pitch.toFixed(2)) };
}

function calculateStyleParams(emotions) {
    const { dominance, uncertainty, fatigue } = emotions;

    const directness = 0.3 + dominance * 0.4;
    const hedgeRate = uncertainty * 0.5;
    const maxTokensHint = Math.round(150 - fatigue * 70);

    return {
        directness: parseFloat(directness.toFixed(2)),
        hedgeRate: parseFloat(hedgeRate.toFixed(2)),
        maxTokensHint
    };
}

// 感情次元を移動平均で更新（共通ヘルパー）
function updateDimension(current, newValue, smoothing, maxChange = 0.15) {
    const rawChange = newValue * smoothing + current * (1 - smoothing) - current;
    const clampedChange = Math.max(-maxChange, Math.min(maxChange, rawChange));
    return Math.max(0, Math.min(1, current + clampedChange));
}

// 感情の初期化
function initializeEmotions(memoryV2, today, now) {
    const { DEFAULT_MEMORY_V2 } = _ctx.constants;

    if (!memoryV2.relationship) {
        memoryV2.relationship = { ...DEFAULT_MEMORY_V2.relationship };
    }
    if (!memoryV2.relationship.emotions) {
        memoryV2.relationship.emotions = {
            current: { valence: 0.5, arousal: 0.4, dominance: 0.5, trust: 0.5, fatigue: 0.2, uncertainty: 0.5, surprise: 0.0 },
            recentAppraisals: [],
            dailyMood: { date: today, avgValence: 0.5, avgArousal: 0.4 },
            traits: { anxietyProne: 0.3, angerProne: 0.2, cautious: 0.4 },
            needs: { connection: 0.6, autonomy: 0.5, competence: 0.5 },
            lastExpression: 'neutral',
            lastExpressionTime: 0,
            prevEmotions: null,
            lastUpdated: now
        };
    }
}

// appraisal から感情を更新（emotionOnly / 通常パス共通）
function applyAppraisal(emotions, appraisal, today, now) {
    const newDims = appraisal.emotionDimensions;
    // 軸ごとのsmoothing: trustは長期変数なのでゆっくり動かす
    emotions.current.valence = updateDimension(emotions.current.valence, newDims.valence, 0.3);
    emotions.current.arousal = updateDimension(emotions.current.arousal, newDims.arousal, 0.35);
    emotions.current.dominance = updateDimension(emotions.current.dominance, newDims.dominance, 0.3);
    emotions.current.trust = updateDimension(emotions.current.trust, newDims.trust, 0.12);
    emotions.current.fatigue = updateDimension(emotions.current.fatigue, newDims.fatigue, 0.2);

    if (appraisal.needsImpact) {
        emotions.needs.connection = Math.max(0, Math.min(1, emotions.needs.connection + appraisal.needsImpact.connection));
        emotions.needs.autonomy = Math.max(0, Math.min(1, emotions.needs.autonomy + appraisal.needsImpact.autonomy));
        emotions.needs.competence = Math.max(0, Math.min(1, emotions.needs.competence + appraisal.needsImpact.competence));
    }

    emotions.current.uncertainty = Math.max(0, Math.min(1, 1 - emotions.needs.competence));

    if (emotions.current.surprise === undefined) emotions.current.surprise = 0;
    emotions.current.surprise = emotions.current.surprise * 0.5;
    const novelty = appraisal.novelty || 0.3;
    emotions.current.surprise = Math.min(1.0, emotions.current.surprise + novelty);
    if (emotions.current.surprise < 0.01) emotions.current.surprise = 0;

    emotions.recentAppraisals.unshift({
        situation: appraisal.situation,
        interpretation: appraisal.interpretation,
        triggeredAt: now
    });
    if (emotions.recentAppraisals.length > 3) {
        emotions.recentAppraisals = emotions.recentAppraisals.slice(0, 3);
    }

    if (emotions.dailyMood.date !== today) {
        emotions.dailyMood = { date: today, avgValence: emotions.current.valence, avgArousal: emotions.current.arousal };
    } else {
        const daySmoothing = 0.2;
        emotions.dailyMood.avgValence = emotions.dailyMood.avgValence * (1 - daySmoothing) + emotions.current.valence * daySmoothing;
        emotions.dailyMood.avgArousal = emotions.dailyMood.avgArousal * (1 - daySmoothing) + emotions.current.arousal * daySmoothing;
    }

    emotions.lastUpdated = now;
}

// 表情・モーション判定 + キャラウィンドウ送信
function applyExpressionAndMotion(emotions, logPrefix) {
    const { safeSend } = _ctx;

    const lastExpression = emotions.lastExpression || 'neutral';
    const lastExpressionTime = emotions.lastExpressionTime || 0;
    const expression = determineExpression(emotions.current, lastExpression, lastExpressionTime);

    if (expression !== lastExpression) {
        emotions.lastExpression = expression;
        emotions.lastExpressionTime = Date.now();
        console.log(`😊 ${logPrefix}表情変更: ${lastExpression} → ${expression}`);
        const cw = _ctx.characterWindow;
        if (cw && !cw.isDestroyed()) {
            cw.webContents.send('expression-change', expression);
        }
    }

    const motion = determineMotion(emotions.current, emotions.prevEmotions);
    if (motion) {
        console.log(`🎬 ${logPrefix}モーション: ${motion}`);
        const cw = _ctx.characterWindow;
        if (cw && !cw.isDestroyed()) {
            cw.webContents.send('motion-trigger', motion);
        }
    }

    emotions.prevEmotions = { ...emotions.current };
}

// boredom/energy リセット + 感情慣性
function applyPostConversationUpdates(memoryV2) {
    if (memoryV2.relationship?.emotions?.current) {
        const cur = memoryV2.relationship.emotions.current;
        cur.boredom = Math.max(0, (cur.boredom || 0) - 0.3);
        // 会話でenergy回復（0.05/h減少に対して十分な回復量）
        cur.energy = Math.min(1.0, (cur.energy || 0.8) + 0.1);
    }

    if (memoryV2.relationship?.emotions?.current) {
        const emotions = memoryV2.relationship.emotions;
        for (const dim of ['valence', 'arousal', 'dominance', 'trust']) {
            const val = emotions.current[dim];
            if (val >= 0.7 || val <= 0.3) {
                const intensity = Math.abs(val - 0.5) * 2;
                const expirySec = 30 + 60 * intensity;
                emotions.dominantEmotion = { dimension: dim, value: val, since: new Date().toISOString() };
                emotions.dominantEmotionExpiry = new Date(Date.now() + expirySec * 1000).toISOString();
                break;
            }
        }
    }
}

function register(ipcMain, ctx) {
    _ctx = ctx;
    const {
        ensureCompanionDir, loadConfig, loadSettings,
        loadMemoryV2Cached, loadStateCached,
        setMemoryV2Cache, markDirty,
        llmProvider, constants,
    } = ctx;
    const { DEFAULT_MEMORY_V2, CONFIG_FILE, getFilePaths } = constants;

    // memory:applyConversation
    ipcMain.handle('memory:applyConversation', async (event, { userMessage, assistantMessage, emotionOnly }) => {
        await ensureCompanionDir();

        try {
            const memoryV2 = await loadMemoryV2Cached();
            const config = await loadConfig();
            const settings = await loadSettings();
            const today = new Date().toISOString().split('T')[0];
            const now = new Date().toISOString();

            // 1. relationship更新
            if (!memoryV2.relationship) {
                memoryV2.relationship = { ...DEFAULT_MEMORY_V2.relationship };
            }
            memoryV2.relationship.interactionCount++;
            memoryV2.relationship.lastInteraction = now;
            if (!memoryV2.relationship.firstMet) {
                memoryV2.relationship.firstMet = now;
            }

            // 2a. emotionOnly: 感情のみ抽出
            if (emotionOnly && config.openaiApiKey && userMessage) {
                try {
                    const emotionPrompt = `
会話からコンパニオン（アシスタント）の感情を分析してJSONで返して：

会話:
ユーザー: ${userMessage}
アシスタント: ${assistantMessage}

重要: emotionDimensionsは「今回の会話で感じた値」（累積値ではない）
**必ず実際の会話内容を分析して、各次元を0.0-1.0で評価すること（サンプル値をそのまま使わない）**
- valence: 快/不快（楽しい話=0.7-0.9、悲しい話=0.2-0.4、普通=0.5前後）
- arousal: 覚醒度（興奮・驚き=0.7-0.9、穏やか=0.2-0.4、普通=0.5前後）
- dominance: 支配性（主導的・自信=0.7-0.9、受動的・不安=0.2-0.4、普通=0.5前後）
- trust: 信頼度（信頼できる=0.7-0.9、疑わしい=0.2-0.4、普通=0.5前後）
- fatigue: 疲労度（疲れた話=0.6-0.9、元気な話=0.1-0.3、普通=0.3-0.4）

形式（JSONのみ、他のテキスト不要）:
{
  "appraisal": {
    "situation": "会話で起きたこと（1文）",
    "interpretation": "コンパニオンがどう解釈したか",
    "emotionDimensions": {
      "valence": 0.5,
      "arousal": 0.4,
      "dominance": 0.5,
      "trust": 0.5,
      "fatigue": 0.3
    },
    "needsImpact": {
      "connection": 0.0,
      "autonomy": 0.0,
      "competence": 0.0
    },
    "novelty": 0.3
  }
}
`;
                    const util = await llmProvider.resolveUtilityCredential(settings, config, CONFIG_FILE);
                    if (!util) throw new Error('ユーティリティLLM未設定');
                    const emotionResult = await llmProvider.generateText({
                        provider: util.provider,
                        model: util.model,
                        apiKey: util.apiKey,
                        credentialType: util.credentialType,
                        prompt: emotionPrompt,
                        maxTokens: 512,
                        temperature: 0.3
                    });

                    if (emotionResult.text) {
                        const jsonMatch = emotionResult.text.match(/\{[\s\S]*\}/);
                        if (jsonMatch) {
                            const extracted = JSON.parse(jsonMatch[0]);
                            if (extracted.appraisal && extracted.appraisal.emotionDimensions) {
                                initializeEmotions(memoryV2, today, now);
                                const emotions = memoryV2.relationship.emotions;
                                applyAppraisal(emotions, extracted.appraisal, today, now);

                                console.log('🎭 [emotionOnly] 感情更新:', {
                                    situation: extracted.appraisal.situation,
                                    current: {
                                        valence: emotions.current.valence.toFixed(2),
                                        arousal: emotions.current.arousal.toFixed(2),
                                        fatigue: emotions.current.fatigue.toFixed(2),
                                        surprise: emotions.current.surprise.toFixed(2)
                                    }
                                });

                                applyExpressionAndMotion(emotions, '[emotionOnly] ');
                            }
                        }
                    }
                } catch (emotionErr) {
                    console.warn('⚠️ [emotionOnly] 感情抽出スキップ:', emotionErr.message);
                }

                applyPostConversationUpdates(memoryV2);

                memoryV2.updatedAt = now;
                memoryV2.rev = (memoryV2.rev || 0) + 1;
                setMemoryV2Cache(memoryV2);
                markDirty('memory');

                console.log('✅ memory:applyConversation [emotionOnly] 完了');
                return { success: true };
            }

            // 2b. 通常パス: LLMで全抽出
            if (config.openaiApiKey && userMessage) {
                try {
                    const pendingPromises = (memoryV2.promises || []).filter(p => p.status === 'pending');
                    const pendingPromisesText = pendingPromises.length > 0
                        ? `\n現在の未達成の約束:\n${pendingPromises.map((p, i) => `${i + 1}. ${p.content}`).join('\n')}`
                        : '';

                    const existingFactKeys = (memoryV2.facts || []).map(f => f.key).join(', ');
                    const extractPrompt = `
会話から記憶すべき情報を抽出してJSONで返して。

## facts: ユーザーについて覚えるべき事実
**積極的に抽出すること。些細なことでも記憶する。**

抽出すべきもの:
- 個人情報: 名前、年齢、職業、学校、住んでる場所
- 好み: 好きなもの、嫌いなもの、趣味、推し、食べ物、音楽、ゲーム
- 体験・出来事: 最近やったこと、行った場所、見たもの、作ったもの
- 意見・考え: 何かについての考え、価値観、こだわり
- 人間関係: 友達、家族、ペットについての言及
- スキル・知識: できること、勉強していること、詳しい分野
- 状態: 体調、気分、忙しさ、予定

keyの命名規則（既存と重複しないように）:
- "likes|{具体名}" — 好きなもの（例: "likes|steinsgate", "likes|coffee"）
- "dislikes|{具体名}" — 嫌いなもの
- "profile|{項目}" — プロフィール情報（例: "profile|job", "profile|school"）
- "event|{内容}" — 出来事（例: "event|watched_naruto", "event|went_to_tokyo"）
- "skill|{分野}" — スキル（例: "skill|unity", "skill|cooking"）
- "opinion|{話題}" — 意見・考え
- "relation|{人物}" — 人間関係

既存のキー: ${existingFactKeys || 'なし'}
↑既存キーと同じものは出さない。内容が更新される場合のみ同じキーで上書き。

importance: "high"=忘れてはいけない核心情報, "medium"=覚えておくと良い, "low"=些細だが記憶に残る

## promise: 明確な約束・予定のみ
「〜しよう」「〜する予定」「今度〜」など具体的な行動の約束だけ。
「雑談」「話題」「内容」のような曖昧なものは約束ではない。nullにする。

## episode: 一緒に経験した重要な出来事（あれば短く記述、なければnull）
「一緒にゲームした」「悩みを相談してくれた」「お祝いした」など、関係性に影響する出来事のみ。
日常的な雑談はnull。本当に印象的な出来事だけ記録する。

## openLoop: 続きがありそうな話題
ユーザーが途中で切った話題、「また今度」と言った話題など。
ただし挨拶や相槌だけの会話ではnull。
${pendingPromisesText}

重要: emotionDimensionsは「今回の会話で感じた値」（累積値ではない）
**必ず実際の会話内容を分析して、各次元を0.0-1.0で評価すること（サンプル値をそのまま使わない）**
- valence: 快/不快（楽しい話=0.7-0.9、悲しい話=0.2-0.4、普通=0.5前後）
- arousal: 覚醒度（興奮・驚き=0.7-0.9、穏やか=0.2-0.4、普通=0.5前後）
- dominance: 支配性（主導的・自信=0.7-0.9、受動的・不安=0.2-0.4、普通=0.5前後）
- trust: 信頼度（信頼できる=0.7-0.9、疑わしい=0.2-0.4、普通=0.5前後）
- fatigue: 疲労度（疲れた話=0.6-0.9、元気な話=0.1-0.3、普通=0.3-0.4）
感情の主張は控えめに（valence=0.6で「ちょっと嬉しい」程度）

会話:
ユーザー: ${userMessage}
アシスタント: ${assistantMessage}

形式（JSONのみ、他のテキスト不要）:
{
  "facts": [{"key": "likes|steinsgate", "content": "Steins;Gateが好き。タイムループの設定と伏線回収が刺さるらしい", "importance": "high"}],
  "topics": ["話題1"],
  "promise": null,
  "sentiment": "positive",
  "mood": "normal",
  "avoidedTopics": [],
  "fulfilledPromises": [],
  "impression": null,
  "appraisal": {
    "situation": "会話で起きたこと（1文）",
    "interpretation": "コンパニオンがどう解釈したか",
    "emotionDimensions": { "valence": 0.5, "arousal": 0.4, "dominance": 0.5, "trust": 0.5, "fatigue": 0.3 },
    "needsImpact": { "connection": 0.0, "autonomy": 0.0, "competence": 0.0 },
    "novelty": 0.3
  },
  "episode": null,
  "openLoop": null,
  "resolvedLoops": null
}
`;
                    const util2 = await llmProvider.resolveUtilityCredential(settings, config, CONFIG_FILE);
                    if (!util2) throw new Error('ユーティリティLLM未設定');
                    const extractResult = await llmProvider.generateText({
                        provider: util2.provider,
                        model: util2.model,
                        apiKey: util2.apiKey,
                        credentialType: util2.credentialType,
                        prompt: extractPrompt,
                        maxTokens: 1024,
                        temperature: 0.3
                    });

                    if (extractResult.text) {
                        const jsonMatch = extractResult.text.match(/\{[\s\S]*\}/);
                        if (jsonMatch) {
                            const extracted = JSON.parse(jsonMatch[0]);

                            // facts更新
                            if (extracted.facts && Array.isArray(extracted.facts)) {
                                if (!memoryV2.facts) memoryV2.facts = [];
                                const currentEmotions = memoryV2.relationship?.emotions?.current;
                                const emotionalContext = currentEmotions
                                    ? { valence: currentEmotions.valence, arousal: currentEmotions.arousal }
                                    : undefined;

                                for (const newFact of extracted.facts) {
                                    const existing = memoryV2.facts.find(f => f.key === newFact.key);
                                    if (existing) {
                                        existing.content = newFact.content;
                                        existing.lastSeenAt = today;
                                        existing.seenCount = (existing.seenCount || 1) + 1;
                                        existing.keywords = extractKeywords(newFact.content);
                                        if (emotionalContext) {
                                            existing.emotionalContext = emotionalContext;
                                        }
                                        vectorInvalidateFact(newFact.key).catch(() => {});
                                    } else {
                                        // 感情強度に応じてdecayRateを初期設定（感情的な記憶は初めから忘れにくい）
                                        let decayRate = 1.0;
                                        if (emotionalContext) {
                                            const intensity = Math.abs(emotionalContext.valence - 0.5) * 2;
                                            decayRate = 1.0 - intensity * 0.5;
                                            decayRate = Math.max(0.1, decayRate);
                                        }
                                        memoryV2.facts.push({
                                            key: newFact.key,
                                            content: newFact.content,
                                            addedAt: today,
                                            lastSeenAt: today,
                                            seenCount: 1,
                                            importance: newFact.importance || 'medium',
                                            keywords: extractKeywords(newFact.content),
                                            emotionalContext,
                                            recallCount: 1,
                                            decayRate,
                                        });
                                        vectorInvalidateFact(newFact.key).catch(() => {});
                                    }
                                }
                            }

                            // topics更新
                            if (extracted.topics && Array.isArray(extracted.topics)) {
                                if (!memoryV2.topics) memoryV2.topics = { recent: [], favorites: [], avoided: [], mentioned: {} };
                                for (const topic of extracted.topics) {
                                    memoryV2.topics.recent = [topic, ...memoryV2.topics.recent.filter(t => t !== topic)].slice(0, 20);
                                    if (!memoryV2.topics.mentioned[topic]) {
                                        memoryV2.topics.mentioned[topic] = { count: 0, lastMentioned: '' };
                                    }
                                    memoryV2.topics.mentioned[topic].count++;
                                    memoryV2.topics.mentioned[topic].lastMentioned = today;
                                    if (memoryV2.topics.mentioned[topic].count >= 5 && !memoryV2.topics.favorites.includes(topic)) {
                                        memoryV2.topics.favorites.push(topic);
                                    }
                                }
                            }

                            // promise追加
                            if (extracted.promise && extracted.promise.content) {
                                if (!memoryV2.promises) memoryV2.promises = [];
                                memoryV2.promises.push({
                                    content: extracted.promise.content,
                                    madeAt: today,
                                    status: 'pending',
                                    deadline: extracted.promise.deadline || null
                                });
                            }

                            // episode（重要な出来事をエピソードとして記録）
                            if (extracted.episode) {
                                if (!memoryV2.relationship) memoryV2.relationship = { ...DEFAULT_MEMORY_V2.relationship };
                                if (!memoryV2.relationship.episodes) memoryV2.relationship.episodes = [];
                                memoryV2.relationship.episodes.push({
                                    date: today,
                                    type: extracted.sentiment === 'positive' ? 'bonding' : 'neutral',
                                    content: extracted.episode
                                });
                                // 最大50件に制限
                                if (memoryV2.relationship.episodes.length > 50) {
                                    memoryV2.relationship.episodes = memoryV2.relationship.episodes.slice(-50);
                                }
                            }

                            // avoidedTopics
                            if (extracted.avoidedTopics && Array.isArray(extracted.avoidedTopics) && extracted.avoidedTopics.length > 0) {
                                if (!memoryV2.topics) memoryV2.topics = { recent: [], favorites: [], avoided: [], mentioned: {} };
                                if (!memoryV2.topics.avoided) memoryV2.topics.avoided = [];
                                for (const topic of extracted.avoidedTopics) {
                                    if (!memoryV2.topics.avoided.includes(topic)) {
                                        memoryV2.topics.avoided.push(topic);
                                    }
                                }
                            }

                            // fulfilledPromises
                            if (extracted.fulfilledPromises && Array.isArray(extracted.fulfilledPromises) && extracted.fulfilledPromises.length > 0) {
                                const pending = (memoryV2.promises || []).filter(p => p.status === 'pending');
                                for (const idx of extracted.fulfilledPromises) {
                                    const promiseIdx = parseInt(idx) - 1;
                                    if (pending[promiseIdx]) {
                                        pending[promiseIdx].status = 'fulfilled';
                                        pending[promiseIdx].fulfilledAt = today;
                                    }
                                }
                            }

                            // impression
                            if (extracted.impression) {
                                if (!memoryV2.impressions) memoryV2.impressions = { ofUser: [], fromUser: [] };
                                if (!memoryV2.impressions.ofUser) memoryV2.impressions.ofUser = [];
                                memoryV2.impressions.ofUser.push(extracted.impression);
                                if (memoryV2.impressions.ofUser.length > 20) {
                                    memoryV2.impressions.ofUser = memoryV2.impressions.ofUser.slice(-20);
                                }
                            }

                            // openLoop
                            if (extracted.openLoop && extracted.openLoop.content) {
                                if (!memoryV2.promises) memoryV2.promises = [];
                                const existing = memoryV2.promises.find(
                                    p => p.type === 'open_loop' && p.status === 'pending' && p.content === extracted.openLoop.content
                                );
                                if (!existing) {
                                    memoryV2.promises.push({
                                        content: extracted.openLoop.content,
                                        madeAt: today,
                                        status: 'pending',
                                        deadline: null,
                                        type: 'open_loop',
                                        priority: extracted.openLoop.priority || 'medium',
                                        lastFollowedUp: null
                                    });
                                }
                            }

                            // resolvedLoops
                            if (extracted.resolvedLoops && Array.isArray(extracted.resolvedLoops)) {
                                for (const keyword of extracted.resolvedLoops) {
                                    const loop = (memoryV2.promises || []).find(
                                        p => p.type === 'open_loop' && p.status === 'pending' && p.content.includes(keyword)
                                    );
                                    if (loop) {
                                        loop.status = 'resolved';
                                        loop.resolvedAt = new Date().toISOString();
                                    }
                                }
                            }

                            // 感情システム: appraisal処理
                            if (extracted.appraisal && extracted.appraisal.emotionDimensions) {
                                initializeEmotions(memoryV2, today, now);
                                const emotions = memoryV2.relationship.emotions;
                                const appraisal = extracted.appraisal;
                                const newDims = appraisal.emotionDimensions;

                                applyAppraisal(emotions, appraisal, today, now);

                                console.log('🎭 感情更新:', {
                                    situation: appraisal.situation,
                                    newDims: {
                                        valence: newDims.valence.toFixed(2),
                                        arousal: newDims.arousal.toFixed(2),
                                        fatigue: newDims.fatigue.toFixed(2)
                                    },
                                    current: {
                                        valence: emotions.current.valence.toFixed(2),
                                        arousal: emotions.current.arousal.toFixed(2),
                                        fatigue: emotions.current.fatigue.toFixed(2),
                                        uncertainty: emotions.current.uncertainty.toFixed(2),
                                        surprise: emotions.current.surprise.toFixed(2)
                                    }
                                });

                                applyExpressionAndMotion(emotions, '');

                                // 声トーン計算
                                const voiceTone = calculateVoiceTone(emotions.current);
                                console.log(`🎤 声トーン: speed=${voiceTone.speed}, pitch=${voiceTone.pitch}`);

                                const styleParams = calculateStyleParams(emotions.current);
                                console.log(`📝 スタイル: directness=${styleParams.directness}, hedgeRate=${styleParams.hedgeRate}, maxTokens=${styleParams.maxTokensHint}`);

                                // styleParamsをtransientStateに保存（ipc-llm.cjsから参照）
                                if (_ctx.transientState) {
                                    _ctx.transientState.styleParams = styleParams;
                                }
                            }
                        }
                    }
                } catch (extractErr) {
                    console.warn('⚠️ 記憶抽出スキップ:', extractErr.message);
                }
            }

            // 3. boredom/energy リセット + 感情慣性
            applyPostConversationUpdates(memoryV2);

            // 5. 質問バジェット
            const state = await loadStateCached();
            const questionMarks = (assistantMessage.match(/[？?]/g) || []).length;
            const containsQuestion = questionMarks > 0;
            if (!state.questionBudget) {
                state.questionBudget = { askedLastTurn: false, consecutiveQuestions: 0, lastQuestionAt: null, questionCooldownSec: 0, questionCount: 0, statementStreak: 0 };
            }
            state.questionBudget.askedLastTurn = containsQuestion;
            state.questionBudget.consecutiveQuestions = containsQuestion ? (state.questionBudget.consecutiveQuestions || 0) + 1 : 0;
            state.questionBudget.questionCount = containsQuestion ? (state.questionBudget.questionCount || 0) + questionMarks : (state.questionBudget.questionCount || 0);
            state.questionBudget.statementStreak = containsQuestion ? 0 : (state.questionBudget.statementStreak || 0) + 1;
            if (containsQuestion) {
                state.questionBudget.lastQuestionAt = Date.now();
                state.questionBudget.questionCooldownSec = 60 + state.questionBudget.consecutiveQuestions * 30;
            }

            // 6. ターンカウント
            state.turnCount = (state.turnCount || 0) + 1;
            state.sessionTurnCount = (state.sessionTurnCount || 0) + 1;
            state.lastAssistantMessageAt = now;
            markDirty('state');

            // 7. recallScore更新（忘却曲線ベース）+ 想起時にrecallCountインクリメント
            if (memoryV2.facts) {
                const msgTokens = tokenize((userMessage || '') + ' ' + (assistantMessage || ''));
                const nowMs = Date.now();
                for (const fact of memoryV2.facts) {
                    if (!fact.keywords) fact.keywords = extractKeywords(fact.content);

                    let overlap = 0;
                    for (const kw of fact.keywords) {
                        if (msgTokens.has(kw)) overlap++;
                    }

                    const recalled = overlap >= 2;
                    if (recalled) {
                        fact.recallCount = (fact.recallCount ?? 0) + 1;
                        fact.lastSeenAt = today;
                    }

                    // 常に最新の忘却曲線スコアを再計算
                    const similarity = recalled ? Math.min(1.0, overlap * 0.1) : 0;
                    fact.recallScore = computeFinalScore(fact, similarity, nowMs);
                }
            }

            // 8. 保存
            memoryV2.updatedAt = now;
            memoryV2.rev = (memoryV2.rev || 0) + 1;
            setMemoryV2Cache(memoryV2);
            markDirty('memory');

            console.log('✅ memory:applyConversation 完了');
            return { success: true };
        } catch (err) {
            console.error('❌ memory:applyConversation 失敗:', err);
            return { success: false, reason: err.message };
        }
    });

    // memory:getContext
    ipcMain.handle('memory:getContext', async () => {
        const memoryV2 = await loadMemoryV2Cached();
        const policy = memoryV2.contextPolicy || DEFAULT_MEMORY_V2.contextPolicy;

        // recallScoreが未計算のfactは忘却曲線で補完してからソート
        const nowMs = Date.now();
        const sortedFacts = (memoryV2.facts || [])
            .map(f => {
                if (f.recallScore === undefined) {
                    f.recallScore = computeFinalScore(f, 0, nowMs);
                }
                return f;
            })
            .sort((a, b) => (b.recallScore ?? 0) - (a.recallScore ?? 0))
            .slice(0, policy.maxFacts);

        const recentSummaries = (memoryV2.summaries || []).slice(-policy.maxSummaries);
        const recentTopics = (memoryV2.topics?.recent || []).slice(0, policy.maxTopics);
        const pendingPromises = (memoryV2.promises || [])
            .filter(p => p.status === 'pending')
            .slice(0, policy.maxPromises);
        const relationship = memoryV2.relationship || DEFAULT_MEMORY_V2.relationship;

        return {
            facts: sortedFacts,
            summaries: recentSummaries,
            topics: recentTopics,
            promises: pendingPromises,
            relationship,
            impressions: memoryV2.impressions || { ofUser: [], fromUser: [] },
            avoidedTopics: memoryV2.topics?.avoided || []
        };
    });
}

module.exports = {
    register,
    determineExpression,
    determineMotion,
    calculateVoiceTone,
    calculateStyleParams,
};
