const OpenAI = require('openai');
const { Logger } = require('./logger');

const PROVIDERS = {
  openai: {
    name: 'OpenAI',
    baseURL: 'https://api.openai.com/v1',
    defaultModel: 'gpt-5.5',
    models: ['gpt-5.5', 'gpt-5.5-instant', 'gpt-5.4'],
    envKey: 'OPENAI_API_KEY',
  },
  openrouter: {
    name: 'OpenRouter',
    baseURL: 'https://openrouter.ai/api/v1',
    defaultModel: 'openai/gpt-5.5',
    models: ['openai/gpt-5.5', 'anthropic/claude-opus-4-8', 'google/gemini-3.5-flash', 'moonshotai/kimi-k2.6', 'zhipu/glm-5'],
    envKey: 'OPENROUTER_API_KEY',
  },
  kimi: {
    name: 'Kimi (Moonshot AI)',
    baseURL: 'https://api.moonshot.ai/v1',
    defaultModel: 'kimi-k2.6',
    models: ['kimi-k2.6', 'kimi-k2.5', 'moonshot-v1-auto'],
    envKey: 'MOONSHOT_API_KEY',
  },
  mimo: {
    name: 'MiMo (Xiaomi)',
    baseURL: 'https://api.xiaomimimo.com/v1',
    defaultModel: 'mimo-v2.5-pro',
    models: ['mimo-v2.5-pro', 'mimo-v2.5'],
    envKey: 'MIMO_API_KEY',
  },
  glm: {
    name: 'GLM (Zhipu AI)',
    baseURL: 'https://api.z.ai/api/paas/v4/',
    defaultModel: 'glm-5',
    models: ['glm-5', 'glm-5.1'],
    envKey: 'GLM_API_KEY',
  },
};

class AITextService {
  constructor(credentials = {}) {
    this.logger = new Logger('AITextService');
    this.client = null;
    this.gemini = null;
    this.model = null;
    this.providerName = null;

    this._init(credentials);
  }

  _init(credentials) {
    const provider = credentials.aiProvider?.provider;
    const apiKey = credentials.aiProvider?.apiKey;
    const model = credentials.aiProvider?.model;

    if (provider && PROVIDERS[provider] && apiKey) {
      return this._initOpenAICompatible(PROVIDERS[provider], apiKey, model);
    }

    for (const [, preset] of Object.entries(PROVIDERS)) {
      const key = process.env[preset.envKey];
      if (key) {
        return this._initOpenAICompatible(preset, key);
      }
    }

    const geminiKey = credentials.gemini?.apiKey || process.env.GEMINI_API_KEY;
    if (geminiKey) {
      return this._initGemini(geminiKey, credentials.gemini?.model);
    }

    this.logger.warn('No AI text provider configured — text generation unavailable');
  }

  _initOpenAICompatible(preset, apiKey, model) {
    this.client = new OpenAI({ apiKey, baseURL: preset.baseURL });
    this.model = model || preset.defaultModel;
    this.providerName = preset.name;
    this.logger.info(`${preset.name} initialized (model: ${this.model})`);
  }

  _initGemini(apiKey, model) {
    try {
      const { GoogleGenAI } = require('@google/genai');
      this.gemini = new GoogleGenAI({ apiKey });
      this.model = model || 'gemini-3.5-flash';
      this.providerName = 'Google Gemini';
      this.logger.info(`Gemini initialized (model: ${this.model})`);
    } catch (error) {
      this.logger.error('Failed to initialize Gemini:', error.message);
    }
  }

  async generateText(prompt, options = {}) {
    const retries = Math.max(0, Number.parseInt(options.retries ?? 2, 10) || 0);
    let lastError;

    for (let attempt = 0; attempt <= retries; attempt++) {
      try {
        return await this.generateTextOnce(prompt, options);
      } catch (error) {
        lastError = error;
        if (attempt >= retries || !this.isRetryableError(error)) {
          throw error;
        }

        const delayMs = Math.min(8000, 1500 * (2 ** attempt));
        this.logger.warn(
          `${this.providerName || 'AI provider'} is temporarily unavailable; ` +
          `retrying in ${delayMs / 1000}s (${attempt + 1}/${retries})`
        );
        await this.sleep(delayMs);
      }
    }

    throw lastError;
  }

