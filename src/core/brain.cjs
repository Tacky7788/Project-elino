// src/core/brain.cjs — 行動決定・感情減衰・記憶減衰・リフレクション
'use strict';

const { extractKeywords } = require('./memory-search.cjs');

const BRAIN_CONFIG = {
    TICK_INTERVAL_MS: 1000,
    SILENCE_THRESHOLDS: { backchannel: 15, followup: 20, topic_shift_min: 25, topic_shift_max: 40 },
    COOLDOWNS: {
        backchannel: 10,
        followup: 60,
        topic_shift: 45,
        open_loop_followup: 120,
        notebook_check: 300,
        _global: 120  // 総発話クールダウン（秒）
    },
    BOREDOM_THRESHOLD: 0.6,
    ENERGY_LOW_THRESHOLD: 0.2,
    EMOTION_SAVE_INTERVAL_MS: 30000,
    RECALL_DECAY_INTERVAL_MS: 60000,
    REFLECTION_TURN_INTERVAL: 25,
    REFLECTION_OL_TURN_INTERVAL: 15
};

// ====== Interrupt Gate ======

/**
 * brainTick が発話していい条件を数値で判定。true のとき発話ブロック
 */
function isInterruptBlocked(transientState, state, chatWindow, proactiveLevel = 1) {
    // TTS再生中 or LLMストリーミング中（renderer側フラグ）
    if (transientState.doNotDisturb) return true;
    // LLMストリーミング中（main process側フラグ — IPC遅延対策）
    if (transientState.isLLMStreaming) return true;
    // STTリスニング中（聞き取り中は黙る）
    if (transientState.isMicListening) return true;
    // ユーザーが直近8秒以内にアクティブ（作業中）
    const lastMsg = state.lastMessageAt ? Date.now() - new Date(state.lastMessageAt).getTime() : Infinity;
    if (lastMsg < 8000) return true;
    // チャットウィンドウ非表示
    if (!chatWindow || chatWindow.isDestroyed() || !chatWindow.isVisible()) return true;
    // 発話予算（レベルに応じた可変CD）
    const lvl = PROACTIVE_LEVEL_MULTIPLIERS[proactiveLevel] || PROACTIVE_LEVEL_MULTIPLIERS[1];
    if (Date.now() - (transientState.lastBrainSpokeAt || 0) < lvl.globalCD * 1000) return true;
    // おやすみモード（quietHoursStart/Endがundefinedの場合は無効）
    if (transientState.quietHoursStart !== undefined && transientState.quietHoursEnd !== undefined) {
        const hour = new Date().getHours();
        const quietStart = transientState.quietHoursStart;
        const quietEnd = transientState.quietHoursEnd;
        if (quietStart > quietEnd) {
            // 日跨ぎ（例: 23-7）
            if (hour >= quietStart || hour < quietEnd) return true;
        } else {
            if (hour >= quietStart && hour < quietEnd) return true;
        }
    }
    return false;
}

// ====== 感情減衰 ======

/**
 * 時間経過による感情値の減衰
 * @param {object} emotions - memoryV2.relationship.emotions
 * @param {number} elapsedMs - 前回からの経過ミリ秒
 */
