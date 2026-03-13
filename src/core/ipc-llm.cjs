'use strict';

const fs = require('fs').promises;
const { tokenize, extractKeywords, computeRelevance, buildDocFrequency, computeRetention, computeFinalScore, buildBm25Index, bm25SearchFacts, computeHybridScore, buildSummaryBm25Index, bm25SearchSummaries } = require('./memory-search.cjs');
const { searchFacts: vectorSearchFacts, searchSummaries: vectorSearchSummaries, warmup: vectorWarmup } = require('./memory-vector.cjs');
const claudeBridge = require('./claude-bridge.cjs');
const { summarizeOldMessages } = require('./context-summary.cjs');

let _isSummarizing = false;
let _vectorWarmedUp = false;

// BM25インデックスキャッシュ（factsが変わった時だけ再構築）
let _bm25Index = null;
let _bm25IndexCacheKey = ''; // "${rev}_${allFacts.length}" で突き合わせる（archivedFacts変化にも対応）

// summaries BM25インデックスキャッシュ
let _summaryBm25Index = null;
let _summaryBm25Rev = -1;

let _ctx = null;

// CONFIG_UPDATE タグの検出・処理
async function processConfigUpdate(text, selfGrowthConfig) {
    const {
        loadProfile, loadPersonality, loadUser, loadSettings,
        constants, setSettingsCache, safeSend,
    } = _ctx;
    const {
        USER_FILE, SETTINGS_FILE, DEFAULT_SETTINGS, CONFIG_FILE,
        getFilePaths,
    } = constants;

    const regex = /<!--CONFIG_UPDATE:(.*?)-->/g;
    let match;

    while ((match = regex.exec(text)) !== null) {
        try {
            const updateData = JSON.parse(match[1]);
            console.log('🔧 設定変更検出:', updateData);

            const { target, changes } = updateData;
            let summary = '';

            if (target === 'profile') {
                const profile = await loadProfile();
                Object.assign(profile, changes);
                await fs.writeFile(getFilePaths().PROFILE_FILE, JSON.stringify(profile, null, 2), 'utf-8');
                console.log('✅ profile.json 更新:', changes);
                if (changes.companionName) summary = `名前を「${changes.companionName}」に変更しました`;
                else if (changes.callUser) summary = `呼び方を「${changes.callUser}」に変更しました`;
                else summary = 'プロフィールを更新しました';
            } else if (target === 'personality') {
                // selfGrowthがOFFならpersonality変更を全スキップ
                const sg = selfGrowthConfig || {};
                if (sg.enabled === false) {
                    console.log('⚠️ selfGrowth無効: personality変更をスキップ');
                    continue;
                }

                const personality = await loadPersonality();
                const { coreIdentity: _ignored, ...safeChanges } = changes;
                if (_ignored) console.log('⚠️ coreIdentity の変更はブロックされました');
                if (sg.allowTraits === false) delete safeChanges.traits;
                if (sg.allowSpeechStyle === false) delete safeChanges.speechStyle;
                if (sg.allowReactions === false) { delete safeChanges.reactions; delete safeChanges.exampleConversation; }

                if (Object.keys(safeChanges).length === 0) {
                    console.log('⚠️ selfGrowthフィルターにより全変更がブロックされました');
                    continue;
                }

                // 確認モード: 変更を保留して通知
                if (sg.requireConfirmation) {
                    const chatWindow = _ctx.chatWindow;
                    if (chatWindow) {
                        chatWindow.webContents.send('self-growth-pending', {
                            changes: safeChanges,
                            originalPersonality: { ...personality }
                        });
                    }
                    console.log('🔔 selfGrowth確認待ち:', safeChanges);
                    continue;
                }

                Object.assign(personality, safeChanges);
                await fs.writeFile(getFilePaths().PERSONALITY_FILE, JSON.stringify(personality, null, 2), 'utf-8');
                console.log('✅ personality.json 更新:', safeChanges);
                if (changes.traits) summary = '性格を更新しました';
                else if (changes.speechStyle) summary = '話し方を更新しました';
                else summary = '性格設定を更新しました';
            } else if (target === 'user') {
                const user = await loadUser();
                Object.assign(user, changes);
                user.updatedAt = new Date().toISOString();
                await fs.writeFile(USER_FILE, JSON.stringify(user, null, 2), 'utf-8');
                console.log('✅ user.json 更新:', changes);
                if (changes.name) summary = `ユーザー名を「${changes.name}」に変更しました`;
                else summary = 'ユーザー情報を更新しました';
            } else if (target === 'proactive') {
                const settings = await loadSettings();
                if (!settings.proactive) settings.proactive = { ...DEFAULT_SETTINGS.proactive };
                if (typeof changes.enabled === 'boolean') settings.proactive.enabled = changes.enabled;
                if (typeof changes.idleMinutes === 'number' && changes.idleMinutes >= 1) settings.proactive.idleMinutes = changes.idleMinutes;
                if (typeof changes.idleChance === 'number' && changes.idleChance >= 0 && changes.idleChance <= 1) settings.proactive.idleChance = changes.idleChance;
                if (typeof changes.afterChatMinutes === 'number' && changes.afterChatMinutes >= 1) settings.proactive.afterChatMinutes = changes.afterChatMinutes;
                if (typeof changes.afterChatChance === 'number' && changes.afterChatChance >= 0 && changes.afterChatChance <= 1) settings.proactive.afterChatChance = changes.afterChatChance;
                setSettingsCache(settings);
                await fs.writeFile(SETTINGS_FILE, JSON.stringify(settings, null, 2), 'utf-8');
                console.log('✅ proactive設定 更新:', changes);
                summary = '自動会話の設定を調整しました';
            }

            const chatWindow = _ctx.chatWindow;
            if (summary && chatWindow) {
                chatWindow.webContents.send('config-updated', { target, summary });
            }
        } catch (err) {
            console.error('❌ CONFIG_UPDATE パース失敗:', err);
        }
    }
}

