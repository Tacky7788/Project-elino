/**
 * LLM Provider Abstraction Layer
 *
 * Vercel AI SDK を使った統一LLMインターフェース。
 * ESMパッケージを dynamic import() で遅延ロード+キャッシュ。
 * main.cjs から require() で使用する。
 */

// ========== プロバイダーメタデータ ==========
// OpenAI互換APIはbaseURLを変えるだけで対応できる

const PROVIDER_META = {
    claude:      { label: 'Anthropic Claude', type: 'anthropic', envKey: 'ANTHROPIC_API_KEY', configKey: 'anthropicApiKey' },
    openai:      { label: 'OpenAI', type: 'openai', envKey: 'OPENAI_API_KEY', configKey: 'openaiApiKey' },
    gemini:      { label: 'Google Gemini', type: 'google', envKey: 'GOOGLE_GENERATIVE_AI_API_KEY', configKey: 'googleApiKey' },
    groq:        { label: 'Groq', type: 'openai-compat', baseURL: 'https://api.groq.com/openai/v1/', envKey: 'GROQ_API_KEY', configKey: 'groqApiKey' },
    deepseek:    { label: 'DeepSeek', type: 'openai-compat', baseURL: 'https://api.deepseek.com/', envKey: 'DEEPSEEK_API_KEY', configKey: 'deepseekApiKey' },
    openrouter:  { label: 'OpenRouter', type: 'openai-compat', baseURL: 'https://openrouter.ai/api/v1/', envKey: 'OPENROUTER_API_KEY', configKey: 'openrouterApiKey' },
    xai:         { label: 'xAI (Grok)', type: 'openai-compat', baseURL: 'https://api.x.ai/v1/', envKey: 'XAI_API_KEY', configKey: 'xaiApiKey' },
    mistral:     { label: 'Mistral', type: 'openai-compat', baseURL: 'https://api.mistral.ai/v1/', envKey: 'MISTRAL_API_KEY', configKey: 'mistralApiKey' },
    togetherai:  { label: 'Together.ai', type: 'openai-compat', baseURL: 'https://api.together.xyz/v1/', envKey: 'TOGETHER_API_KEY', configKey: 'togetheraiApiKey' },
    fireworks:   { label: 'Fireworks.ai', type: 'openai-compat', baseURL: 'https://api.fireworks.ai/inference/v1/', envKey: 'FIREWORKS_API_KEY', configKey: 'fireworksApiKey' },
    novita:      { label: 'Novita', type: 'openai-compat', baseURL: 'https://api.novita.ai/v3/openai/', envKey: 'NOVITA_API_KEY', configKey: 'novitaApiKey' },
    cloudflare:  { label: 'Cloudflare Workers AI', type: 'openai-compat', baseURL: 'https://api.cloudflare.com/client/v4/accounts/{accountId}/ai/v1/', envKey: 'CLOUDFLARE_API_KEY', configKey: 'cloudflareApiKey', extraConfig: 'cloudflareAccountId' },
    minimax:     { label: 'MiniMax', type: 'openai-compat', baseURL: 'https://api.minimax.chat/v1/', envKey: 'MINIMAX_API_KEY', configKey: 'minimaxApiKey' },
    moonshot:    { label: 'Moonshot AI', type: 'openai-compat', baseURL: 'https://api.moonshot.cn/v1/', envKey: 'MOONSHOT_API_KEY', configKey: 'moonshotApiKey' },
    qwen:        { label: 'Qwen (Alibaba)', type: 'openai-compat', baseURL: 'https://dashscope.aliyuncs.com/compatible-mode/v1/', envKey: 'QWEN_API_KEY', configKey: 'qwenApiKey' },
    zhipu:       { label: 'Zhipu (GLM)', type: 'openai-compat', baseURL: 'https://open.bigmodel.cn/api/paas/v4/', envKey: 'ZHIPU_API_KEY', configKey: 'zhipuApiKey' },
    siliconflow: { label: 'SiliconFlow', type: 'openai-compat', baseURL: 'https://api.siliconflow.cn/v1/', envKey: 'SILICONFLOW_API_KEY', configKey: 'siliconflowApiKey' },
    stepfun:     { label: 'Stepfun', type: 'openai-compat', baseURL: 'https://api.stepfun.com/v1/', envKey: 'STEPFUN_API_KEY', configKey: 'stepfunApiKey' },
    baichuan:    { label: 'Baichuan', type: 'openai-compat', baseURL: 'https://api.baichuan-ai.com/v1/', envKey: 'BAICHUAN_API_KEY', configKey: 'baichuanApiKey' },
    modelscope:  { label: 'ModelScope', type: 'openai-compat', baseURL: 'https://api-inference.modelscope.cn/v1/', envKey: 'MODELSCOPE_API_KEY', configKey: 'modelscopeApiKey' },
    tencent:     { label: 'Tencent Cloud', type: 'openai-compat', baseURL: 'https://api.lkeap.cloud.tencent.com/v1/', envKey: 'TENCENT_API_KEY', configKey: 'tencentApiKey' },
    player2:     { label: 'Player2', type: 'openai-compat', baseURL: 'https://api.player2.ai/v1/', envKey: 'PLAYER2_API_KEY', configKey: 'player2ApiKey' },
    '302ai':     { label: '302.AI', type: 'openai-compat', baseURL: 'https://api.302.ai/v1/', envKey: '302AI_API_KEY', configKey: '302aiApiKey' },
    ollama:      { label: 'Ollama (local)', type: 'openai-compat', baseURL: 'http://localhost:11434/v1/', envKey: null, configKey: null, noAuth: true },
    vllm:        { label: 'vLLM (local)', type: 'openai-compat', baseURL: 'http://localhost:8000/v1/', envKey: null, configKey: null, noAuth: true },
    sglang:      { label: 'SGLang (local)', type: 'openai-compat', baseURL: 'http://localhost:30000/v1/', envKey: null, configKey: null, noAuth: true },
};