  async generateJson(prompt, options = {}) {
    const jsonRetries = Math.max(0, Number.parseInt(options.jsonRetries ?? 2, 10) || 0);
    let lastError;

    for (let attempt = 0; attempt <= jsonRetries; attempt++) {
      try {
        const retryInstruction = attempt > 0
          ? '\nThe previous response was incomplete or invalid. Return one complete JSON object only.'
          : '';
        const response = await this.generateText(prompt + retryInstruction, {
          ...options,
          responseMimeType: 'application/json',
          responseJsonSchema: options.responseJsonSchema,
        });
        return this.parseJsonResponse(response);
      } catch (error) {
        lastError = error;
        if (attempt < jsonRetries) {
          this.logger.warn(
            `${this.providerName || 'AI provider'} returned unusable JSON; ` +
            `retrying (${attempt + 1}/${jsonRetries}): ${error.message}`
          );
        }
      }
    }

    throw lastError;
  }

  parseJsonResponse(response) {
    const text = String(response || '')
      .trim()
      .replace(/^```(?:json)?\s*/i, '')
      .replace(/```$/i, '')
      .trim();

    try {
      return JSON.parse(text);
    } catch (error) {
      const match = text.match(/\{[\s\S]*\}/);
      if (!match) throw error;
      return JSON.parse(match[0]);
    }
  }

  async generateTextOnce(prompt, options = {}) {
    const model = options.model || this.model;
    const maxTokens = options.maxTokens || 2048;
    const temperature = options.temperature ?? 0.7;

    if (this.gemini) {
      const config = { maxOutputTokens: maxTokens, temperature };
      for (const key of ['responseMimeType', 'responseSchema', 'responseJsonSchema']) {
        if (options[key] !== undefined) {
          config[key] = options[key];
        }
      }
      if (options.thinkingBudget !== undefined || options.thinkingLevel !== undefined) {
        config.thinkingConfig = {};
        if (options.thinkingBudget !== undefined) {
          config.thinkingConfig.thinkingBudget = options.thinkingBudget;
        }
        if (options.thinkingLevel !== undefined) {
          config.thinkingConfig.thinkingLevel = options.thinkingLevel;
        }
      }

      const compatibleConfigs = [config];
      if (maxTokens > 8192) {
        compatibleConfigs.push({ ...config, maxOutputTokens: 8192 });
      }
      if (config.responseJsonSchema || config.responseSchema) {
        const jsonModeConfig = { ...compatibleConfigs[compatibleConfigs.length - 1] };
        delete jsonModeConfig.responseJsonSchema;
        delete jsonModeConfig.responseSchema;
        compatibleConfigs.push(jsonModeConfig);
      }

      let response;
      let lastError;
      for (let attempt = 0; attempt < compatibleConfigs.length; attempt++) {
        try {
          response = await this.gemini.models.generateContent({
            model,
            contents: prompt,
            config: compatibleConfigs[attempt],
          });
          break;
        } catch (error) {
          lastError = error;
          const invalidArgument = Number(error?.status || error?.code) === 400 ||
            /INVALID_ARGUMENT|invalid argument/i.test(String(error?.message || error));
          if (!invalidArgument || attempt === compatibleConfigs.length - 1) {
            throw error;
          }

          const nextConfig = compatibleConfigs[attempt + 1];
          const adjustment = nextConfig.maxOutputTokens !== compatibleConfigs[attempt].maxOutputTokens
            ? `retrying with a compatible ${nextConfig.maxOutputTokens}-token output limit`
            : 'retrying in JSON mode with local schema validation';
          this.logger.warn(`Gemini rejected the request configuration; ${adjustment}`);
        }
      }
      if (!response) throw lastError;
      const text = response.text;
      const finishReason = response.candidates?.[0]?.finishReason;
      if (finishReason === 'MAX_TOKENS') {
        const error = new Error(
          `Gemini output was truncated at the configured token limit (${String(text || '').length} characters returned)`
        );
        error.code = 'AI_OUTPUT_TRUNCATED';
        throw error;
      }
      return text;
    }

    if (!this.client) {
      throw new Error('No AI text provider configured');
    }

    const response = await this.client.chat.completions.create({
      model,
      messages: [{ role: 'user', content: prompt }],
      max_tokens: maxTokens,
      temperature,
    });

    return response.choices[0].message.content;
  }

  isRetryableError(error) {
    const status = error?.status || error?.code || error?.response?.status;
    if ([429, 500, 502, 503, 504].includes(Number(status))) {
      return true;
    }

    const message = String(error?.message || error || '');
    return /\b(?:429|500|502|503|504)\b|high demand|temporar(?:y|ily)|unavailable|resource exhausted|rate limit/i.test(message);
  }

  sleep(milliseconds) {
    return new Promise(resolve => setTimeout(resolve, milliseconds));
  }

  isAvailable() {
    return !!(this.client || this.gemini);
  }
}

module.exports = { AITextService, PROVIDERS };
