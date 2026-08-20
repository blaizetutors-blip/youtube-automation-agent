const { Logger } = require('./logger');

const ACTIVE_STATUSES = ['queued', 'running', 'retry_wait'];
const TERMINAL_STATUSES = new Set(['completed', 'review_blocked', 'failed', 'cancelled']);

class GenerationJobManager {
  constructor(database, handler, options = {}) {
    this.db = database;
    this.handler = handler;
    this.logger = options.logger || new Logger('GenerationJobs');
    this.activeJobId = null;
    this.pending = new Set();
    this.timers = new Map();
    this.maxRetries = Math.max(
      1,
      Number.parseInt(process.env.GENERATION_JOB_MAX_RETRIES || options.maxRetries || '12', 10) || 12
    );
  }

  async initialize() {
    const jobs = await this.db.getGenerationJobs({ statuses: ACTIVE_STATUSES, limit: 100 });
    for (const job of jobs) {
      if (job.status === 'running') {
        await this.db.updateGenerationJob(job.id, {
          status: 'queued',
          stage: job.stage || 'queued',
          error: {
            code: 'PROCESS_RESTARTED',
            message: 'The server stopped while this job was active; resuming from its checkpoint.'
          }
        });
        this.enqueueExisting(job.id, 0);
        continue;
      }
      const delayMs = job.nextAttemptAt
        ? Math.max(0, new Date(job.nextAttemptAt).getTime() - Date.now())
        : 0;
      this.enqueueExisting(job.id, delayMs);
    }
    if (jobs.length > 0) {
      this.logger.info(`Recovered ${jobs.length} durable generation job(s)`);
    }
    return jobs.length;
  }

  async createJob(request) {
    const job = await this.db.createGenerationJob(request);
    this.enqueueExisting(job.id, 0);
    return job;
  }

  enqueueExisting(jobId, delayMs = 0) {
    if (!jobId || this.pending.has(jobId) || this.activeJobId === jobId) return;
    const existingTimer = this.timers.get(jobId);
    if (existingTimer) globalThis.clearTimeout(existingTimer);
    if (delayMs > 0) {
      const timer = setTimeout(() => {
        this.timers.delete(jobId);
        this.pending.add(jobId);
        this.drain().catch(error => this.logger.error('Generation queue failed:', error));
      }, delayMs);
      timer.unref?.();
      this.timers.set(jobId, timer);
      return;
    }
    this.pending.add(jobId);
    globalThis.setImmediate(() => {
      this.drain().catch(error => this.logger.error('Generation queue failed:', error));
    });
  }

  async drain() {
    if (this.activeJobId || this.pending.size === 0) return;
    const [jobId] = this.pending;
    this.pending.delete(jobId);
    this.activeJobId = jobId;
    try {
      await this.processJob(jobId);
    } finally {
      this.activeJobId = null;
      if (this.pending.size > 0) globalThis.setImmediate(() => this.drain());
    }
  }

  async processJob(jobId) {
    const job = await this.db.getGenerationJob(jobId);
    if (!job || TERMINAL_STATUSES.has(job.status)) return;

    const startedAt = job.startedAt || new Date().toISOString();
    await this.db.updateGenerationJob(jobId, {
      status: 'running',
      stage: job.stage === 'retry_wait' ? 'queued' : job.stage,
      progress: Math.max(1, Number(job.progress || 0)),
      message: 'Generation job is running',
      error: null,
      nextAttemptAt: null,
      startedAt
    });

    const reportProgress = async update => {
      const safeProgress = Math.max(0, Math.min(100, Number(update.progress || 0)));
      await this.db.updateGenerationJob(jobId, {
        status: 'running',
        stage: update.stage || 'running',
        progress: safeProgress,
        message: update.message || null,
        error: null
      });
    };

    try {
      const result = await this.handler(job.request, reportProgress);
      const finalStatus = result?.status === 'review_blocked' ? 'review_blocked' : 'completed';
      await this.db.updateGenerationJob(jobId, {
        status: finalStatus,
        stage: finalStatus,
        progress: 100,
        message: finalStatus === 'review_blocked'
          ? 'Generation completed but requires review corrections'
          : 'Generation completed successfully',
        result,
        error: null,
        nextAttemptAt: null,
        completedAt: new Date().toISOString()
      });
      this.logger.success(`Generation job ${jobId} ${finalStatus}`);
    } catch (error) {
      await this.handleFailure(job, error);
    }
  }