// ========== モデルレジストリ ==========

const MODEL_REGISTRY = {
    claude: [
        { id: 'claude-opus-4-6', label: 'Claude Opus 4.6 (best quality)', multiModal: true },
        { id: 'claude-sonnet-4-6', label: 'Claude Sonnet 4.6', multiModal: true },
        { id: 'claude-sonnet-4-5', label: 'Claude Sonnet 4.5', multiModal: true },
        { id: 'claude-haiku-4-5', label: 'Claude Haiku 4.5 (fast)', multiModal: true },
        { id: 'claude-sonnet-4-20250514', label: 'Claude Sonnet 4', multiModal: true },
        { id: 'claude-3-5-sonnet-20241022', label: 'Claude 3.5 Sonnet', multiModal: true },
        { id: 'claude-3-5-haiku-20241022', label: 'Claude 3.5 Haiku', multiModal: true },
        { id: 'claude-3-haiku-20240307', label: 'Claude 3 Haiku', multiModal: false },
    ],
    openai: [
        { id: 'gpt-5.2', label: 'GPT-5.2 Thinking (latest)', multiModal: true },
        { id: 'gpt-5-mini', label: 'GPT-5 mini (fast, low cost)', multiModal: true },
        { id: 'o3', label: 'o3 (reasoning)', multiModal: true },
        { id: 'o3-mini', label: 'o3 mini', multiModal: true },
        { id: 'o4-mini', label: 'o4 mini (reasoning, fast)', multiModal: true },
        { id: 'gpt-4.1', label: 'GPT-4.1', multiModal: true },
        { id: 'gpt-4.1-mini', label: 'GPT-4.1 mini', multiModal: true },
        { id: 'gpt-4.1-nano', label: 'GPT-4.1 nano (lightest)', multiModal: true },
        { id: 'gpt-4o', label: 'GPT-4o', multiModal: true },
        { id: 'gpt-4o-mini', label: 'GPT-4o mini', multiModal: true },
    ],
    gemini: [
        { id: 'gemini-3.1-pro-preview', label: 'Gemini 3.1 Pro (latest, best quality)', multiModal: true },
        { id: 'gemini-3-flash-preview', label: 'Gemini 3 Flash (Pro-level, fast)', multiModal: true },
        { id: 'gemini-2.5-pro', label: 'Gemini 2.5 Pro', multiModal: true },
        { id: 'gemini-2.5-flash', label: 'Gemini 2.5 Flash (recommended)', multiModal: true },
        { id: 'gemini-2.5-flash-lite', label: 'Gemini 2.5 Flash Lite (fastest)', multiModal: true },
        { id: 'gemini-2.0-flash', label: 'Gemini 2.0 Flash', multiModal: true },
    ],
    groq: [
        { id: 'meta-llama/llama-4-maverick-17b-128e-instruct', label: 'Llama 4 Maverick 17B', multiModal: true },
        { id: 'meta-llama/llama-4-scout-17b-16e-instruct', label: 'Llama 4 Scout 17B', multiModal: true },
        { id: 'llama-3.3-70b-versatile', label: 'Llama 3.3 70B', multiModal: false },
        { id: 'llama-3.1-8b-instant', label: 'Llama 3.1 8B (fastest)', multiModal: false },
        { id: 'qwen/qwen3-32b', label: 'Qwen 3 32B', multiModal: false },
        { id: 'deepseek-r1-distill-llama-70b', label: 'DeepSeek R1 Distill 70B', multiModal: false },
        { id: 'mixtral-8x7b-32768', label: 'Mixtral 8x7B', multiModal: false },
    ],
    deepseek: [
        { id: 'deepseek-chat', label: 'DeepSeek V3 (recommended)', multiModal: false },
        { id: 'deepseek-reasoner', label: 'DeepSeek R1 (reasoning)', multiModal: false },
    ],
    openrouter: [
        { id: 'anthropic/claude-sonnet-4', label: 'Claude Sonnet 4 (via)', multiModal: true },
        { id: 'openai/gpt-4o', label: 'GPT-4o (via)', multiModal: true },
        { id: 'google/gemini-2.5-flash', label: 'Gemini 2.5 Flash (via)', multiModal: true },
        { id: 'meta-llama/llama-4-maverick', label: 'Llama 4 Maverick', multiModal: true },
        { id: 'deepseek/deepseek-r1', label: 'DeepSeek R1 (via)', multiModal: false },
        { id: 'qwen/qwen3-235b', label: 'Qwen3 235B', multiModal: false },
    ],
    xai: [
        { id: 'grok-3', label: 'Grok 3', multiModal: true },
        { id: 'grok-3-mini', label: 'Grok 3 Mini (fast)', multiModal: true },
        { id: 'grok-2', label: 'Grok 2', multiModal: true },
    ],
    mistral: [
        { id: 'mistral-large-latest', label: 'Mistral Large (best quality)', multiModal: true },
        { id: 'mistral-medium-latest', label: 'Mistral Medium', multiModal: false },
        { id: 'mistral-small-latest', label: 'Mistral Small (fast)', multiModal: false },
        { id: 'codestral-latest', label: 'Codestral (code-focused)', multiModal: false },
    ],
    togetherai: [
        { id: 'meta-llama/Llama-4-Maverick-17B-128E-Instruct-Turbo', label: 'Llama 4 Maverick 17B', multiModal: true },
        { id: 'meta-llama/Llama-3.3-70B-Instruct-Turbo', label: 'Llama 3.3 70B Turbo', multiModal: false },
        { id: 'Qwen/Qwen3-235B-A22B-fp8', label: 'Qwen3 235B', multiModal: false },
        { id: 'deepseek-ai/DeepSeek-R1', label: 'DeepSeek R1', multiModal: false },
        { id: 'google/gemma-2-27b-it', label: 'Gemma 2 27B', multiModal: false },
    ],
    fireworks: [
        { id: 'accounts/fireworks/models/llama4-maverick-instruct-basic', label: 'Llama 4 Maverick', multiModal: true },
        { id: 'accounts/fireworks/models/llama-v3p3-70b-instruct', label: 'Llama 3.3 70B', multiModal: false },
        { id: 'accounts/fireworks/models/qwen3-235b-a22b', label: 'Qwen3 235B', multiModal: false },
        { id: 'accounts/fireworks/models/deepseek-r1', label: 'DeepSeek R1', multiModal: false },
    ],
    novita: [
        { id: 'meta-llama/llama-3.3-70b-instruct', label: 'Llama 3.3 70B', multiModal: false },
        { id: 'deepseek/deepseek-r1', label: 'DeepSeek R1', multiModal: false },
        { id: 'qwen/qwen3-235b-a22b', label: 'Qwen3 235B', multiModal: false },
    ],
    cloudflare: [
        { id: '@cf/meta/llama-3.3-70b-instruct-fp8-fast', label: 'Llama 3.3 70B', multiModal: false },
        { id: '@cf/qwen/qwen2.5-72b-instruct', label: 'Qwen 2.5 72B', multiModal: false },
        { id: '@cf/deepseek-ai/deepseek-r1-distill-qwen-32b', label: 'DeepSeek R1 Distill 32B', multiModal: false },
    ],
    minimax: [
        { id: 'MiniMax-M2.5', label: 'MiniMax M2.5 (latest)', multiModal: false },
        { id: 'MiniMax-M2.5-highspeed', label: 'MiniMax M2.5 (fast)', multiModal: false },
        { id: 'MiniMax-M2.1', label: 'MiniMax M2.1', multiModal: false },
    ],
    moonshot: [
        { id: 'moonshot-v1-auto', label: 'Moonshot v1 Auto', multiModal: false },
        { id: 'moonshot-v1-128k', label: 'Moonshot v1 128K', multiModal: false },
        { id: 'moonshot-v1-32k', label: 'Moonshot v1 32K', multiModal: false },
    ],
    qwen: [
        { id: 'qwen-max', label: 'Qwen Max (best quality)', multiModal: true },
        { id: 'qwen-plus', label: 'Qwen Plus', multiModal: true },
        { id: 'qwen-turbo', label: 'Qwen Turbo (fast)', multiModal: false },
        { id: 'qwen3-235b-a22b', label: 'Qwen3 235B', multiModal: false },
        { id: 'qwen3-32b', label: 'Qwen3 32B', multiModal: false },
    ],
    zhipu: [
        { id: 'glm-4-plus', label: 'GLM-4 Plus (best quality)', multiModal: true },
        { id: 'glm-4-flash', label: 'GLM-4 Flash (free)', multiModal: true },
        { id: 'glm-4-long', label: 'GLM-4 Long (long context)', multiModal: false },
    ],
    siliconflow: [
        { id: 'deepseek-ai/DeepSeek-V3', label: 'DeepSeek V3', multiModal: false },
        { id: 'deepseek-ai/DeepSeek-R1', label: 'DeepSeek R1', multiModal: false },
        { id: 'Qwen/Qwen3-235B-A22B', label: 'Qwen3 235B', multiModal: false },
        { id: 'Pro/deepseek-ai/DeepSeek-R1', label: 'DeepSeek R1 Pro', multiModal: false },
    ],
    stepfun: [
        { id: 'step-2-16k', label: 'Step 2 16K', multiModal: true },
        { id: 'step-1-128k', label: 'Step 1 128K', multiModal: false },
        { id: 'step-1-flash', label: 'Step 1 Flash (fast)', multiModal: false },
    ],
    baichuan: [
        { id: 'Baichuan4-Turbo', label: 'Baichuan4 Turbo', multiModal: false },
        { id: 'Baichuan4-Air', label: 'Baichuan4 Air (fast)', multiModal: false },
    ],
    modelscope: [
        { id: 'Qwen/Qwen3-235B-A22B', label: 'Qwen3 235B', multiModal: false },
        { id: 'deepseek-ai/DeepSeek-V3', label: 'DeepSeek V3', multiModal: false },
    ],
    tencent: [
        { id: 'deepseek-v3', label: 'DeepSeek V3 (via Tencent)', multiModal: false },
        { id: 'deepseek-r1', label: 'DeepSeek R1 (via Tencent)', multiModal: false },
        { id: 'hunyuan-large', label: 'Hunyuan Large', multiModal: true },
        { id: 'hunyuan-turbo', label: 'Hunyuan Turbo', multiModal: false },
    ],
    player2: [
        { id: 'player2-mini', label: 'Player2 Mini', multiModal: false },
    ],
    '302ai': [
        { id: 'claude-sonnet-4-20250514', label: 'Claude Sonnet 4 (via)', multiModal: true },
        { id: 'gpt-4o', label: 'GPT-4o (via)', multiModal: true },
        { id: 'deepseek-chat', label: 'DeepSeek V3 (via)', multiModal: false },
    ],
    ollama: [
        { id: 'llama3.3', label: 'Llama 3.3 (download required)', multiModal: false },
        { id: 'qwen3:32b', label: 'Qwen3 32B (download required)', multiModal: false },
        { id: 'gemma2:27b', label: 'Gemma 2 27B (download required)', multiModal: false },
        { id: 'deepseek-r1:32b', label: 'DeepSeek R1 32B (download required)', multiModal: false },
        { id: 'phi4', label: 'Phi-4 (lightweight)', multiModal: false },
    ],
    vllm: [
        { id: 'default', label: 'Running model', multiModal: false },
    ],
    sglang: [
        { id: 'default', label: 'Running model', multiModal: false },
    ],
};