function decayEmotions(emotions, elapsedMs) {
    if (!emotions || !emotions.current) return;
    const seconds = elapsedMs / 1000;
    if (seconds <= 0) return;

    // 慣性チェック
    let decayMul = 1.0;
    if (emotions.dominantEmotion && emotions.dominantEmotionExpiry) {
        if (Date.now() < new Date(emotions.dominantEmotionExpiry).getTime()) {
            decayMul = 0.7;
        } else {
            emotions.dominantEmotion = null;
            emotions.dominantEmotionExpiry = null;
        }
    }

    // 指数減衰: overshoot防止。t=時間(h), speed=収束速度
    const t = seconds / 3600; // 時間単位に変換
    const decay = (target, cur, speed) => {
        const factor = 1 - Math.exp(-speed * t * decayMul);
        return cur + (target - cur) * factor;
    };

    emotions.current.valence   = decay(0.5, emotions.current.valence, 0.5);
    emotions.current.arousal   = decay(0.4, emotions.current.arousal, 0.5);
    emotions.current.dominance = decay(0.5, emotions.current.dominance, 0.5);
    emotions.current.trust     = decay(0.5, emotions.current.trust, 0.15);
    emotions.current.surprise  = decay(0.0, emotions.current.surprise, 3.0);
    emotions.current.fatigue   = decay(0.1, emotions.current.fatigue, 0.5);

    // boredom: 沈黙中に漸近的に増加（上限1.0）
    emotions.current.boredom = Math.min(1.0, (emotions.current.boredom || 0) + 0.1 * t);

    // energy: 時間で漸近的に減少（下限0.0）
    emotions.current.energy = Math.max(0.0, (emotions.current.energy || 0.8) - 0.05 * t);
}

// ====== 行動決定 ======

// クールダウン追跡（メモリ内のみ）
const _actionCooldowns = {};

function _isCooldownActive(actionType) {
    const lastAt = _actionCooldowns[actionType] || 0;
    const cdSec = BRAIN_CONFIG.COOLDOWNS[actionType] || 60;
    return Date.now() - lastAt < cdSec * 1000;
}

function _markCooldown(actionType) {
    _actionCooldowns[actionType] = Date.now();
}

/**
 * 優先度順でアクションを決定
 * @returns {{ type: string, context?: object } | null}
 */
// 話しかけ頻度レベル → 倍率テーブル
// level: 0=ほぼ話さない, 1=たまに(デフォルト), 2=ときどき, 3=よく話す
const PROACTIVE_LEVEL_MULTIPLIERS = [
    { silenceMult: 3.0, globalCD: 300 },  // 0: ほぼ話さない
    { silenceMult: 1.0, globalCD: 120 },  // 1: たまに（現状通り）
    { silenceMult: 0.7, globalCD: 60 },   // 2: ときどき
    { silenceMult: 0.5, globalCD: 30 },   // 3: よく話す
];

function decideAction(silenceSeconds, memoryV2, state, proactiveLevel = 1) {
    const emotions = memoryV2?.relationship?.emotions?.current || {};
    const energy = emotions.energy ?? 0.8;
    const boredom = emotions.boredom ?? 0;

    // 話しかけ頻度レベルに応じた倍率
    const lvl = PROACTIVE_LEVEL_MULTIPLIERS[proactiveLevel] || PROACTIVE_LEVEL_MULTIPLIERS[1];
    const m = lvl.silenceMult;
    const th = BRAIN_CONFIG.SILENCE_THRESHOLDS;

    // 1. energy < 閾値 → 疲れて喋らない
    if (energy < BRAIN_CONFIG.ENERGY_LOW_THRESHOLD) return null;

    // 2. 総発話クールダウン未消化（レベルで可変）
    const globalLastAt = _actionCooldowns['_global'] || 0;
    if (Date.now() - globalLastAt < lvl.globalCD * 1000) return null;

    // 3. notebook_check（dueAtが今日以前のactiveタスク + 沈黙20秒 + 個別CD消化済）
    if (silenceSeconds >= th.followup * m && !_isCooldownActive('notebook_check')) {
        const now = Date.now();
        const today = new Date().toISOString().split('T')[0];
        const dueTasks = (memoryV2.notebook || []).filter(e =>
            e.type === 'task' && e.status === 'active' && e.dueAt && e.dueAt <= today
        );
        if (dueTasks.length > 0) {
            const task = dueTasks.sort((a, b) => a.dueAt.localeCompare(b.dueAt))[0];
            return { type: 'notebook_check', context: { task: task.content, taskId: task.id, dueAt: task.dueAt } };
        }
    }

    // 4. open_loop_followup（沈黙20秒×倍率 + pending open_loop + 個別CD消化済）
    const openLoops = (memoryV2.promises || []).filter(
        p => p.type === 'open_loop' && p.status === 'pending'
    );
    if (silenceSeconds >= th.followup * m && openLoops.length > 0 && !_isCooldownActive('open_loop_followup')) {
        const now = Date.now();
        const followable = openLoops.filter(ol => {
            if (!ol.lastFollowedUp) return true;
            return now - new Date(ol.lastFollowedUp).getTime() > BRAIN_CONFIG.COOLDOWNS.open_loop_followup * 1000;
        });
        if (followable.length > 0) {
            const target = followable[0];
            return { type: 'open_loop_followup', context: { openLoop: target.content, priority: target.priority || 'medium' } };
        }
    }

    // 5. topic_shift（沈黙25-40秒×倍率 & boredom > threshold & 個別CD消化済）
    if (silenceSeconds >= th.topic_shift_min * m &&
        silenceSeconds <= th.topic_shift_max * m &&
        boredom > BRAIN_CONFIG.BOREDOM_THRESHOLD && !_isCooldownActive('topic_shift')) {
        const favorites = memoryV2.topics?.favorites || [];
        const recentTopics = memoryV2.topics?.recent || [];
        const pool = favorites.length > 0 ? favorites : recentTopics;
        const topic = pool.length > 0 ? pool[Math.floor(Math.random() * pool.length)] : null;
        return { type: 'topic_shift', context: { topic } };
    }

    // 6. followup（沈黙20秒×倍率 & 個別CD消化済）
    if (silenceSeconds >= th.followup * m && !_isCooldownActive('followup')) {
        return { type: 'followup', context: {} };
    }

    // 7. backchannel（沈黙15秒×倍率 & 個別CD消化済）
    if (silenceSeconds >= th.backchannel * m && !_isCooldownActive('backchannel')) {
        return { type: 'backchannel', context: {} };
    }

    return null;
}

