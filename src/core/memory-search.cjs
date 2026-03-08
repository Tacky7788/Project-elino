// src/core/memory-search.cjs — N-gram トークナイザー + TF-IDF スコアリング + BM25/RRFハイブリッド
'use strict';

const MiniSearch = require('minisearch');

// 漢字・カタカナ・ひらがな・英字の連続語 + 文字bigram
const WORD_PATTERN = /[\u4e00-\u9fff]+|[\u30a0-\u30ff]+|[\u3040-\u309f]{2,}|[a-zA-Z]{2,}|[0-9]+/g;

/**
 * テキストをトークン化（連続語 + 文字bigram）
 * @param {string} text
 * @returns {Set<string>}
 */
function tokenize(text) {
    if (!text) return new Set();
    const tokens = new Set();
    const words = text.match(WORD_PATTERN) || [];
    for (const w of words) {
        tokens.add(w.toLowerCase());
        // 文字bigram（日本語に効く）
        if (w.length >= 2) {
            for (let i = 0; i < w.length - 1; i++) {
                tokens.add(w[i] + w[i + 1]);
            }
        }
    }
    return tokens;
}

/**
 * fact登録時にキーワードを抽出
 * @param {string} content
 * @returns {string[]}
 */
function extractKeywords(content) {
    return [...tokenize(content)];
}

/**
 * 全factsのトークン出現fact数（DF）を構築
 * @param {Array<{keywords?: string[]}>} facts
 * @returns {Map<string, number>}
 */
function buildDocFrequency(facts) {
    const df = new Map();
    for (const f of facts) {
        const kws = f.keywords;
        if (!kws) continue;
        const seen = new Set();
        for (const k of kws) {
            if (!seen.has(k)) {
                seen.add(k);
                df.set(k, (df.get(k) || 0) + 1);
            }
        }
    }
    return df;
}

/**
 * TF-IDFライクなrelevanceスコア (0.0-1.0)
 * @param {Set<string>} queryTokens
 * @param {string[]|undefined} factKeywords
 * @param {number} totalFactCount
 * @param {Map<string, number>} tokenDocFreq
 * @returns {number}
 */
function computeRelevance(queryTokens, factKeywords, totalFactCount, tokenDocFreq) {
    if (!factKeywords || factKeywords.length === 0 || queryTokens.size === 0) return 0;

    let score = 0;
    let matchCount = 0;
    // IDF の分母を N+1 にして facts=1 でも log > 0 にする
    const N = Math.max(totalFactCount, 1) + 1;

    for (const kw of factKeywords) {
        if (queryTokens.has(kw)) {
            const df = tokenDocFreq.get(kw) || 1;
            const idf = Math.log(N / df);
            score += idf;
            matchCount++;
        }
    }

    if (matchCount === 0) return 0;

    // 正規化: マッチしたトークン数の割合も加味
    const maxPossible = Math.log(N) * Math.min(queryTokens.size, factKeywords.length);
    if (maxPossible <= 0) return 1.0;

    return Math.min(1.0, score / maxPossible);
}

/**
 * エビングハウスの忘却曲線ベースの保持率を計算
 * retention = e^(-t / (stability * decayRate))
 * @param {object} fact
 * @param {number} nowMs - 現在時刻のミリ秒
 * @returns {number} 0.0-1.0
 */
function computeRetention(fact, nowMs) {
    const lastSeen = fact.lastSeenAt ? new Date(fact.lastSeenAt).getTime() : (fact.addedAt ? new Date(fact.addedAt).getTime() : nowMs);
    const tDays = Math.max(0, (nowMs - lastSeen) / (1000 * 60 * 60 * 24));

    const recallCount = fact.recallCount ?? 0;
    // 想起するほど安定性が上がる
    const baseStability = 1.0;
    const recallBonus = recallCount * 0.2;

    // decayRate: 低いほど忘れにくい (1.0=標準, 0.1=ほぼ忘れない)
    // 感情強度に応じて低くなる（保存時に設定 or フォールバック計算）
    let decayRate = fact.decayRate;
    if (decayRate === undefined) {
        if (fact.emotionalContext) {
            const emotionalIntensity = Math.abs(fact.emotionalContext.valence - 0.5) * 2;
            decayRate = Math.max(0.1, 1.0 - emotionalIntensity * 0.5);
        } else {
            decayRate = 1.0;
        }
    }

    // stability = (base + recallBonus) / decayRate
    // decayRateが低いほど stability が大きく、忘れにくい
    const stability = (baseStability + recallBonus) / decayRate;

    return Math.exp(-tDays / stability);
}

/**
 * 最終スコア: 0.5 * retention + 0.3 * similarity + 0.2 * importance
 * @param {object} fact
 * @param {number} similarityScore - computeRelevance の結果 (0-1)
 * @param {number} nowMs
 * @returns {number} 0.0-1.0
 */
function computeFinalScore(fact, similarityScore, nowMs) {
    const retention = computeRetention(fact, nowMs);
    const importance = fact.importance ?? 0.5;
    return 0.5 * retention + 0.3 * similarityScore + 0.2 * importance;
}

/**
 * summaries用BM25インデックス構築
 * @param {Array<{date, content}>} summaries
 * @returns {MiniSearch}
 */