// ========== ESM モジュールキャッシュ ==========

let _aiModule = null;
let _providerCache = {};

async function getAI() {
    if (!_aiModule) {
        _aiModule = await import('ai');
    }
    return _aiModule;
}

async function getProviderInstance(providerName, apiKey, credentialType = 'apiKey', config = {}) {
    if (!apiKey && !PROVIDER_META[providerName]?.noAuth) {
        throw new Error(`${providerName} のAPIキーが設定されていません`);
    }

    const cacheKey = `${providerName}:${(apiKey || 'noauth').slice(0, 8)}`;
    if (credentialType === 'apiKey' && _providerCache[cacheKey]) return _providerCache[cacheKey];

    const meta = PROVIDER_META[providerName];
    if (!meta) throw new Error(`未対応のプロバイダ: ${providerName}`);

    let provider;

    switch (meta.type) {
        case 'anthropic': {
            const { createAnthropic } = await import('@ai-sdk/anthropic');
            provider = createAnthropic({ apiKey });
            break;
        }
        case 'openai': {
            const { createOpenAI } = await import('@ai-sdk/openai');
            provider = createOpenAI({ apiKey });
            break;
        }
        case 'google': {
            const { createGoogleGenerativeAI } = await import('@ai-sdk/google');
            if (credentialType === 'bearer') {
                // OAuth: peruserquota スコープは v1 エンドポイントで動作する
                provider = createGoogleGenerativeAI({
                    baseURL: 'https://generativelanguage.googleapis.com/v1',
                    apiKey: 'oauth-placeholder',
                    headers: {
                        'x-goog-api-key': undefined,
                        'Authorization': `Bearer ${apiKey}`,
                    },
                });
            } else {
                provider = createGoogleGenerativeAI({ apiKey });
            }
            break;
        }
        case 'openai-compat': {
            const { createOpenAI } = await import('@ai-sdk/openai');
            let baseURL = config[`${providerName}BaseUrl`] || meta.baseURL;
            // Cloudflare: accountIdを差し替え
            if (meta.extraConfig && config[meta.extraConfig]) {
                baseURL = baseURL.replace('{accountId}', config[meta.extraConfig]);
            }
            const opts = { baseURL, compatibility: 'compatible' };
            if (apiKey) opts.apiKey = apiKey;
            if (meta.noAuth) opts.apiKey = 'no-key';
            provider = createOpenAI(opts);
            break;
        }
        default:
            throw new Error(`未対応のプロバイダタイプ: ${meta.type}`);
    }

    if (credentialType === 'apiKey') {
        _providerCache[cacheKey] = provider;
    }
    return provider;
}