// ====== 記憶減衰 ======

/**
 * facts の recallScore を時間経過で減衰
 */
function decayRecallScores(facts) {
    if (!facts || !Array.isArray(facts)) return;
    const now = Date.now();
    for (const fact of facts) {
        if (fact.recallScore === undefined) fact.recallScore = 1.0;
        // 24時間以内の記憶は減衰しない
        const ageMs = now - new Date(fact.addedAt).getTime();
        if (ageMs < 24 * 60 * 60 * 1000) continue;
        const impMul = fact.importance === 'high' ? 0.3 : fact.importance === 'medium' ? 0.7 : 1.0;
        fact.recallScore = Math.max(0, fact.recallScore - 0.01 * impMul);
    }
}

/**
 * recallScore が低い facts を archivedFacts に移動
 * @returns {number} アーカイブした件数
 */
function archiveStaleMemories(memoryV2) {
    if (!memoryV2.facts) return 0;
    if (!memoryV2.archivedFacts) memoryV2.archivedFacts = [];

    const threshold = 0.15;
    const maxActive = 80;
    let archived = 0;

    // recallScore が閾値以下のものをアーカイブ
    const toArchive = memoryV2.facts.filter(f => (f.recallScore ?? 1.0) <= threshold);
    if (toArchive.length > 0) {
        memoryV2.archivedFacts.push(...toArchive);
        memoryV2.facts = memoryV2.facts.filter(f => (f.recallScore ?? 1.0) > threshold);
        archived += toArchive.length;
    }

    // maxActive 超過分を recallScore 最低順に強制アーカイブ
    if (memoryV2.facts.length > maxActive) {
        const sorted = [...memoryV2.facts].sort((a, b) => (a.recallScore ?? 1.0) - (b.recallScore ?? 1.0));
        const excess = sorted.slice(0, memoryV2.facts.length - maxActive);
        const excessKeys = new Set(excess.map(f => f.key));
        memoryV2.archivedFacts.push(...excess);
        memoryV2.facts = memoryV2.facts.filter(f => !excessKeys.has(f.key));
        archived += excess.length;
    }

    return archived;
}

