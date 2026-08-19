const path = require('path');
const fs = require('fs').promises;
const { Logger } = require('../utils/logger');
const { AITextService } = require('../utils/ai-text-service');
const { CHANNEL_PROFILE } = require('../config/blaize-biology');

const REVIEW_RESPONSE_SCHEMA = {
  type: 'object',
  required: [
    'verdict',
    'summary',
    'issues',
    'claimsToVerify',
    'curriculumChecks',
    'practicalSafetyChecks'
  ],
  properties: {
    verdict: { type: 'string', enum: ['pass', 'needs_changes', 'block'] },
    summary: { type: 'string' },
    issues: { type: 'array', items: { type: 'string' } },
    claimsToVerify: { type: 'array', items: { type: 'string' } },
    curriculumChecks: { type: 'array', items: { type: 'string' } },
    practicalSafetyChecks: { type: 'array', items: { type: 'string' } }
  }
};

class ContentReviewAgent {
  constructor(_db, credentials) {
    this.logger = new Logger('ContentReview');
    this.aiTextService = new AITextService(credentials?.credentials || credentials || {});
    this.reviewsPath = path.join(__dirname, '..', 'data', 'reviews');
  }

  async initialize() {
    await fs.mkdir(this.reviewsPath, { recursive: true });
    this.logger.info('Biology content review gate initialized');
    return true;
  }

  async reviewScript(strategy, script) {
    const review = {
      id: `review_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`,
      topic: strategy.topic,
      channel: CHANNEL_PROFILE.name,
      automatedVerdict: 'not_run',
      summary: 'Automated review was not available. A qualified human reviewer must check the script.',
      issues: [],
      claimsToVerify: [],
      curriculumChecks: [],
      practicalSafetyChecks: [],
      humanApprovalRequired: true,
      approved: false,
      createdAt: new Date().toISOString()
    };

    if (this.aiTextService.isAvailable()) {
      try {
        const parsed = await this.aiTextService.generateJson(this.buildPrompt(strategy, script), {
          maxTokens: 4096,
          temperature: 0.1,
          retries: 2,
          jsonRetries: 2,
          responseJsonSchema: REVIEW_RESPONSE_SCHEMA
        });
        review.automatedVerdict = this.normalizeVerdict(parsed.verdict);
        review.summary = String(parsed.summary || review.summary).trim();
        review.issues = this.normalizeList(parsed.issues);
        review.claimsToVerify = this.normalizeList(parsed.claimsToVerify);
        review.curriculumChecks = this.normalizeList(parsed.curriculumChecks);
        review.practicalSafetyChecks = this.normalizeList(parsed.practicalSafetyChecks);
      } catch (error) {
        review.summary = `Automated review failed: ${error.message}. Human review is required.`;
        this.logger.warn(review.summary);
      }
    }

    const reviewPath = path.join(this.reviewsPath, `${review.id}.json`);
    await fs.writeFile(reviewPath, JSON.stringify(review, null, 2));
    review.path = reviewPath;
    return review;
  }

  buildPrompt(strategy, script) {
    return `You are a cautious secondary-school Biology reviewer for Blaize Tutors.
Review the proposed lesson for WAEC, NECO, UTME/JAMB, IGCSE and GCSE learners.
Return only valid JSON with this exact shape:
{
  "verdict": "pass|needs_changes|block",
  "summary": "short review summary",
  "issues": ["specific factual, pedagogical or wording issue"],
  "claimsToVerify": ["claim that needs checking against a named textbook, syllabus or authoritative source"],
  "curriculumChecks": ["coverage or exam-alignment check"],
  "practicalSafetyChecks": ["laboratory or health-safety check"]
}

Apply these rules:
- Flag factual errors, oversimplifications that become false, unsupported numbers and invented sources.
- Distinguish accepted school-level models from scientific nuance where necessary.
- Check definitions, units, process order, diagrams described in words and cause-and-effect claims.
- Flag medical diagnosis or treatment advice; the lesson must remain educational.
- For practical work, flag missing PPE, biological-material handling, heat, glassware, chemical and disposal precautions.
- Require a clear misconception check and at least one exam-style retrieval or application check.
- Do not treat this automated pass as permission to publish. Human approval remains mandatory.

Topic: ${strategy.topic}
Angle: ${strategy.angle}
Audience: ${strategy.targetAudience}
Script:
${this.scriptText(script)}`;
  }

  scriptText(script) {
    if (script.fullScript) return String(script.fullScript).slice(0, 24000);
    return JSON.stringify(script).slice(0, 24000);
  }

  normalizeVerdict(value) {
    const verdict = String(value || '').toLowerCase();
    return ['pass', 'needs_changes', 'block'].includes(verdict) ? verdict : 'needs_changes';
  }

  normalizeList(value) {
    if (!Array.isArray(value)) return [];
    return value.map(item => String(item).trim()).filter(Boolean).slice(0, 20);
  }
}

module.exports = { ContentReviewAgent };
