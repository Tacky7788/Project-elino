'use strict';

const { extractKeywords } = require('./memory-search.cjs');

const SUMMARY_PROMPT = '以下の会話を3-5文で要約してください。重要な事実、約束、感情的なやりとりを含めてください。';

/**
 * メッセージ配列の古い部分を要約して MemoryV2Summary 形式で返す。
 * @param {Array<{role: string, content: any}>} messages - 要約対象メッセージ
 * @param {object} llmProvider - llm-provider.cjs モジュール
 * @param {object} util - { provider, model, apiKey, credentialType }
 * @param {number} fromTurn - 要約開始ターン番号（turnRange用）
 * @returns {Promise<object|null>} MemoryV2Summary拡張形式 or null（失敗時）
 */
async function summarizeOldMessages(messages, llmProvider, util, fromTurn = 0) {
    if (!messages || messages.length === 0) return null;

    const conversationText = messages.map(m => {
        const text = typeof m.content === 'string'
            ? m.content
            : Array.isArray(m.content)
                ? m.content.filter(c => c.type === 'text').map(c => c.text).join(' ')
                : String(m.content);
        return `${m.role === 'user' ? 'ユーザー' : 'AI'}: ${text}`;
    }).join('\n');

    try {
        const result = await llmProvider.generateText({
            provider: util.provider,
            model: util.model,
            apiKey: util.apiKey,
            credentialType: util.credentialType,
            systemPrompt: SUMMARY_PROMPT,
            prompt: conversationText,
            maxTokens: 256,
            temperature: 0.3,
        });

        const content = result.text?.trim();
        if (!content) return null;

        const keywords = extractKeywords(content);
        const toTurn = fromTurn + messages.length - 1;

        return {
            date: new Date().toISOString().split('T')[0],
            type: 'topic',
            content,
            turnRange: [fromTurn, toTurn],
            keywords,
        };
    } catch (err) {
        console.error('[context-summary] 要約失敗:', err.message);
        return null;
    }
}

module.exports = { summarizeOldMessages };
