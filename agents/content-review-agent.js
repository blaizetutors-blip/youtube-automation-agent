const path = require('path');
const fs = require('fs').promises;
const { Logger } = require('../utils/logger');
const { AITextService } = require('../utils/ai-text-service');
const { CHANNEL_PROFILE, isBiologyMode } = require('../config/blaize-biology');
const { evaluateBiologyStrategy, evaluateBiologyScript } = require('../utils/biology-quality-gate');

const REVIEW_RESPONSE_SCHEMA = {
  type: 'object',
  required: [
    'verdict',
    'summary',
    'issues',
    'claimsToVerify',
    'curriculumChecks',
    'practicalSafetyChecks',
    'pedagogyChecks',
    'retentionChecks',
    'visualAccuracyChecks',
    'assessmentChecks',
    'revisionActions'
  ],
  properties: {
    verdict: { type: 'string', enum: ['pass', 'needs_changes', 'block'] },
    summary: { type: 'string' },
    issues: { type: 'array', items: { type: 'string' } },
    claimsToVerify: { type: 'array', items: { type: 'string' } },
    curriculumChecks: { type: 'array', items: { type: 'string' } },
    practicalSafetyChecks: { type: 'array', items: { type: 'string' } },
    pedagogyChecks: { type: 'array', items: { type: 'string' } },
    retentionChecks: { type: 'array', items: { type: 'string' } },
    visualAccuracyChecks: { type: 'array', items: { type: 'string' } },
    assessmentChecks: { type: 'array', items: { type: 'string' } },
    revisionActions: { type: 'array', items: { type: 'string' } }
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
      pedagogyChecks: [],
      retentionChecks: [],
      visualAccuracyChecks: [],
      assessmentChecks: [],
      revisionActions: [],
      structuralIssues: [
        ...evaluateBiologyStrategy(strategy),
        ...evaluateBiologyScript(script)
      ],
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
        review.pedagogyChecks = this.normalizeList(parsed.pedagogyChecks);
        review.retentionChecks = this.normalizeList(parsed.retentionChecks);
        review.visualAccuracyChecks = this.normalizeList(parsed.visualAccuracyChecks);
        review.assessmentChecks = this.normalizeList(parsed.assessmentChecks);
        review.revisionActions = this.normalizeList(parsed.revisionActions);
      } catch (error) {
        review.summary = `Automated review failed: ${error.message}. Human review is required.`;
        this.logger.warn(review.summary);
      }
    }

    if (isBiologyMode() && review.structuralIssues.length > 0) {
      review.automatedVerdict = 'block';
      review.issues = [...review.structuralIssues, ...review.issues];
      review.summary = 'Blocked by the deterministic Biology teaching-quality gate.';
    } else if (isBiologyMode() && review.automatedVerdict === 'not_run') {
      review.automatedVerdict = 'block';
      review.issues.push('Automated scientific and pedagogical review did not run.');
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
  "practicalSafetyChecks": ["laboratory or health-safety check"],
  "pedagogyChecks": ["sequencing, modelling, guided practice or misconception check"],
  "retentionChecks": ["whether each attention reset advances learning and the opening promise is paid off"],
  "visualAccuracyChecks": ["diagram, relationship, scale, label, graph or practical-setup issue"],
  "assessmentChecks": ["alignment of diagnostic, guided and exit questions to objectives and mark logic"],
  "revisionActions": ["specific change required before production"]
}

Apply these rules:
- Flag factual errors, oversimplifications that become false, unsupported numbers and invented sources.
- Distinguish accepted school-level models from scientific nuance where necessary.
- Check definitions, units, process order, diagrams described in words and cause-and-effect claims.
- Flag medical diagnosis or treatment advice; the lesson must remain educational.
- For practical work, flag missing PPE, biological-material handling, heat, glassware, chemical and disposal precautions.
- Require a clear misconception check and at least one exam-style retrieval or application check.
- Reject generic hooks, empty suspense, clickbait, decorative visuals and unsupported claims.
- Check that the opening creates a genuine biological question and that the payoff resolves it.
- Check that attention resets occur through learning actions rather than noise.
- Audit every visual specification for scientific purpose, correct labels and relationships, suitable scale/abstraction and defensible animation order.
- Confirm that diagnostic, guided-practice and exit questions align to the objectives and include usable mark logic.
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