// ========== APIキー解決 ==========

function resolveApiKey(providerName, config) {
    const meta = PROVIDER_META[providerName];
    if (!meta) return '';

    // ローカルプロバイダーはキー不要
    if (meta.noAuth) return 'no-key';

    // 環境変数優先
    if (meta.envKey && process.env[meta.envKey]) {
        return process.env[meta.envKey];
    }

    // config.json フォールバック
    if (meta.configKey && config[meta.configKey]) {
        return config[meta.configKey];
    }

    return '';
}

// ========== クレデンシャル解決 (OAuth対応) ==========

async function resolveCredential(providerName, config, configFilePath) {
    if (providerName === 'gemini') {
        if (process.env.GOOGLE_GENERATIVE_AI_API_KEY) {
            return { type: 'apiKey', value: process.env.GOOGLE_GENERATIVE_AI_API_KEY };
        }
        if (config.googleApiKey) {
            return { type: 'apiKey', value: config.googleApiKey };
        }
        // Google OAuth (google-oauth.cjs) は削除済み — API Key のみサポート
        return null;
    }

    const apiKey = resolveApiKey(providerName, config);
    return apiKey ? { type: 'apiKey', value: apiKey } : null;
}

// ========== メッセージ変換 ==========

function normalizeMessages(messages, systemPrompt) {
    const normalized = [];

    for (const msg of messages) {
        if (Array.isArray(msg.content)) {
            const parts = msg.content.map(item => {
                if (item.type === 'text') {
                    return { type: 'text', text: item.text };
                } else if (item.type === 'image' && item.source) {
                    return {
                        type: 'image',
                        image: `data:${item.source.media_type};base64,${item.source.data}`
                    };
                }
                return item;
            });
            normalized.push({ role: msg.role, content: parts });
        } else {
            normalized.push({ role: msg.role, content: msg.content });
        }
    }

    return normalized;
}