// NOTEBOOK タグの検出・処理
async function processNotebookOps(text) {
    const { loadMemoryV2Cached, setMemoryV2Cache, markDirty } = _ctx;

    const regex = /<!--NOTEBOOK:(ADD|DONE|DROP):(\{.*?\})-->/g;
    let match;

    while ((match = regex.exec(text)) !== null) {
        try {
            const op = match[1];
            const data = JSON.parse(match[2]);
            const memoryV2 = await loadMemoryV2Cached();
            if (!memoryV2.notebook) memoryV2.notebook = [];
            const now = new Date().toISOString();

            if (op === 'ADD') {
                const entry = {
                    id: `nb_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
                    type: data.type || 'note',
                    content: data.content || '',
                    createdAt: now,
                    updatedAt: now,
                    tags: data.tags || []
                };
                if (data.type === 'task') {
                    entry.status = data.status || 'active';
                    entry.priority = data.priority || 'normal';
                    if (data.dueAt) entry.dueAt = data.dueAt;
                }
                memoryV2.notebook.push(entry);
                setMemoryV2Cache(memoryV2);
                markDirty('memory');
                console.log(`📓 notebook ADD: [${entry.type}] ${entry.content.slice(0, 40)}`);
            } else if (op === 'DONE' || op === 'DROP') {
                const status = op === 'DONE' ? 'done' : 'dropped';
                const entry = memoryV2.notebook.find(e => e.id === data.id);
                if (entry) {
                    entry.status = status;
                    entry.updatedAt = now;
                    setMemoryV2Cache(memoryV2);
                    markDirty('memory');
                    console.log(`📓 notebook ${op}: ${entry.id}`);
                }
            }
        } catch (err) {
            console.error('❌ NOTEBOOK タグ処理失敗:', err);
        }
    }
}

function register(ipcMain, ctx) {
    _ctx = ctx;
    const {
        loadConfig, loadSettings, loadProfile, loadPersonality,
        loadMemoryV2Cached, loadStateCached, setMemoryV2Cache, markDirty,
        transientState, forwardSubtitle, clearSubtitleAfterDelay,
        llmProvider, constants,
        buildSystemPrompt, buildBroadcastSystemPrompt, buildProactiveSystemPrompt, buildStateMessage,
        getSettingsCache,
    } = ctx;
    const {
        DEFAULT_MEMORY_V2, DEFAULT_SETTINGS, CONFIG_FILE, getFilePaths,
    } = constants;

    ipcMain.handle('claude-code:reset-session', () => {
        claudeBridge.resetSession();
        return { ok: true };
    });

    ipcMain.on('llm:stream', async (event, payload) => {
        const { messages, isProactive, useOpenClaw, useClaudeCode } = payload;

        // main process側でもストリーミング状態を追跡
        transientState.isLLMStreaming = true;
        transientState.doNotDisturb = true;

        const settings = await loadSettings();

        // Claude Codeルート: このCLI（カイト）に繋ぐ
        if (useClaudeCode) {
            const lastUser = [...messages].reverse().find(m => m.role === 'user');
            if (!lastUser) {
                event.sender.send('llm:error', 'メッセージが空です');
                transientState.isLLMStreaming = false;
                return;
            }
            const prompt = typeof lastUser.content === 'string'
                ? lastUser.content
                : Array.isArray(lastUser.content)
                    ? lastUser.content.filter(c => c.type === 'text').map(c => c.text).join('\n')
                    : String(lastUser.content);
            try {
                await claudeBridge.call(prompt, (chunk) => {
                    event.sender.send('llm:delta', chunk);
                });
                event.sender.send('llm:done');
            } catch (err) {
                console.error('[claude-bridge] エラー:', err);
                event.sender.send('llm:error', err.message);
            } finally {
                transientState.isLLMStreaming = false;
            }
            return;
        }

        // OpenClawルート
        if (useOpenClaw) {
            const oc = settings.openclaw || {};
            if (!oc.enabled) {
                event.sender.send('llm:error', 'OpenClawが有効になっていません。設定画面で有効化してください。');
                transientState.isLLMStreaming = false;
                return;
            }
            const historyLimit = settings.limits.historyTurns;
            const recentMessages = messages.slice(-historyLimit);
            try {
                const { streamOpenClaw } = require('./ipc-openclaw.cjs');
                await streamOpenClaw(event, oc, recentMessages);
            } catch (err) {
                console.error('OpenClaw stream error:', err);
                event.sender.send('llm:error', err.message);
            } finally {
                transientState.isLLMStreaming = false;
            }
            return;
        }

        const config = await loadConfig();
        const provider = settings.llm.provider || 'claude';

        if (provider === 'openai' && !config.openaiApiKey) {
            event.sender.send('llm:error', 'OpenAI APIキーが設定されていません');
            return;
        }
        if (provider === 'claude' && !process.env.ANTHROPIC_API_KEY) {
            event.sender.send('llm:error', 'ANTHROPIC_API_KEY環境変数が設定されていません');
            return;
        }

        const historyLimit = settings.limits.historyTurns;
        const profile = await loadProfile();
        const personality = await loadPersonality();
        console.log(`🎭 Personality loaded: traits=[${personality.traits?.join(', ')}], speechStyle=[${personality.speechStyle?.join(', ')}]`);
        const currentState = await loadStateCached();

        const memoryV2 = await loadMemoryV2Cached();
        const policy = memoryV2.contextPolicy || DEFAULT_MEMORY_V2.contextPolicy;

        // ハイブリッド記憶検索（BM25 + Vector + RRF）
        const recentUserTexts = messages
            .filter(m => m.role === 'user')
            .slice(-3)
            .map(m => typeof m.content === 'string' ? m.content : '')
            .join(' ');

        // 全 facts (active + archived) を検索対象にする
        const activeFacts = memoryV2.facts || [];
        const archivedFacts = memoryV2.archivedFacts || [];
        const allFacts = [...activeFacts, ...archivedFacts];

        // keywords が未設定の fact をマイグレーション
        let needsPersist = false;
        for (const f of allFacts) {
            if (!f.keywords) {
                f.keywords = extractKeywords(f.content);
                needsPersist = true;
            }
        }

        const now = Date.now();
        const useVector = settings.memory?.vectorSearchEnabled;

        // BM25検索（常時）— factsが変わった時だけインデックス再構築
        // archivedFacts変化時はrevがインクリメントされない場合があるため allFacts.length も加える
        const currentRev = memoryV2.rev ?? 0;
        const cacheKey = `${currentRev}_${allFacts.length}`;
        if (!_bm25Index || _bm25IndexCacheKey !== cacheKey) {
            _bm25Index = buildBm25Index(allFacts);
            _bm25IndexCacheKey = cacheKey;
        }
        const bm25Results = bm25SearchFacts(_bm25Index, recentUserTexts, allFacts, 50);
        const bm25RankMap = new Map(bm25Results.map(r => [r.fact.key, r.bm25Rank]));

        // ベクター検索（設定ON時のみ）
        const vectorRankMap = new Map();
        if (useVector && recentUserTexts.trim()) {
            if (!_vectorWarmedUp) {
                _vectorWarmedUp = true;
                vectorWarmup(allFacts).catch(() => {});
            }
            try {
                const vectorResults = await vectorSearchFacts(recentUserTexts, allFacts, 50);
                for (const { fact, vectorRank } of vectorResults) {
                    vectorRankMap.set(fact.key, vectorRank);
                }
                console.log('[memory-hybrid] ベクター検索完了');
            } catch (e) {
                console.warn('[memory-hybrid] ベクター検索失敗（BM25のみ使用）:', e.message);
            }
        }

        // summaries検索（BM25 + Vector）
        const allSummaries = memoryV2.summaries || [];
        const relevantSummaries = [];
        if (allSummaries.length > 0 && recentUserTexts.trim()) {
            // BM25（summaries件数が変わった時も再構築）
            const summaryCacheKey = `${currentRev}_${allSummaries.length}`;
            if (!_summaryBm25Index || _summaryBm25Rev !== summaryCacheKey) {
                _summaryBm25Index = buildSummaryBm25Index(allSummaries);
                _summaryBm25Rev = summaryCacheKey;
            }
            const summaryBm25Results = bm25SearchSummaries(_summaryBm25Index, recentUserTexts, allSummaries, 5);

            // Vector（設定ON時のみ）
            let summaryVectorResults = [];
            if (useVector) {
                try {
                    summaryVectorResults = await vectorSearchSummaries(recentUserTexts, allSummaries, 3);
                } catch (e) {}
            }

            // BM25またはVectorでヒットしたものを収集（重複除去）
            const seen = new Set();
            for (const r of [...summaryBm25Results, ...summaryVectorResults]) {
                const s = r.summary;
                if (!seen.has(s)) {
                    seen.add(s);
                    relevantSummaries.push(s);
                }
            }
        }

        // ハイブリッドスコアリング
        const scored = allFacts.map(f => {
            const bm25Rank = bm25RankMap.get(f.key) ?? Infinity;
            const vectorRank = useVector ? (vectorRankMap.get(f.key) ?? Infinity) : Infinity;
            const score = computeHybridScore(f, bm25Rank, vectorRank, now);
            return { fact: f, score, _isArchived: archivedFacts.includes(f) };
        });

        scored.sort((a, b) => b.score - a.score);

        // archived fact でスコアが高いものを active に復活（最大3件/回）
        let revived = 0;
        for (const s of scored) {
            if (revived >= 3) break;
            if (s._isArchived && s.score >= 2.5) {
                s.fact.recallScore = 0.5;
                s.fact.lastSeenAt = new Date().toISOString().split('T')[0];
                memoryV2.facts = memoryV2.facts || [];
                memoryV2.facts.push(s.fact);
                memoryV2.archivedFacts = memoryV2.archivedFacts.filter(f => f !== s.fact);
                s._isArchived = false;
                revived++;
                console.log(`🔄 記憶復活: "${s.fact.key}" (score=${s.score.toFixed(2)})`);
            }
        }

        // 復活 or keywords マイグレーションがあったら永続化
        if (revived > 0 || needsPersist) {
            setMemoryV2Cache(memoryV2);
            markDirty('memory');
        }

        const sortedFacts = scored
            .slice(0, policy.maxFacts)
            .map(s => {
                const { keywords, ...rest } = s.fact;
                return rest;
            });

        const memoryContext = {
            facts: sortedFacts,
            summaries: relevantSummaries.length > 0
                ? relevantSummaries.slice(0, policy.maxSummaries)
                : (memoryV2.summaries || []).slice(-policy.maxSummaries),
            topics: (memoryV2.topics?.recent || []).slice(0, policy.maxTopics),
            promises: (memoryV2.promises || []).filter(p => p.status === 'pending').slice(0, policy.maxPromises),
            relationship: memoryV2.relationship || DEFAULT_MEMORY_V2.relationship,
            impressions: memoryV2.impressions || { ofUser: [], fromUser: [] },
            avoidedTopics: memoryV2.topics?.avoided || [],
            notebook: memoryV2.notebook || []
        };

        const recentMessages = messages.slice(-historyLimit);

        // 会話が historyLimit の80%に達したら古い部分を要約（バックグラウンド）
        const summarizeThreshold = Math.floor(historyLimit * 0.8);
        const summarizeChunk = Math.floor(historyLimit * 0.5); // 最初の50%を要約
        if (!_isSummarizing && messages.length >= summarizeThreshold) {
            _isSummarizing = true;
            (async () => {
                try {
                    const config = await loadConfig();
                    const util = await llmProvider.resolveUtilityCredential(settings, config, CONFIG_FILE);
                    if (!util) return;
                    const oldMessages = messages.slice(0, summarizeChunk);
                    const fromTurn = 0;
                    const summary = await summarizeOldMessages(oldMessages, llmProvider, util, fromTurn);
                    if (!summary) return;
                    const memV2 = await loadMemoryV2Cached();
                    const { addSummary } = require('./memory-utils.cjs');
                    addSummary(memV2, summary);
                    setMemoryV2Cache(memV2);
                    markDirty('memory');
                    console.log('[context-summary] 要約完了:', summary.content.slice(0, 60) + '...');
                } catch (err) {
                    console.error('[context-summary] トリガーエラー:', err.message);
                } finally {
                    _isSummarizing = false;
                }
            })();
        }

        // 古い履歴ログ（loadHistoryキャッシュ経由）
        let olderConversationLog = '';
        if (!isProactive) {
            try {
                const extendedLimit = Math.min(historyLimit * 3, 60);
                const allHistory = ctx.loadHistory ? await ctx.loadHistory(extendedLimit) : [];
                const olderHistory = allHistory.slice(0, Math.max(0, allHistory.length - recentMessages.length));
                if (olderHistory.length > 0) {
                    olderConversationLog = olderHistory.map(h => {
                        const text = (h.text || '').slice(0, 100);
                        return `${h.role === 'user' ? 'ユーザー' : 'あなた'}: ${text}`;
                    }).join('\n');
                }
            } catch (e) { /* 無視 */ }
        }

        // システムプロンプト構築
        const currentSettings = getSettingsCache() || DEFAULT_SETTINGS;
        const isBroadcastMode = currentSettings.streaming?.broadcastMode && currentSettings.streaming?.enabled;
        const lang = settings?.language === 'en' ? 'en' : 'ja';
        let systemPrompt;
        let messagesWithContext;
        if (isProactive && isBroadcastMode && payload.context?.comments) {
            const comments = payload.context.comments || [];
            const commentContext = comments.length > 0
                ? comments.map(c => `${c.author}: ${c.text}`).join('\n')
                : '（コメントなし — 自由に話す）';
            systemPrompt = buildBroadcastSystemPrompt(profile, personality, memoryV2, currentState, commentContext, currentSettings);
            // broadcast用 stateMessage（memoryV2をmemoryContextとして使用）
            const broadcastMemoryContext = {
                facts: (memoryV2.facts || []).slice(0, 10),
                summaries: (memoryV2.summaries || []).slice(-5),
                topics: (memoryV2.topics?.recent || []).slice(0, 5),
                promises: (memoryV2.promises || []).filter(p => p.status === 'pending').slice(0, 3),
                relationship: memoryV2.relationship || {},
                impressions: memoryV2.impressions || { ofUser: [], fromUser: [] },
                avoidedTopics: memoryV2.topics?.avoided || [],
                notebook: memoryV2.notebook || []
            };
            const stateMsg = buildStateMessage(broadcastMemoryContext, currentState, '', lang);
            messagesWithContext = stateMsg
                ? [{ role: 'user', content: stateMsg }, { role: 'assistant', content: '.' }, ...recentMessages]
                : recentMessages;
        } else if (isProactive) {
            systemPrompt = buildProactiveSystemPrompt(profile, personality, memoryV2, payload.context, currentSettings);
            // proactive用 stateMessage
            const proactiveMemoryContext = {
                facts: (memoryV2.facts || []).slice(0, 10),
                summaries: (memoryV2.summaries || []).slice(-5),
                topics: (memoryV2.topics?.recent || []).slice(0, 5),
                promises: (memoryV2.promises || []).filter(p => p.status === 'pending').slice(0, 3),
                relationship: memoryV2.relationship || {},
                impressions: memoryV2.impressions || { ofUser: [], fromUser: [] },
                avoidedTopics: memoryV2.topics?.avoided || [],
                notebook: memoryV2.notebook || []
            };
            const stateMsg = buildStateMessage(proactiveMemoryContext, {}, '', lang);
            // proactiveはrecentMessagesが空や少ない可能性があるため、stateMessageのみ先頭に差し込む
            messagesWithContext = stateMsg
                ? [{ role: 'user', content: stateMsg }, { role: 'assistant', content: '.' }, ...recentMessages]
                : recentMessages;
        } else {
            const styleParams = transientState.styleParams || null;
            systemPrompt = buildSystemPrompt(profile, personality, memoryContext, currentState, olderConversationLog, styleParams, settings);

            // VRChat音声キャプチャがあればsystem promptに追記
            if (payload.context?.vrchatConversation) {
                systemPrompt += `\n\n[VRChat音声キャプチャ]\n以下はVRChat内で聞こえた他プレイヤーの会話です。あなたに直接話しかけているわけではありません。面白い部分や気になる部分があれば短くコメントしてください。特に言うことがなければ「（聞いてる）」とだけ返してください。\n${payload.context.vrchatConversation}`;
            }

            // 通常会話: stateMessageをuserロール先頭に差し込む（olderConversationLogは除外——recentMessagesに含まれるため）
            const stateMsg = buildStateMessage(memoryContext, currentState, '', lang);
            messagesWithContext = stateMsg
                ? [{ role: 'user', content: stateMsg }, { role: 'assistant', content: '.' }, ...recentMessages]
                : recentMessages;
        }

        try {
            const credential = await llmProvider.resolveCredential(provider, config, CONFIG_FILE);
            if (!credential) {
                event.sender.send('llm:error', `${provider} のAPIキーが設定されていません`);
                return;
            }
            let fullResponse = '';
            const model = settings.llm.model;
            const maxTokens = settings.llm.maxTokens || 512;

            console.log(`🔧 LLM stream: provider=${provider}, model=${model}, max_tokens=${maxTokens}, auth=${credential.type}`);

            const stream = llmProvider.streamChat({
                provider,
                model,
                apiKey: credential.value,
                credentialType: credential.type,
                systemPrompt,
                messages: messagesWithContext,
                maxTokens,
                temperature: 0.9
            });

            for await (const delta of stream) {
                fullResponse += delta;
                event.sender.send('llm:delta', delta);
                if (settings.streaming?.enabled && settings.streaming?.subtitle?.enabled) {
                    forwardSubtitle(delta);
                }
                // VRオーバーレイにもストリーミング転送
                const vrWin = ctx.vrOverlayWindow;
                if (vrWin && !vrWin.isDestroyed()) {
                    vrWin.webContents.send('vr-overlay:delta', delta);
                }
            }

            // 配信モード: 出力安全フィルタ
            if (isBroadcastMode) {
                const brain = ctx.brain || require('./brain.cjs');
                const safetyResult = brain.postSafetyFilter(fullResponse);
                if (safetyResult.filtered) {
                    console.log(`🛡️ 配信安全フィルタ発動: "${fullResponse.substring(0, 50)}..." → "${safetyResult.text}"`);
                    fullResponse = safetyResult.text;
                    // 差し替えテキストを送信（既にストリームで送った分は上書きできないが、doneイベントで最終テキストを送る）
                    event.sender.send('llm:safety-replace', safetyResult.text);
                }
            }

            // 配信モード中はCONFIG_UPDATE無効
            if (!isBroadcastMode) {
                await processConfigUpdate(fullResponse, settings.selfGrowth);
            }
            await processNotebookOps(fullResponse);

            // VRChat: チャットボックスに発言を送信
            if (settings.vrchat?.enabled && settings.vrchat?.chatbox?.enabled) {
                const oscClient = require('./osc-client.cjs');
                oscClient.sendChatbox(fullResponse, true, settings.vrchat.chatbox.playSound || false);
            }

            event.sender.send('llm:done');
            // VRオーバーレイにもdone通知
            const vrWinDone = ctx.vrOverlayWindow;
            if (vrWinDone && !vrWinDone.isDestroyed()) {
                vrWinDone.webContents.send('vr-overlay:done');
            }
            if (settings.streaming?.enabled && settings.streaming?.subtitle?.enabled) {
                clearSubtitleAfterDelay(settings.streaming.subtitle.fadeAfterMs || 3000);
            }
        } catch (err) {
            console.error('LLM stream error:', err);
            event.sender.send('llm:error', err.message);
        } finally {
            transientState.isLLMStreaming = false;
        }
    });
}

module.exports = { register, processConfigUpdate, processNotebookOps };
