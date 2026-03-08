// src/core/memory-vector.cjs — Transformers.js ベクター埋め込み + cosine検索
'use strict';

let _pipeline = null;
let _modelLoading = null;
const _cache = new Map(); // factKey → Float32Array

async function ensureModel() {
    if (_pipeline) return;
    if (_modelLoading) return _modelLoading;
    _modelLoading = (async () => {
        try {
            const { pipeline, env } = await import('@huggingface/transformers');
            try {
                const { app } = require('electron');
                env.cacheDir = require('path').join(app.getPath('userData'), 'transformers-cache');
            } catch {}
            _pipeline = await pipeline(
                'feature-extraction',
                'Xenova/paraphrase-multilingual-MiniLM-L12-v2',
                { device: 'cpu', dtype: 'fp32' }
            );
            console.log('[memory-vector] モデルロード完了');
        } catch (e) {
            console.warn('[memory-vector] モデルロード失敗:', e.message);
            _pipeline = null;
        }
    })();
    return _modelLoading;
}

// 自前でmean pooling + L2 normalize（Transformers.jsのオプションに依存しない）
function meanPoolAndNormalize(tensorData, dims) {
    // dims: [batch=1, seqLen, hiddenSize=384]
    const seqLen = dims[1];
    const hiddenSize = dims[2];
    const pooled = new Float32Array(hiddenSize);
    for (let h = 0; h < hiddenSize; h++) {
        let sum = 0;
        for (let s = 0; s < seqLen; s++) {
            sum += tensorData[s * hiddenSize + h];
        }
        pooled[h] = sum / seqLen;
    }
    // L2 normalize
    let norm = 0;
    for (let h = 0; h < hiddenSize; h++) norm += pooled[h] * pooled[h];
    norm = Math.sqrt(norm);
    if (norm > 0) for (let h = 0; h < hiddenSize; h++) pooled[h] /= norm;
    return pooled;
}

async function embed(text) {
    await ensureModel();
    if (!_pipeline) return null;
    try {
        // pooling/normalizeオプションは渡すが自前処理も必ず実行
        const output = await _pipeline(text, { pooling: 'mean', normalize: true });
        // output.dimsがある場合は自前pooling、ない場合はoutput.dataをそのまま使う
        if (output.dims && output.dims.length === 3) {
            return meanPoolAndNormalize(output.data, output.dims);
        }
        // すでに[1, 384]または[384]の場合はL2 normalizeのみ
        const data = output.data instanceof Float32Array ? output.data : new Float32Array(output.data);
        const start = data.length === 384 ? 0 : 0; // batch=1を想定
        const vec = data.slice(start, start + 384);
        let norm = 0;
        for (let h = 0; h < vec.length; h++) norm += vec[h] * vec[h];
        norm = Math.sqrt(norm);
        if (norm > 0) for (let h = 0; h < vec.length; h++) vec[h] /= norm;
        return vec;
    } catch (e) {
        console.warn('[memory-vector] embed失敗:', e.message);
        return null;
    }
}

// 正規化済みベクター同士はdot = cosine
function cosine(a, b) {
    let dot = 0;
    for (let i = 0; i < a.length; i++) dot += a[i] * b[i];
    return Math.max(-1, Math.min(1, dot));
}

// query: string, facts: Array<{key, content}>, topK: number
// returns: Array<{fact, vectorScore, vectorRank}>
async function searchFacts(query, facts, topK = 50) {
    try {
        const queryVec = await embed(query);
        if (!queryVec) return facts.map((f, i) => ({ fact: f, vectorScore: 0, vectorRank: i + 1 }));

        for (const fact of facts) {
            if (!_cache.has(fact.key)) {
                const vec = await embed(fact.content);
                if (vec) _cache.set(fact.key, vec);
            }
        }

        const scored = facts.map(f => ({
            fact: f,
            vectorScore: _cache.has(f.key) ? cosine(queryVec, _cache.get(f.key)) : 0
        }));
        scored.sort((a, b) => b.vectorScore - a.vectorScore);

        // topKに含まれない factにはrank=Infinity
        const result = [];
        for (let i = 0; i < scored.length; i++) {
            result.push({
                fact: scored[i].fact,
                vectorScore: scored[i].vectorScore,
                vectorRank: i < topK ? i + 1 : Infinity
            });
        }
        return result;
    } catch (e) {
        console.warn('[memory-vector] searchFacts失敗:', e.message);
        return facts.map((f, i) => ({ fact: f, vectorScore: 0, vectorRank: Infinity }));
    }
}

// summaries用ベクター検索（factsと同じ仕組み、キャッシュキーは"summary_"+index）
// returns: Array<{summary, vectorScore}>
async function searchSummaries(query, summaries, topK = 5) {
    try {
        const queryVec = await embed(query);
        if (!queryVec) return [];

        for (const s of summaries) {
            // date+content先頭30文字で安定したキーを作る（インデックスだとsummaries追加で崩れる）
            const key = `summary_${s.date || ''}_${(s.content || '').slice(0, 30)}`;
            if (!_cache.has(key)) {
                const vec = await embed(s.content || '');
                if (vec) _cache.set(key, vec);
            }
        }

        return summaries
            .map(s => {
                const key = `summary_${s.date || ''}_${(s.content || '').slice(0, 30)}`;
                return { summary: s, vectorScore: _cache.has(key) ? cosine(queryVec, _cache.get(key)) : 0 };
            })
            .sort((a, b) => b.vectorScore - a.vectorScore)
            .slice(0, topK);
    } catch (e) {
        console.warn('[memory-vector] searchSummaries失敗:', e.message);
        return [];
    }
}

async function invalidateFact(key) {
    _cache.delete(key);
}

async function warmup(facts) {
    try {
        await ensureModel();
        if (!_pipeline) return;
        let count = 0;
        for (const fact of facts) {
            if (!_cache.has(fact.key)) {
                const vec = await embed(fact.content);
                if (vec) { _cache.set(fact.key, vec); count++; }
            }
        }
        if (count > 0) console.log(`[memory-vector] warmup完了: ${count}件`);
    } catch (e) {
        console.warn('[memory-vector] warmup失敗:', e.message);
    }
}

module.exports = { searchFacts, searchSummaries, invalidateFact, warmup };