function buildSummaryBm25Index(summaries) {
    const ms = new MiniSearch({
        fields: ['content'],
        storeFields: ['date'],
        tokenize: (text) => [...tokenize(text)],
        processTerm: (term) => term.toLowerCase()
    });
    const docs = summaries.map((s, i) => ({
        id: `summary_${i}`,
        date: s.date || '',
        content: s.content || ''
    }));
    ms.addAll(docs);
    return ms;
}

/**
 * summaries BM25検索
 * @param {MiniSearch} index
 * @param {string} query
 * @param {Array} summaries
 * @param {number} topK
 * @returns {Array<{summary, bm25Rank}>}
 */
function bm25SearchSummaries(index, query, summaries, topK = 10) {
    try {
        const tokens = [...tokenize(query)];
        if (tokens.length === 0) return [];
        const results = index.search(tokens.join(' '), { combineWith: 'OR', prefix: true });
        const ranked = new Map();
        for (let i = 0; i < results.length && i < topK; i++) {
            ranked.set(results[i].id, i + 1);
        }
        return summaries
            .map((s, i) => ({ summary: s, bm25Rank: ranked.get(`summary_${i}`) ?? Infinity }))
            .filter(r => isFinite(r.bm25Rank))
            .sort((a, b) => a.bm25Rank - b.bm25Rank)
            .slice(0, topK);
    } catch (e) {
        return [];
    }
}

/**
 * MiniSearchインデックスを構築（BM25）
 * @param {Array<{key, content, keywords?}>} facts
 * @returns {MiniSearch}
 */
function buildBm25Index(facts) {
    const ms = new MiniSearch({
        fields: ['content'],
        storeFields: ['key'],
        tokenize: (text) => [...tokenize(text)], // 既存tokenize()を流用
        processTerm: (term) => term.toLowerCase()
    });
    const docs = facts.map(f => ({ id: f.key, key: f.key, content: f.content || '' }));
    ms.addAll(docs);
    return ms;
}

/**
 * BM25でfactsを検索
 * @param {MiniSearch} index
 * @param {string} query
 * @param {Array} allFacts
 * @param {number} topK
 * @returns {Array<{fact, bm25Rank}>} topKに入らないものはInfinity
 */
function bm25SearchFacts(index, query, allFacts, topK = 50) {
    const factMap = new Map(allFacts.map(f => [f.key, f]));
    let results = [];
    try {
        // queryをtokenizeして検索文字列として結合
        const tokens = [...tokenize(query)];
        if (tokens.length === 0) return allFacts.map(f => ({ fact: f, bm25Rank: Infinity }));
        results = index.search(tokens.join(' '), { combineWith: 'OR', prefix: true });
    } catch (e) {
        return allFacts.map(f => ({ fact: f, bm25Rank: Infinity }));
    }

    const ranked = new Map();
    for (let i = 0; i < results.length && i < topK; i++) {
        ranked.set(results[i].id, i + 1);
    }

    return allFacts.map(f => ({
        fact: f,
        bm25Rank: ranked.has(f.key) ? ranked.get(f.key) : Infinity
    }));
}

/**
 * RRF融合スコア計算
 * @param {number} bm25Rank
 * @param {number} vectorRank
 * @param {number} k RRFパラメータ（デフォルト60）
 * @returns {number} 0 ~ 約0.033（k=60のとき rank=1で 1/61≈0.016 * 2 ≈ 0.033）
 */
function computeRrfScore(bm25Rank, vectorRank, k = 60) {
    const bm25Contribution = isFinite(bm25Rank) ? 1 / (k + bm25Rank) : 0;
    const vectorContribution = isFinite(vectorRank) ? 1 / (k + vectorRank) : 0;
    return bm25Contribution + vectorContribution;
}

/**
 * ハイブリッド最終スコア
 * score = rrfScore * 200 + retention * 1.5 + imp * 1.0 + freshness * 0.5 + freqBonus
 * @param {object} fact
 * @param {number} bm25Rank
 * @param {number} vectorRank
 * @param {number} nowMs
 * @returns {number}
 */
function computeHybridScore(fact, bm25Rank, vectorRank, nowMs) {
    const rrfScore = computeRrfScore(bm25Rank, vectorRank);
    const retention = computeRetention(fact, nowMs);
    const impWeight = { high: 1.0, medium: 0.6, low: 0.3 };
    const imp = impWeight[fact.importance] || 0.6;
    const lastSeen = fact.lastSeenAt ? new Date(fact.lastSeenAt).getTime() : nowMs;
    const freshness = Math.max(0, 1.0 - (nowMs - lastSeen) / (60 * 24 * 60 * 60 * 1000));
    const freqBonus = Math.min(0.3, (fact.seenCount || 1) * 0.05);
    return rrfScore * 200 + retention * 1.5 + imp * 1.0 + freshness * 0.5 + freqBonus;
}

module.exports = {
    tokenize, extractKeywords, computeRelevance, buildDocFrequency, computeRetention, computeFinalScore,
    // ハイブリッド検索（新規）
    buildBm25Index, bm25SearchFacts, computeRrfScore, computeHybridScore,
    // summaries検索
    buildSummaryBm25Index, bm25SearchSummaries
};
