'use strict';

const { determineExpression } = require('./ipc-memory-apply.cjs');

let _ctx = null;
let brainTickTimer = null;
let _lastBrainTickAt = Date.now();
let _lastEmotionSaveAt = Date.now();
let _lastRecallDecayAt = Date.now();
let _isReflecting = false;

function stopBrainTick() {
    if (brainTickTimer) {
        clearInterval(brainTickTimer);
        brainTickTimer = null;
    }
}

function startBrainTick(settings) {
    const { brain, CONFIG } = _ctx;

    stopBrainTick();

    // 起動後のプロアクティブ（初回挨拶）
    if (settings.proactive.onStartup) {
        setTimeout(async () => {
            const state = await _ctx.loadStateCached();
            const today = new Date().toISOString().split('T')[0];
            if (state.lastProactiveDate !== today) {
                triggerProactiveAction('startup', {});
                state.lastProactiveDate = today;
                _ctx.markDirty('state');
            }
        }, CONFIG.PROACTIVE_STARTUP_DELAY_MS);
    }

    // 1秒ごとの brainTick
    brainTickTimer = setInterval(async () => {
        try {
            await brainTick();
        } catch (err) {
            console.error('❌ brainTick error:', err.message);
        }
    }, brain.BRAIN_CONFIG.TICK_INTERVAL_MS);
}

async function brainTick() {
    const {
        loadStateCached, loadMemoryV2Cached, loadSettings, loadConfig, loadHistory,
        brain, safeSend, markDirty, transientState,
        getSettingsCache, getBroadcastQueue, setBroadcastQueue,
        llmProvider,
    } = _ctx;
    const { DEFAULT_SETTINGS, CONFIG_FILE } = _ctx.constants;

    const now = Date.now();
    const elapsedMs = now - _lastBrainTickAt;
    _lastBrainTickAt = now;

    // 1. state/memoryV2 をキャッシュから取得
    const state = await loadStateCached();
    const memoryV2 = await loadMemoryV2Cached();

    // 2. decayEmotions
    if (memoryV2.relationship?.emotions) {
        brain.decayEmotions(memoryV2.relationship.emotions, elapsedMs);
    }

    // 3. 表情更新
    if (memoryV2.relationship?.emotions?.current) {
        const emotions = memoryV2.relationship.emotions;
        const lastExpression = emotions.lastExpression || 'neutral';
        const lastExpressionTime = emotions.lastExpressionTime || 0;
        const expression = determineExpression(emotions.current, lastExpression, lastExpressionTime);

        if (expression !== lastExpression) {
            emotions.lastExpression = expression;
            emotions.lastExpressionTime = Date.now();
            safeSend(_ctx.characterWindow, 'expression-change', expression);

            // VRChat: 表情パラメータ同期
            const vrchatSettings = _ctx.getSettingsCache()?.vrchat;
            if (vrchatSettings?.enabled && vrchatSettings?.expressionSync) {
                const oscClient = require('./osc-client.cjs');
                const paramName = (vrchatSettings.expressionMap || {})[expression] || '';
                oscClient.sendExpressionParameter(paramName, vrchatSettings.expressionParamType || 'bool');
            }
        }
    }

    // 4. 設定・モード判定
    const settings = getSettingsCache() || DEFAULT_SETTINGS;
    const proactiveLevel = settings.persona?.proactiveFrequency ?? 1;
    const isBroadcast = settings.streaming?.broadcastMode && settings.streaming?.enabled;

    // 配信モード: カスタムNGワードをbrainに反映
    if (isBroadcast && settings.streaming?.safety) {
        brain.setCustomSafetyWords(
            settings.streaming.safety.customNgWords,
            settings.streaming.safety.customSoftblockWords
        );
    }

    // おやすみモード設定をtransientStateに反映
    if (settings.proactive?.quietHoursEnabled) {
        transientState.quietHoursStart = settings.proactive.quietHoursStart ?? 23;
        transientState.quietHoursEnd = settings.proactive.quietHoursEnd ?? 7;
    } else {
        // 無効時は絶対にブロックされない値（start===end）を設定
        transientState.quietHoursStart = undefined;
        transientState.quietHoursEnd = undefined;
    }

    // 5. 沈黙時間計算
    const lastMsgTime = state.lastMessageAt ? new Date(state.lastMessageAt).getTime() :
                         state.lastActiveAt ? new Date(state.lastActiveAt).getTime() : now;
    const silenceSeconds = (now - lastMsgTime) / 1000;

    // 6. 行動決定
    let action = null;

    if (isBroadcast) {
        if (transientState.isLLMStreaming || transientState.doNotDisturb) return;

        const broadcastQueue = getBroadcastQueue();
        action = brain.decideBroadcastAction(
            broadcastQueue, silenceSeconds, state,
            settings.streaming.broadcastIdle || { enabled: true, intervalSeconds: 30 },
            memoryV2, proactiveLevel
        );

        if (action && action.type === 'comment_response' && action.context?.comments) {
            // コメントを即削除せず、inflightフラグを付けて次のtickで選ばれないようにする
            // 応答完了後にrendererからack（broadcast:comment-done）で削除される
            const selectedIds = new Set(action.context.comments.map(c => c.id));
            setBroadcastQueue(broadcastQueue.map(c =>
                selectedIds.has(c.id) ? { ...c, inflight: true } : c
            ));
        }
    } else {
        const chatWindow = _ctx.chatWindow;
        if (brain.isInterruptBlocked(transientState, state, chatWindow, proactiveLevel)) return;
        action = brain.decideAction(silenceSeconds, memoryV2, state, proactiveLevel);
    }

    if (action) {
        brain._markCooldown(action.type);
        brain._markCooldown('_global');
        transientState.lastBrainSpokeAt = now;
        state.lastBrainAction = { type: action.type, at: now };

        if (action.type === 'open_loop_followup' && action.context?.openLoop) {
            const loop = (memoryV2.promises || []).find(
                p => p.type === 'open_loop' && p.status === 'pending' && p.content === action.context.openLoop
            );
            if (loop) loop.lastFollowedUp = new Date().toISOString();
        }

        if (action.type === 'notebook_check' && action.context?.taskId) {
            const task = (memoryV2.notebook || []).find(e => e.id === action.context.taskId);
            if (task) {
                task.updatedAt = new Date().toISOString();
                markDirty('memory');
            }
        }

        console.log(`🧠 brainAction: ${action.type}`, action.context || '');
        triggerProactiveAction(action.type, action.context || {});
        markDirty('state');
    }

    // 7. 感情保存（30秒間隔）
    if (now - _lastEmotionSaveAt > brain.BRAIN_CONFIG.EMOTION_SAVE_INTERVAL_MS) {
        _lastEmotionSaveAt = now;
        markDirty('memory');
    }

    // 8. 記憶減衰（60秒間隔）
    if (now - _lastRecallDecayAt > brain.BRAIN_CONFIG.RECALL_DECAY_INTERVAL_MS) {
        _lastRecallDecayAt = now;
        brain.decayRecallScores(memoryV2.facts);
        const archived = brain.archiveStaleMemories(memoryV2);
        if (archived > 0) {
            console.log(`📦 ${archived}件の記憶をアーカイブ`);
            markDirty('memory');
        }
    }

    // 9. リフレクション判定（_isReflectingガードで重複実行防止）
    if (!_isReflecting && brain.shouldReflect(state, memoryV2)) {
        _isReflecting = true;
        // 日付を即座にマーク（次tickでの重複発火防止）
        state.lastReflectionDate = new Date().toISOString().split('T')[0];
        markDirty('state');
        const config = await loadConfig();
        const history = await loadHistory(20);
        setImmediate(async () => {
            try {
                const settings = await loadSettings();
                const result = await brain.performReflection(memoryV2, llmProvider, settings, config, history, CONFIG_FILE);
                if (result) {
                    brain.applyReflection(result, memoryV2, state);
                    markDirty('both');
                    console.log('🪞 リフレクション完了:', result.sessionSummary);
                    safeSend(_ctx.chatWindow, 'reflection-complete', {
                        summary: result.sessionSummary || '',
                        insight: result.selfInsight || ''
                    });
                }
            } catch (err) {
                console.error('❌ リフレクション失敗:', err.message);
            } finally {
                _isReflecting = false;
            }
        });
    }
}