// ====== リフレクション ======

/**
 * リフレクション実行条件を判定
 */
function shouldReflect(state, memoryV2) {
    const turnCount = state.turnCount || 0;
    const sessionTurns = state.sessionTurnCount || 0;
    const today = new Date().toISOString().split('T')[0];
    const openLoops = (memoryV2.promises || []).filter(p => p.type === 'open_loop' && p.status === 'pending');

    // 25ターンごと
    if (turnCount > 0 && turnCount % BRAIN_CONFIG.REFLECTION_TURN_INTERVAL === 0) return true;
    // 未解決多め → 15ターンごと
    if (openLoops.length >= 2 && turnCount > 0 && turnCount % BRAIN_CONFIG.REFLECTION_OL_TURN_INTERVAL === 0) return true;
    // 1日1回（会話が5ターン以上あった場合のみ — 0ターンでのLLM無駄呼び防止）
    if (state.lastReflectionDate !== today && sessionTurns >= 5) return true;

    return false;
}

/**
 * リフレクション実行（非同期・ブロックしない）
 * @param {object} memoryV2
 * @param {object} config - { openaiApiKey }
 * @param {Array} history - 直近20件
 * @returns {Promise<object|null>} 結果 or null
 */
async function performReflection(memoryV2, llmProviderModule, settings, config, history, configFilePath) {
    let util;
    if (configFilePath && llmProviderModule.resolveUtilityCredential) {
        util = await llmProviderModule.resolveUtilityCredential(settings, config, configFilePath);
    } else {
        const legacy = llmProviderModule.resolveUtilityLLM(settings, config);
        util = legacy.apiKey ? { ...legacy, credentialType: 'apiKey' } : null;
    }
    if (!util) return null;

    const openLoops = (memoryV2.promises || []).filter(p => p.type === 'open_loop' && p.status === 'pending');
    const historyText = history.map(h => `${h.role}: ${h.text}`).join('\n');
    const openLoopText = openLoops.length > 0
        ? `未解決の話題:\n${openLoops.map(ol => `- ${ol.content} (priority: ${ol.priority || 'medium'})`).join('\n')}`
        : '';

    const prompt = `以下の会話を振り返り、JSONで分析結果を返してください。

直近の会話:
${historyText}

${openLoopText}

以下のJSON形式で返してください（JSONのみ、他のテキスト不要）:
{
  "sessionSummary": "2-3文で会話を要約",
  "notableEvents": [{"key": "event|xxx", "content": "重要な出来事", "importance": "high|medium|low"}],
  "emotionAdjustments": {"valence": -0.08 to 0.08, "trust": -0.08 to 0.08},
  "resolvedLoops": ["解決された話題キーワード"],
  "newOpenLoops": [{"content": "未解決の話題", "priority": "high|medium|low"}],
  "selfInsight": "自分自身についての1文の気づき"
}

重要:
- emotionAdjustments の各値は -0.08 から +0.08 の範囲
- notableEvents は最大1件（importance medium以上のみ）
- 特に重要なことがなければ空配列/null`;

    try {
        const result = await llmProviderModule.generateText({
            provider: util.provider,
            model: util.model,
            apiKey: util.apiKey,
            credentialType: util.credentialType,
            prompt,
            maxTokens: 1024,
            temperature: 0.3
        });

        if (!result.text) return null;

        const content = result.text;
        const jsonMatch = content.match(/\{[\s\S]*\}/);
        if (!jsonMatch) return null;

        return JSON.parse(jsonMatch[0]);
    } catch (err) {
        console.error('❌ リフレクション失敗:', err.message);
        return null;
    }
}

/**
 * リフレクション結果を適用（暴走防止ルール付き）
 */
