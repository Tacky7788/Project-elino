// src/core/memory-utils.cjs — 記憶関連の共通ユーティリティ
'use strict';

/**
 * サマリーを追加（重複チェック付き）
 * @param {object} memoryV2
 * @param {{ date: string, content: string }} summary
 * @param {number} max - 最大保持件数
 * @returns {boolean} 追加された場合 true
 */
function addSummary(memoryV2, summary, max = 10) {
    if (!memoryV2.summaries) memoryV2.summaries = [];
    // 同日+先頭40文字一致で重複スキップ
    const isDupe = memoryV2.summaries.some(s =>
        s.date === summary.date &&
        s.content.substring(0, 40) === summary.content.substring(0, 40)
    );
    if (isDupe) return false;
    memoryV2.summaries.push(summary);
    if (memoryV2.summaries.length > max) {
        memoryV2.summaries = memoryV2.summaries.slice(-max);
    }
    return true;
}

module.exports = { addSummary };