async function triggerProactiveAction(actionType, actionContext = {}) {
    const { loadHistory, loadMemoryV2Cached, loadStateCached, safeSend } = _ctx;
    const chatWindow = _ctx.chatWindow;
    if (!chatWindow) return;

    try {
        const history = await loadHistory(5);
        const lastUserMessage = history.filter(h => h.role === 'user').pop()?.text || '';
        const lastAssistantMessage = history.filter(h => h.role === 'assistant').pop()?.text || '';

        const hour = new Date().getHours();
        let timeOfDay = 'morning';
        if (hour >= 12 && hour < 17) timeOfDay = 'afternoon';
        else if (hour >= 17 && hour < 21) timeOfDay = 'evening';
        else if (hour >= 21 || hour < 6) timeOfDay = 'night';

        const memoryV2 = await loadMemoryV2Cached();
        const state = await loadStateCached();

        const lastMsgTime = state.lastMessageAt ? new Date(state.lastMessageAt).getTime() : Date.now();
        const minutesSinceLastChat = Math.floor((Date.now() - lastMsgTime) / 60000);

        const context = {
            timeOfDay,
            lastUserMessage,
            lastAssistantMessage,
            minutesSinceLastChat,
            idleMinutes: minutesSinceLastChat,
            recentTopics: memoryV2.topics?.recent || [],
            actionType,
            actionContext
        };

        if (chatWindow && !chatWindow.isDestroyed()) chatWindow.show();
        safeSend(chatWindow, 'proactive-trigger', { trigger: actionType, context });
    } catch (err) {
        console.error('❌ プロアクティブトリガー失敗:', err);
    }
}

function init(ctx) {
    _ctx = ctx;
}

module.exports = { init, startBrainTick, stopBrainTick, brainTickTimer: () => brainTickTimer };