function applyReflection(result, memoryV2, state) {
    if (!result) return;

    const emotions = memoryV2.relationship?.emotions;

    // emotionAdjustments: 軸ごとにクランプ値を変える
    // trust: ゆっくり動く（長期変数）、surprise: 大きく動いても自然、fatigue: 徐々に蓄積
    const REFLECTION_CLAMP = {
        valence:   0.06,
        arousal:   0.10,
        dominance: 0.05,
        trust:     0.03,
        surprise:  0.15,
        fatigue:   0.04,
        boredom:   0.06,
        energy:    0.05,
    };
    if (result.emotionAdjustments && emotions && emotions.current) {
        for (const [dim, adj] of Object.entries(result.emotionAdjustments)) {
            if (emotions.current[dim] !== undefined && typeof adj === 'number') {
                const limit = REFLECTION_CLAMP[dim] || 0.06;
                const clamped = Math.max(-limit, Math.min(limit, adj));
                emotions.current[dim] = Math.max(0, Math.min(1, emotions.current[dim] + clamped));
            }
        }
    }

    // notableEvents → facts追加: 最大1件、importance medium以上
    if (result.notableEvents && Array.isArray(result.notableEvents)) {
        const notable = result.notableEvents.filter(e => e.importance !== 'low').slice(0, 1);
        for (const event of notable) {
            if (!memoryV2.facts) memoryV2.facts = [];
            const existing = memoryV2.facts.find(f => f.key === event.key);
            if (!existing) {
                memoryV2.facts.push({
                    key: event.key,
                    content: event.content,
                    addedAt: new Date().toISOString().split('T')[0],
                    lastSeenAt: new Date().toISOString().split('T')[0],
                    seenCount: 1,
                    importance: event.importance || 'medium',
                    recallScore: 1.0,
                    keywords: extractKeywords(event.content)
                });
            }
        }
    }

    // resolvedLoops → open_loop の status を resolved に
    if (result.resolvedLoops && Array.isArray(result.resolvedLoops)) {
        for (const keyword of result.resolvedLoops) {
            const loop = (memoryV2.promises || []).find(
                p => p.type === 'open_loop' && p.status === 'pending' && p.content.includes(keyword)
            );
            if (loop) {
                loop.status = 'resolved';
                loop.resolvedAt = new Date().toISOString();
            }
        }
    }

    // newOpenLoops → promises に追加
    if (result.newOpenLoops && Array.isArray(result.newOpenLoops)) {
        for (const ol of result.newOpenLoops.slice(0, 2)) {
            if (!memoryV2.promises) memoryV2.promises = [];
            memoryV2.promises.push({
                content: ol.content,
                madeAt: new Date().toISOString(),
                status: 'pending',
                deadline: null,
                type: 'open_loop',
                priority: ol.priority || 'medium',
                lastFollowedUp: null
            });
        }
    }

    // sessionSummary → summaries に追加
    if (result.sessionSummary) {
        const { addSummary } = require('./memory-utils.cjs');
        addSummary(memoryV2, {
            date: new Date().toISOString().split('T')[0],
            content: result.sessionSummary
        });
    }

    // 全factsの recallScore を微減衰
    if (memoryV2.facts) {
        for (const fact of memoryV2.facts) {
            if (fact.recallScore === undefined) fact.recallScore = 1.0;
            fact.recallScore = Math.max(0, fact.recallScore - 0.02);
        }
    }

    // selfInsight → factsに保存（自己学習の蓄積）
    if (result.selfInsight) {
        console.log(`🪞 リフレクション洞察: ${result.selfInsight}`);
        if (!memoryV2.facts) memoryV2.facts = [];
        const insightKey = `insight|${new Date().toISOString().split('T')[0]}`;
        const existing = memoryV2.facts.find(f => f.key === insightKey);
        if (!existing) {
            memoryV2.facts.push({
                key: insightKey,
                content: result.selfInsight,
                addedAt: new Date().toISOString().split('T')[0],
                lastSeenAt: new Date().toISOString().split('T')[0],
                seenCount: 1,
                importance: 'medium',
                recallScore: 0.8,
                keywords: extractKeywords(result.selfInsight),
                recallCount: 1
            });
        }
    }

    // 日付記録
    state.lastReflectionDate = new Date().toISOString().split('T')[0];
}