// ========== メイン API ==========

async function* streamChat({ provider, model, apiKey, systemPrompt, messages, maxTokens = 512, temperature = 0.9, credentialType = 'apiKey', config = {} }) {
    const ai = await getAI();
    const providerInstance = await getProviderInstance(provider, apiKey, credentialType, config);

    const normalizedMessages = normalizeMessages(messages, systemPrompt);

    console.log(`🔧 ${provider} stream: model=${model}, max_tokens=${maxTokens}`);

    // Anthropic prompt caching: system promptをキャッシュ対象にする
    const meta = PROVIDER_META[provider];
    const isAnthropic = meta?.type === 'anthropic';
    const systemOption = isAnthropic && systemPrompt
        ? [{ type: 'text', text: systemPrompt, cacheControl: { type: 'ephemeral' } }]
        : systemPrompt;

    const result = ai.streamText({
        model: providerInstance(model),
        system: systemOption,
        messages: normalizedMessages,
        maxTokens,
        temperature,
    });

    for await (const chunk of (await result).textStream) {
        if (chunk) {
            yield chunk;
        }
    }
}

async function generateText({ provider, model, apiKey, prompt, systemPrompt, maxTokens = 1024, temperature = 0.3, credentialType = 'apiKey', config = {} }) {
    const ai = await getAI();
    const providerInstance = await getProviderInstance(provider, apiKey, credentialType, config);

    console.log(`🔧 ${provider} generateText: model=${model}`);

    const messages = [{ role: 'user', content: prompt }];

    // Anthropic prompt caching
    const meta = PROVIDER_META[provider];
    const isAnthropic = meta?.type === 'anthropic';
    const systemOption = isAnthropic && systemPrompt
        ? [{ type: 'text', text: systemPrompt, cacheControl: { type: 'ephemeral' } }]
        : (systemPrompt || undefined);

    const result = await ai.generateText({
        model: providerInstance(model),
        system: systemOption,
        messages,
        maxTokens,
        temperature,
    });

    return { text: result.text };
}

function getAvailableProviders(config) {
    const providers = [];
    for (const name of Object.keys(MODEL_REGISTRY)) {
        const key = resolveApiKey(name, config);
        if (key) {
            providers.push(name);
        } else if (name === 'gemini' && config.googleRefreshToken) {
            providers.push(name);
        }
    }
    return providers;
}

function resolveUtilityLLM(settings, config) {
    const provider = settings?.llm?.utilityProvider || 'openai';
    const model = settings?.llm?.utilityModel || 'gpt-4o-mini';
    const apiKey = resolveApiKey(provider, config);
    return { provider, model, apiKey };
}

async function resolveUtilityCredential(settings, config, configFilePath) {
    const provider = settings?.llm?.utilityProvider || 'openai';
    const model = settings?.llm?.utilityModel || 'gpt-4o-mini';
    const cred = await resolveCredential(provider, config, configFilePath);
    if (!cred) return null;
    return { provider, model, apiKey: cred.value, credentialType: cred.type };
}

// ========== Exports ==========

module.exports = {
    streamChat,
    generateText,
    getAvailableProviders,
    resolveApiKey,
    resolveCredential,
    resolveUtilityLLM,
    resolveUtilityCredential,
    MODEL_REGISTRY,
    PROVIDER_META,
};
