const OpenAI = require('openai');
const { Logger } = require('./logger');

const geminiRequestTimesByModel = new Map();
const geminiDailyUnavailableUntil = new Map();
const geminiUnavailableUntil = new Map();
const providerUnavailableUntil = new Map();
const GEMINI_RATE_WINDOW_MS = 60000;
const DEFAULT_CIRCUIT_BREAKER_MS = 15 * 60 * 1000;
const MODEL_ACCESS_FAILURE_MS = 24 * 60 * 60 * 1000;

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
  groq: {
    name: 'Groq',
    baseURL: 'https://api.groq.com/openai/v1',
    defaultModel: 'llama-3.3-70b-versatile',
    models: ['llama-3.3-70b-versatile', 'openai/gpt-oss-120b', 'openai/gpt-oss-20b'],
    envKey: 'GROQ_API_KEY',
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
    this.providerRoutes = [];
    this.lastProviderUsed = null;

    this._init(credentials);
  }

  _init(credentials) {
    const registered = new Set();
    const registerOpenAICompatible = (provider, apiKey, model) => {
      if (!PROVIDERS[provider] || !apiKey || registered.has(provider)) return;
      const preset = PROVIDERS[provider];
      this.providerRoutes.push({
        id: provider,
        kind: 'openai-compatible',
        name: preset.name,
        model: model || preset.defaultModel,
        client: new OpenAI({ apiKey, baseURL: preset.baseURL })
      });
      registered.add(provider);
    };
    const registerGemini = (apiKey, model) => {
      if (!apiKey || registered.has('gemini')) return;
      try {
        const { GoogleGenAI } = require('@google/genai');
        this.providerRoutes.push({
          id: 'gemini',
          kind: 'gemini',
          name: 'Google Gemini',
          model: model || 'gemini-3.7-flash',
          client: new GoogleGenAI({ apiKey })
        });
        registered.add('gemini');
      } catch (error) {
        this.logger.error('Failed to initialize Gemini:', error.message);
      }
    };

    const selectedProvider = credentials.aiProvider?.provider;
    if (selectedProvider && PROVIDERS[selectedProvider] && credentials.aiProvider?.apiKey) {
      registerOpenAICompatible(
        selectedProvider,
        credentials.aiProvider.apiKey,
        credentials.aiProvider.model
      );
    }
    if (selectedProvider === 'gemini' && credentials.aiProvider?.apiKey) {
      registerGemini(credentials.aiProvider.apiKey, credentials.aiProvider.model);
    }

    if (credentials.gemini?.apiKey) {
      registerGemini(credentials.gemini.apiKey, credentials.gemini.model);
    }
    if (credentials.openai?.apiKey) {
      registerOpenAICompatible('openai', credentials.openai.apiKey, credentials.openai.model);
    }

    const configuredOrder = String(
      process.env.AI_PROVIDER_ORDER || 'gemini,groq,openai,openrouter,kimi,mimo,glm'
    ).split(',').map(value => value.trim().toLowerCase()).filter(Boolean);
    for (const provider of configuredOrder) {
      if (provider === 'gemini') {
        registerGemini(process.env.GEMINI_API_KEY);
      } else if (PROVIDERS[provider]) {
        registerOpenAICompatible(provider, process.env[PROVIDERS[provider].envKey]);
      }
    }
    for (const [provider, preset] of Object.entries(PROVIDERS)) {
      registerOpenAICompatible(provider, process.env[preset.envKey]);
    }

    const primary = this.providerRoutes[0];
    if (!primary) {
      this.logger.warn('No AI text provider configured — text generation unavailable');
      return;
    }
    this.model = primary.model;
    this.providerName = primary.name;
    if (primary.kind === 'gemini') this.gemini = primary.client;
    else this.client = primary.client;
    const routeSummary = this.providerRoutes.map(route => `${route.name}:${route.model}`).join(' -> ');
    this.logger.info(`AI provider route initialized (${routeSummary})`);
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
      this.model = model || 'gemini-3.7-flash';
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
        if (attempt >= retries || !this.shouldRetryInline(error)) {
          throw error;
        }

        const delayMs = this.getRetryDelayMs(error, attempt);
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
        if (this.isRetryableError(error)) {
          throw error;
        }
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
    const routes = this.getProviderRoutes(model);
    if (routes.length === 0) throw new Error('No AI text provider configured');

    let lastError;
    let soonestRetryAt = Number.POSITIVE_INFINITY;
    for (let index = 0; index < routes.length; index++) {
      const route = routes[index];
      const blockedUntil = providerUnavailableUntil.get(route.id) || 0;
      if (blockedUntil > Date.now()) {
        soonestRetryAt = Math.min(soonestRetryAt, blockedUntil);
        continue;
      }
      providerUnavailableUntil.delete(route.id);

      try {
        const result = route.kind === 'gemini'
          ? await this.generateWithGeminiRoute(prompt, route, maxTokens, temperature, options)
          : await this.generateOpenAICompatibleTextOnce(prompt, route, maxTokens, temperature);
        this.lastProviderUsed = { provider: route.name, model: route.model, at: new Date().toISOString() };
        this.providerName = route.name;
        return result;
      } catch (error) {
        lastError = error;
        if (!this.isRetryableError(error)) throw error;
        const retryAt = Date.now() + Math.max(
          this.getProviderCooldownMs(error),
          Number(error.retryAfterMs || 0)
        );
        providerUnavailableUntil.set(route.id, retryAt);
        soonestRetryAt = Math.min(soonestRetryAt, retryAt);
        const nextRoute = routes.slice(index + 1).find(candidate =>
          (providerUnavailableUntil.get(candidate.id) || 0) <= Date.now()
        );
        if (nextRoute) {
          this.logger.warn(`${route.name} is unavailable; switching this request to ${nextRoute.name}`);
        }
      }
    }

    const error = lastError || new Error('All configured AI providers are temporarily unavailable');
    error.code = error.code || 'AI_PROVIDERS_TEMPORARILY_UNAVAILABLE';
    if (Number.isFinite(soonestRetryAt)) {
      error.retryAfterMs = Math.max(1000, soonestRetryAt - Date.now());
    }
    throw error;
  }

  getProviderRoutes(modelOverride) {
    if (this.providerRoutes.length > 0) {
      return this.providerRoutes.map((route, index) => ({
        ...route,
        model: index === 0 && modelOverride ? modelOverride : route.model
      }));
    }
    if (this.gemini) {
      return [{
        id: 'gemini', kind: 'gemini', name: this.providerName || 'Google Gemini',
        model: modelOverride || this.model, client: this.gemini
      }];
    }
    if (this.client) {
      return [{
        id: 'primary', kind: 'openai-compatible', name: this.providerName || 'AI provider',
        model: modelOverride || this.model, client: this.client
      }];
    }
    return [];
  }

  async generateWithGeminiRoute(prompt, route, maxTokens, temperature, options) {
    const originalClient = this.gemini;
    this.gemini = route.client;
    let lastError;
    let soonestRetryAt = Number.POSITIVE_INFINITY;
    const candidates = this.getGeminiModelCandidates(route.model);
    try {
      for (const candidate of candidates) {
        const blockedUntil = Math.max(
          geminiDailyUnavailableUntil.get(candidate) || 0,
          geminiUnavailableUntil.get(candidate) || 0
        );
        if (blockedUntil > Date.now()) {
          soonestRetryAt = Math.min(soonestRetryAt, blockedUntil);
          continue;
        }
        geminiDailyUnavailableUntil.delete(candidate);
        geminiUnavailableUntil.delete(candidate);

        const transientRetries = Math.max(
          0,
          Number.parseInt(process.env.GEMINI_TRANSIENT_RETRIES_PER_MODEL || '1', 10) || 0
        );
        for (let attempt = 0; attempt <= transientRetries; attempt++) {
          try {
            const result = await this.generateGeminiTextOnce(
              prompt, candidate, maxTokens, temperature, options
            );
            route.model = candidate;
            return result;
          } catch (error) {
            lastError = error;
            if (this.isDailyQuotaError(error)) {
              const retryAt = this.getNextPacificMidnight();
              geminiDailyUnavailableUntil.set(candidate, retryAt);
              soonestRetryAt = Math.min(soonestRetryAt, retryAt);
              break;
            }
            if (this.isGeminiModelUnavailableError(error)) {
              const retryAt = Date.now() + MODEL_ACCESS_FAILURE_MS;
              geminiUnavailableUntil.set(candidate, retryAt);
              soonestRetryAt = Math.min(soonestRetryAt, retryAt);
              break;
            }
            if (!this.isGeminiTransientCapacityError(error)) throw error;
            if (attempt < transientRetries) {
              const delayMs = this.getRetryDelayMs(error, attempt);
              this.logger.warn(
                `Gemini ${candidate} is at capacity; retrying once in ${delayMs / 1000}s`
              );
              await this.sleep(delayMs);
              continue;
            }
            const retryAt = Date.now() + this.getProviderCooldownMs(error);
            geminiUnavailableUntil.set(candidate, retryAt);
            soonestRetryAt = Math.min(soonestRetryAt, retryAt);
          }
        }

        const nextModel = candidates.find(item => {
          const unavailableUntil = Math.max(
            geminiDailyUnavailableUntil.get(item) || 0,
            geminiUnavailableUntil.get(item) || 0
          );
          return item !== candidate && unavailableUntil <= Date.now();
        });
        if (nextModel) {
          this.logger.warn(`Gemini ${candidate} is unavailable; switching this request to ${nextModel}`);
        }
      }
    } finally {
      this.gemini = originalClient;
    }

    const allDaily = candidates.every(candidate =>
      (geminiDailyUnavailableUntil.get(candidate) || 0) > Date.now()
    );
    if (allDaily) {
      const quotaError = new Error(
        'All configured Gemini models have exhausted their daily request quotas. ' +
        'The validated checkpoint is preserved and the job will resume after quota reset.'
      );
      quotaError.status = 429;
      quotaError.code = 'GEMINI_DAILY_QUOTA_EXHAUSTED';
      quotaError.retryAfterMs = Math.max(1000, this.getNextPacificMidnight() - Date.now());
      throw quotaError;
    }

    const unavailableError = lastError || new Error('No configured Gemini model is currently available');
    unavailableError.code = unavailableError.code || 'GEMINI_MODELS_UNAVAILABLE';
    if (Number.isFinite(soonestRetryAt)) {
      unavailableError.retryAfterMs = Math.max(1000, soonestRetryAt - Date.now());
    }
    throw unavailableError;
  }

  async generateOpenAICompatibleTextOnce(prompt, route, maxTokens, temperature) {
    const response = await route.client.chat.completions.create({
      model: route.model,
      messages: [{ role: 'user', content: prompt }],
      max_tokens: maxTokens,
      temperature,
    });
    return response.choices[0].message.content;
  }

  async generateGeminiTextOnce(prompt, model, maxTokens, temperature, options) {
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
        await this.waitForGeminiRequestSlot(model);
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

  isRetryableError(error) {
    if (error?.code === 'AI_OUTPUT_TRUNCATED') return false;
    if (['AI_PROVIDERS_TEMPORARILY_UNAVAILABLE', 'GEMINI_MODELS_UNAVAILABLE', 'GEMINI_DAILY_QUOTA_EXHAUSTED'].includes(error?.code)) {
      return true;
    }
    const status = error?.status || error?.code || error?.response?.status;
    if ([429, 500, 502, 503, 504].includes(Number(status))) {
      return true;
    }

    const message = String(error?.message || error || '');
    return /\b(?:429|500|502|503|504)\b|high demand|temporar(?:y|ily)|unavailable|resource exhausted|rate limit/i.test(message);
  }

  shouldRetryInline(error) {
    // Aggregate failures have already exhausted every configured model/provider.
    // The durable job queue owns their longer wait so HTTP clients never have to.
    if ([
      'AI_PROVIDERS_TEMPORARILY_UNAVAILABLE',
      'GEMINI_MODELS_UNAVAILABLE',
      'GEMINI_DAILY_QUOTA_EXHAUSTED'
    ].includes(error?.code)) {
      return false;
    }
    return this.isRetryableError(error);
  }

  isDailyQuotaError(error) {
    const message = String(error?.message || error || '');
    return error?.code === 'GEMINI_DAILY_QUOTA_EXHAUSTED' ||
      /GenerateRequestsPerDay|RequestsPerDayPerProject|requests per day|daily request quota/i.test(message);
  }

  isGeminiModelUnavailableError(error) {
    const status = Number(error?.status || error?.code || error?.response?.status);
    const message = String(error?.message || error || '');
    return status === 404 ||
      ([400, 403].includes(status) && /model[\s\S]*(?:not found|not available|unsupported|does not exist|permission)/i.test(message));
  }

  isGeminiTransientCapacityError(error) {
    if (this.isDailyQuotaError(error)) return false;
    const status = Number(error?.status || error?.code || error?.response?.status);
    const message = String(error?.message || error || '');
    return [500, 502, 503, 504].includes(status) ||
      /high demand|temporar(?:y|ily) unavailable|service unavailable|overloaded|at capacity/i.test(message);
  }

  getGeminiModelCandidates(primaryModel = this.model) {
    const configuredFallbacks = process.env.GEMINI_FALLBACK_MODELS ||
      'gemini-3.7-flash,gemini-3.6-flash,gemini-3.5-flash';
    return [...new Set([
      String(primaryModel || 'gemini-3.7-flash').trim(),
      ...configuredFallbacks.split(',').map(item => item.trim()).filter(Boolean)
    ].filter(Boolean))];
  }

  getRetryDelayMs(error, attempt = 0) {
    const message = String(error?.message || error || '');
    const providerDelay = message.match(/retry(?:Delay)?["'\s:]*([\d.]+)s/i) ||
      message.match(/retry in ([\d.]+)s/i);
    if (providerDelay) {
      return Math.min(60000, Math.ceil(Number(providerDelay[1]) * 1000) + 750);
    }
    return Math.min(8000, 1500 * (2 ** attempt));
  }

  getProviderCooldownMs(error) {
    const configured = Number.parseInt(process.env.AI_PROVIDER_COOLDOWN_MS || '', 10);
    const fallback = Number.isFinite(configured) && configured >= 1000
      ? configured
      : DEFAULT_CIRCUIT_BREAKER_MS;
    const providerDelay = this.getRetryDelayMs(error, 0);
    return Math.max(fallback, providerDelay);
  }

  getNextPacificMidnight(now = new Date()) {
    const pacificDate = new Intl.DateTimeFormat('en-CA', {
      timeZone: 'America/Los_Angeles',
      year: 'numeric', month: '2-digit', day: '2-digit'
    }).format(now);
    const [year, month, day] = pacificDate.split('-').map(Number);
    const targetDay = new Date(Date.UTC(year, month - 1, day + 1));
    for (let hour = 7; hour <= 8; hour++) {
      const candidate = new Date(Date.UTC(
        targetDay.getUTCFullYear(), targetDay.getUTCMonth(), targetDay.getUTCDate(), hour
      ));
      const candidatePacificDate = new Intl.DateTimeFormat('en-CA', {
        timeZone: 'America/Los_Angeles',
        year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', hourCycle: 'h23'
      }).formatToParts(candidate).reduce((parts, part) => {
        parts[part.type] = part.value;
        return parts;
      }, {});
      if (
        Number(candidatePacificDate.year) === targetDay.getUTCFullYear() &&
        Number(candidatePacificDate.month) === targetDay.getUTCMonth() + 1 &&
        Number(candidatePacificDate.day) === targetDay.getUTCDate() &&
        Number(candidatePacificDate.hour) === 0
      ) return candidate.getTime();
    }
    return now.getTime() + 24 * 60 * 60 * 1000;
  }

  getHealthSnapshot() {
    const now = Date.now();
    return this.getProviderRoutes().map(route => ({
      provider: route.name,
      model: route.model,
      status: (providerUnavailableUntil.get(route.id) || 0) > now ? 'cooldown' : 'available',
      retryAt: (providerUnavailableUntil.get(route.id) || 0) > now
        ? new Date(providerUnavailableUntil.get(route.id)).toISOString()
        : null,
      lastUsed: this.lastProviderUsed?.provider === route.name ? this.lastProviderUsed.at : null
    }));
  }

  async waitForGeminiRequestSlot(model = this.model) {
    const configuredLimit = Number.parseInt(process.env.GEMINI_REQUESTS_PER_MINUTE || '5', 10);
    const requestsPerMinute = Number.isFinite(configuredLimit) && configuredLimit > 0
      ? configuredLimit
      : 5;
    const key = String(model || 'default');
    const timestamps = geminiRequestTimesByModel.get(key) || [];
    let announcedWait = false;

    while (true) {
      const now = Date.now();
      while (timestamps.length > 0 && now - timestamps[0] >= GEMINI_RATE_WINDOW_MS) {
        timestamps.shift();
      }
      if (timestamps.length < requestsPerMinute) {
        timestamps.push(now);
        geminiRequestTimesByModel.set(key, timestamps);
        return;
      }

      const waitMs = Math.max(250, GEMINI_RATE_WINDOW_MS - (now - timestamps[0]) + 750);
      if (!announcedWait) {
        this.logger.info(
          `Gemini free-tier pacing active: waiting ${Math.ceil(waitMs / 1000)}s ` +
          `before the next ${key} request (${requestsPerMinute} requests/minute)`
        );
        announcedWait = true;
      }
      await this.sleep(waitMs);
    }
  }

  sleep(milliseconds) {
    return new Promise(resolve => setTimeout(resolve, milliseconds));
  }

  isAvailable() {
    return !!(this.client || this.gemini);
  }
}

module.exports = { AITextService, PROVIDERS };