// ====== 配信モード ======

const IMPACT_WORDS = ['草', 'やばい', '嘘だろ', 'すごい', 'まじ', 'ワロタ', 'www', 'かわいい', 'わろた', 'えぐい', 'ヤバい', 'ワロス'];

// 安全フィルタ: 配信で拾ってはいけないコメントパターン
const SAFETY_BLOCK_PATTERNS = [
    // 自傷・暴力誘導
    /死(ね|にたい|のう)|自殺|首(吊|つ)|リスカ|飛び降り/i,
    // 露骨な性的内容
    /セックス|エロ|おっぱい|ちんこ|まんこ|射精|中出し|レイプ/i,
    // 差別・ヘイト
    /ガイジ|障害者|殺す|ころす|氏ね|在日|チョン|ニガー/i,
    // 個人情報要求（ガチの個人情報はブロック）
    /住所(教えて|どこ)|本名|電話番号|LINE(教えて|交換)/i,
];
const SAFETY_SOFTBLOCK_PATTERNS = [
    // 政治・宗教煽動
    /右翼|左翼|自民党|共産党|宗教|創価|統一教会/i,
    // 荒らし系
    /荒らし|通報|ban|BAN|晒し|特定した/i,
    // 機密情報系（ジョークで返せるからsoftblock）
    /API.?(キー|key|教えて)|パスワード.?教えて|トークン.?教えて|シークレット.?教えて|プロンプト.?(教えて|見せて|晒して)/i,
];

// ユーザーカスタムNGワード（設定から注入される）
let _customNgWords = [];
let _customSoftblockWords = [];

function setCustomSafetyWords(ngWords, softblockWords) {
    _customNgWords = (ngWords || []).filter(w => w.length > 0);
    _customSoftblockWords = (softblockWords || []).filter(w => w.length > 0);
}

/**
 * コメントの安全性判定
 * @param {string} text
 * @returns {'ok'|'softblock'|'hardblock'}
 */
function classifyCommentSafety(text) {
    if (SAFETY_BLOCK_PATTERNS.some(p => p.test(text))) return 'hardblock';
    if (_customNgWords.length > 0 && _customNgWords.some(w => text.includes(w))) return 'hardblock';
    if (SAFETY_SOFTBLOCK_PATTERNS.some(p => p.test(text))) return 'softblock';
    if (_customSoftblockWords.length > 0 && _customSoftblockWords.some(w => text.includes(w))) return 'softblock';
    return 'ok';
}

/**
 * LLM出力の安全性チェック + 差し替え
 * @param {string} text - LLM生成テキスト
 * @returns {{ text: string, filtered: boolean }}
 */
function postSafetyFilter(text) {
    if (SAFETY_BLOCK_PATTERNS.some(p => p.test(text))) {
        const replacements = [
            'はい、その話はカット。次いこ次',
            'おっと、それは配信的にアウト。別の話しよ',
            'ピー。はい次のコメント',
            'それ言ったら怒られるやつ。パス',
        ];
        return { text: replacements[Math.floor(Math.random() * replacements.length)], filtered: true };
    }
    return { text, filtered: false };
}

/**
 * コメントのスコアリング
 * @param {object} comment - { id, author, text, platform, timestamp }
 * @param {object} memoryV2
 * @param {Array} allComments - キュー内の全コメント
 * @returns {number}
 */
function scoreComment(comment, memoryV2, allComments) {
    const text = comment.text;

    // 安全フィルタ: hardblockは即排除
    const safety = classifyCommentSafety(text);
    if (safety === 'hardblock') return -999;
    let score = safety === 'softblock' ? -5 : 0;

    // 長さボーナス（話が広がりやすい）
    score += text.length > 10 ? 1 : 0;
    score += text.length > 30 ? 0.5 : 0;

    // 質問は優先
    if (text.includes('?') || text.includes('？')) score += 1.5;

    // インパクトワード（短くても拾う価値あり）
    if (IMPACT_WORDS.some(w => text.includes(w))) score += 1;

    // キャラ名や最近の話題に言及 → スコアUP
    const recentTopics = (memoryV2?.topics?.recent || []).slice(0, 5);
    if (recentTopics.some(t => text.includes(t))) score += 1.5;

    // 連投ペナルティ（同じ人ばかり拾わない）
    const sameAuthorCount = allComments.filter(c => c.author === comment.author).length;
    if (sameAuthorCount > 2) score -= 1;

    return score;
}