  async handleFailure(job, error) {
    const retryCount = Number(job.retryCount || 0) + 1;
    const retryable = this.isRetryable(error) && retryCount <= this.maxRetries;
    const errorDetails = {
      code: error.code || null,
      status: Number(error.status || error.response?.status) || null,
      message: String(error.message || error),
      retryable
    };

    if (!retryable) {
      await this.db.updateGenerationJob(job.id, {
        status: 'failed',
        stage: 'failed',
        message: 'Generation failed',
        error: errorDetails,
        retryCount,
        nextAttemptAt: null,
        completedAt: new Date().toISOString()
      });
      this.logger.error(`Generation job ${job.id} failed:`, error);
      return;
    }

    const delayMs = this.getRetryDelayMs(error, retryCount);
    const nextAttemptAt = new Date(Date.now() + delayMs).toISOString();
    await this.db.updateGenerationJob(job.id, {
      status: 'retry_wait',
      stage: 'retry_wait',
      message: `Waiting to retry at ${nextAttemptAt}`,
      error: { ...errorDetails, nextAttemptAt },
      retryCount,
      nextAttemptAt
    });
    this.logger.warn(
      `Generation job ${job.id} paused safely; retry ${retryCount}/${this.maxRetries} at ${nextAttemptAt}`
    );
    this.enqueueExisting(job.id, delayMs);
  }

  isRetryable(error) {
    const status = Number(error?.status || error?.response?.status);
    if ([408, 425, 429, 500, 502, 503, 504].includes(status)) return true;
    if ([
      'AI_PROVIDERS_TEMPORARILY_UNAVAILABLE',
      'GEMINI_MODELS_UNAVAILABLE',
      'GEMINI_DAILY_QUOTA_EXHAUSTED',
      'ECONNRESET',
      'ETIMEDOUT'
    ].includes(error?.code)) return true;
    return /high demand|temporar(?:y|ily) unavailable|rate limit|quota exceeded|resource exhausted|timeout/i
      .test(String(error?.message || error || ''));
  }

  getRetryDelayMs(error, retryCount) {
    const providerDelay = Number(error?.retryAfterMs || 0);
    if (Number.isFinite(providerDelay) && providerDelay >= 1000) return providerDelay;
    const baseMs = Math.max(
      1000,
      Number.parseInt(process.env.GENERATION_JOB_RETRY_BASE_MS || '60000', 10) || 60000
    );
    const capMs = Math.max(
      baseMs,
      Number.parseInt(process.env.GENERATION_JOB_RETRY_CAP_MS || '900000', 10) || 900000
    );
    return Math.min(capMs, baseMs * (2 ** Math.max(0, retryCount - 1)));
  }

  async retryJob(jobId) {
    const job = await this.db.getGenerationJob(jobId);
    if (!job) return null;
    if (!['failed', 'retry_wait'].includes(job.status)) return job;
    const updated = await this.db.updateGenerationJob(jobId, {
      status: 'queued',
      stage: 'queued',
      message: 'Manual retry queued',
      error: null,
      nextAttemptAt: null,
      completedAt: null
    });
    this.enqueueExisting(jobId, 0);
    return updated;
  }

  shutdown() {
    for (const timer of this.timers.values()) globalThis.clearTimeout(timer);
    this.timers.clear();
    this.pending.clear();
  }
}

module.exports = { GenerationJobManager, ACTIVE_STATUSES, TERMINAL_STATUSES };