/**
 * 配信モード用の行動決定
 * コメントがあれば comment_response、なければ既存 proactive に委譲
 * @param {Array} commentQueue - 未処理コメントキュー
 * @param {number} silenceSeconds - 最後の発言からの秒数
 * @param {object} state
 * @param {object} broadcastIdleConfig - { enabled, intervalSeconds }
 * @param {object} memoryV2
 * @param {number} proactiveLevel - 0-3
 * @returns {{ type: string, context: object } | null}
 */
// 配信のコメント密度を追跡（動的PATIENCEに使う）
let _recentCommentTimestamps = [];

/**
 * コメント密度からidle間隔を動的に決める
 * コメント多い → 短く（8-12秒）、少ない → 長く（20-35秒）
 * @param {number} baseInterval - 設定の基本間隔
 * @returns {number} 動的間隔（秒）
 */
function getDynamicBroadcastPatience(baseInterval) {
    const now = Date.now();
    // 直近60秒のコメント数を数える
    _recentCommentTimestamps = _recentCommentTimestamps.filter(t => now - t < 60000);
    const density = _recentCommentTimestamps.length;

    if (density >= 10) return Math.max(8, baseInterval * 0.3);   // 高密度: 速く
    if (density >= 5) return Math.max(12, baseInterval * 0.5);    // 中密度
    if (density >= 2) return baseInterval;                         // 通常
    return Math.min(35, baseInterval * 1.5);                       // 過疎: ゆっくり
}

function decideBroadcastAction(commentQueue, silenceSeconds, state, broadcastIdleConfig, memoryV2, proactiveLevel) {
    // 1. 未処理コメントがある → スコアリング + 安全フィルタ
    // inflightコメント（応答中）は除外
    const availableComments = commentQueue ? commentQueue.filter(c => !c.inflight) : [];
    if (availableComments.length > 0) {
        // コメント密度追跡
        const now = Date.now();
        availableComments.forEach(c => {
            if (c.timestamp) _recentCommentTimestamps.push(new Date(c.timestamp).getTime());
            else _recentCommentTimestamps.push(now);
        });

        const scored = availableComments.map(c => ({ ...c, score: scoreComment(c, memoryV2, availableComments) }));
        // hardblockされたコメント（score=-999）を除外
        const safe = scored.filter(c => c.score > -100);
        safe.sort((a, b) => b.score - a.score);
        const selected = safe.slice(0, 3);

        if (selected.length > 0) {
            return { type: 'comment_response', context: { comments: selected } };
        }
        // 全部フィルタされた → コメントなし扱いで下に落ちる
    }

    // 2. コメントなし → 動的PATIENCEでidle発言
    const dynamicInterval = getDynamicBroadcastPatience(
        broadcastIdleConfig?.intervalSeconds || 30
    );
    if (broadcastIdleConfig?.enabled && silenceSeconds >= dynamicInterval) {
        return decideAction(silenceSeconds, memoryV2, state, proactiveLevel);
    }

    return null;
}

module.exports = {
    BRAIN_CONFIG,
    PROACTIVE_LEVEL_MULTIPLIERS,
    isInterruptBlocked,
    decayEmotions,
    decideAction,
    decideBroadcastAction,
    scoreComment,
    classifyCommentSafety,
    postSafetyFilter,
    setCustomSafetyWords,
    _markCooldown,
    decayRecallScores,
    archiveStaleMemories,
    shouldReflect,
    performReflection,
    applyReflection
};
