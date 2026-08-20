const { Database } = require('./database/db');
const { Logger } = require('./utils/logger');
const { CredentialManager } = require('./utils/credential-manager');
const chalk = require('chalk');
const path = require('path');

class SystemTest {
  constructor() {
    this.logger = new Logger('SystemTest');
    this.testResults = {};
  }

  async runAllTests() {
    console.log(chalk.cyan.bold('\n🧪 YouTube Automation Agent - System Test'));
    console.log(chalk.gray('═'.repeat(60)));
    
    const tests = [
      { name: 'Database Connection', test: () => this.testDatabase() },
      { name: 'Production Persistence', test: () => this.testProductionPersistence() },
      { name: 'Automation Events Table', test: () => this.testAutomationEventsTable() },
      { name: 'API Validation and Security', test: () => this.testAPIValidationAndSecurity() },
      { name: 'Publishing Safety', test: () => this.testPublishingSafety() },
      { name: 'Multi-Provider Credential Validation', test: () => this.testCredentialValidation() },
      { name: 'Placeholder Scheduling Guard', test: () => this.testPlaceholderSchedulingGuard() },
      { name: 'FFmpeg Resolution', test: () => this.testFFmpegResolution() },
      { name: 'Gemini Media Provider Selection', test: () => this.testGeminiMediaProvider() },
      { name: 'Structured AI Generation Resilience', test: () => this.testStructuredAIGeneration() },
      { name: 'Markup Rendering Safety', test: () => this.testMarkupRenderingSafety() },
      { name: 'Slideshow Renderer', test: () => this.testSlideshowRenderer() },
      { name: 'Evergreen Template Topics', test: () => this.testEvergreenTopics() },
      { name: 'Blaize Biology Profile', test: () => this.testBlaizeBiologyProfile() },
      { name: 'Walkthrough Module', test: () => this.testWalkthroughModule() },
      { name: 'Logger System', test: () => this.testLogger() },
      { name: 'Directory Structure', test: () => this.testDirectories() },
      { name: 'Agent Loading', test: () => this.testAgentLoading() },
      { name: 'Configuration Files', test: () => this.testConfiguration() }
    ];

    let passed = 0;
    let failed = 0;

    for (const { name, test } of tests) {
      try {
        console.log(chalk.cyan(`\n🔍 Testing ${name}...`));
        await test();
        console.log(chalk.green(`✅ ${name} - PASSED`));
        this.testResults[name] = { status: 'PASSED' };
        passed++;
      } catch (error) {
        console.log(chalk.red(`❌ ${name} - FAILED`));
        console.log(chalk.red(`   Error: ${error.message}`));
        this.testResults[name] = { status: 'FAILED', error: error.message };
        failed++;
      }
    }

    // Display summary
    console.log(chalk.gray('\n' + '═'.repeat(60)));
    console.log(chalk.cyan.bold('📊 Test Summary:'));
    console.log(chalk.green(`✅ Passed: ${passed}`));
    console.log(chalk.red(`❌ Failed: ${failed}`));
    console.log(chalk.cyan(`📝 Total: ${passed + failed}`));

    if (failed === 0) {
      console.log(chalk.green.bold('\n🎉 All tests passed! System is ready to run.'));
      console.log(chalk.cyan('Run: npm start'));
    } else {
      console.log(chalk.yellow.bold('\n⚠️  Some tests failed. Please check the errors above.'));
      console.log(chalk.cyan('Run: npm run setup (to reconfigure)'));
    }

    return failed === 0;
  }

  async testDatabase() {
    const db = new Database();
    await db.initialize();
    
    // Test basic operations
    const stats = await db.getStats();
    if (!stats) throw new Error('Failed to get database stats');
    
    // Test settings
    await db.setSetting('test_key', 'test_value', 'Test setting');
    const value = await db.getSetting('test_key');
    if (value !== 'test_value') throw new Error('Settings read/write failed');
    
    await db.close();
    this.logger.info('Database test completed successfully');
  }

  async testProductionPersistence() {
    const db = new Database();
    await db.initialize();

    const production = {
      id: `prod_test_${Date.now()}`,
      status: 'processing',
      assets: { finalVideo: { path: 'placeholder.mp4' } },
      timeline: { created: new Date().toISOString() },
      scheduledPublishTime: new Date().toISOString(),
      priority: 25,
      estimatedDuration: '1:00'
    };

    const firstId = await db.saveProductionData(production);
    if (firstId !== production.id) {
      throw new Error('saveProductionData did not return the production id');
    }

    const secondId = await db.saveProductionData({
      ...production,
      status: 'ready',
      priority: 90
    });
    if (secondId !== production.id) {
      throw new Error('saveProductionData upsert did not return the production id');
    }

    const saved = await db.getRow('SELECT status, priority FROM productions WHERE id = ?', [production.id]);
    if (!saved || saved.status !== 'ready' || saved.priority !== 90) {
      throw new Error('saveProductionData did not upsert the existing production row');
    }

    await db.executeQuery('DELETE FROM productions WHERE id = ?', [production.id]);
    await db.close();
    this.logger.info('Production persistence test completed successfully');
  }

  async testAutomationEventsTable() {
    const db = new Database();
    await db.initialize();

    await db.executeQuery(
      'INSERT INTO automation_events (event_type, status, data, created_at) VALUES (?, ?, ?, datetime("now"))',
      ['test_event', 'success', JSON.stringify({ ok: true })]
    );

    const row = await db.getRow(
      'SELECT event_type, status, data FROM automation_events WHERE event_type = ? ORDER BY created_at DESC',
      ['test_event']
    );

    if (!row || row.status !== 'success') {
      throw new Error('automation_events row was not persisted');
    }

    await db.executeQuery('DELETE FROM automation_events WHERE event_type = ?', ['test_event']);
    await db.close();
    this.logger.info('Automation events table test completed successfully');
  }

  async testAPIValidationAndSecurity() {
    const { YouTubeAutomationAgent } = require('./index');
    const agent = new YouTubeAutomationAgent();

    if (typeof agent.validateGenerateRequestBody !== 'function') {
      throw new Error('validateGenerateRequestBody is not implemented');
    }
    if (typeof agent.requireAPIKey !== 'function') {
      throw new Error('requireAPIKey is not implemented');
    }

    const valid = agent.validateGenerateRequestBody({
      topic: 'Node automation',
      style: 'tutorial'
    });
    if (!valid.valid || valid.value.topic !== 'Node automation') {
      throw new Error('Valid generate request was rejected');
    }

    const invalidTopic = agent.validateGenerateRequestBody({ topic: 123 });
    if (invalidTopic.valid || invalidTopic.status !== 400) {
      throw new Error('Non-string topic was not rejected');
    }

    // The dashboard's "Generate Content Now" button sends an explicit null topic
    // to mean "pick a trending topic for me". null must be accepted, not rejected.
    const dashboardPayload = agent.validateGenerateRequestBody({ topic: null, style: 'story' });
    if (!dashboardPayload.valid) {
      throw new Error(`Dashboard generate payload was rejected: ${dashboardPayload.error}`);
    }
    if (dashboardPayload.value.topic !== null || dashboardPayload.value.style !== 'story') {
      throw new Error('Null topic was not normalised to an auto-selected topic');
    }

    const nullStyle = agent.validateGenerateRequestBody({ topic: 'Node automation', style: null });
    if (!nullStyle.valid || nullStyle.value.style !== null) {
      throw new Error('Null style was not accepted as "no style preference"');
    }

    const nullLength = agent.validateGenerateRequestBody({ topic: null, style: null, length: null });
    if (!nullLength.valid || nullLength.value.length !== 'medium') {
      throw new Error('Null length did not fall back to the default length');
    }

    const blankTopic = agent.validateGenerateRequestBody({ topic: '   ' });
    if (!blankTopic.valid || blankTopic.value.topic !== null) {
      throw new Error('Whitespace-only topic was not normalised to null');
    }

    const invalidStyle = agent.validateGenerateRequestBody({ style: 'x'.repeat(51) });
    if (invalidStyle.valid || invalidStyle.status !== 400) {
      throw new Error('Overlong style was not rejected');
    }

    const previousKey = process.env.API_KEY;
    process.env.API_KEY = 'test-secret';
    const middleware = agent.requireAPIKey();

    let rejectedNextCalled = false;
    const rejectedResponse = this.createMockResponse();
    middleware({ get: () => 'wrong-secret' }, rejectedResponse, () => {
      rejectedNextCalled = true;
    });

    if (rejectedNextCalled || rejectedResponse.statusCode !== 401) {
      throw new Error('Invalid API key was not rejected');
    }

    let acceptedNextCalled = false;
    const acceptedResponse = this.createMockResponse();
    middleware({ get: () => 'test-secret' }, acceptedResponse, () => {
      acceptedNextCalled = true;
    });

    if (!acceptedNextCalled || acceptedResponse.statusCode) {
      throw new Error('Valid API key was not accepted');
    }

    if (previousKey === undefined) {
      delete process.env.API_KEY;
    } else {
      process.env.API_KEY = previousKey;
    }

    this.logger.info('API validation and security test completed successfully');
  }

  createMockResponse() {
    return {
      statusCode: null,
      body: null,
      status(code) {
        this.statusCode = code;
        return this;
      },
      json(payload) {
        this.body = payload;
        return this;
      }
    };
  }

  createValidBiologyStrategy() {
    return {
      topic: 'Cell structure and organisation',
      angle: 'How cell structures cooperate to sustain life',
      targetAudience: 'Secondary-school learners',
      contentType: 'Explainer',
      seriesFormat: 'CONCEPT LAB',
      candidateAngles: [
        'Compare plant and animal cells',
        'Trace one cell function across organelles',
        'Correct organelle misconceptions through an exam problem'
      ],
      selectionRationale: 'Tracing a function creates a causal story and supports exam application.',
      coreQuestion: 'How do specialised structures allow a cell to function as a system?',
      lessonPromise: 'By the end, learners can link each named cell structure to its function and justify the link.',
      learningObjectives: ['Identify key structures', 'Explain structure-function links', 'Apply the model to an unfamiliar cell'],
      prerequisiteKnowledge: ['Cells are the basic units of life', 'Living processes require matter and energy'],
      misconceptions: ['The cell membrane is a solid wall; it is instead a selectively permeable boundary.'],
      examFocus: {
        commandWords: ['identify', 'explain'],
        skills: ['structure-function reasoning'],
        commonTraps: ['naming an organelle without linking it to the stated function']
      },
      retentionPlan: ['Opening prediction', '3D reveal', 'misconception decision', 'exam annotation'],
      visualPlan: ['3D cell overview', 'membrane close-up', 'organelle comparison', 'process link', 'exam annotation'],
      keywords: ['cell', 'organelle']
    };
  }

  createValidBiologyAIResponse() {
    const beats = ['diagnostic', 'phenomenon', 'model', 'guided_practice', 'misconception', 'exam_application', 'payoff'];
    return {
      title: 'How a Cell Works as One Organised System',
      hook: 'A cell stays alive only when its specialised parts cooperate—so what fails first when one part stops?',
      lessonPromise: 'You will be able to link cell structures to functions and earn explanation marks.',
      diagnosticQuestion: 'What is the difference between a cell and a tissue?',
      sections: beats.map((teachingBeat, index) => ({
        teachingBeat,
        title: `${teachingBeat.replace('_', ' ')} ${index + 1}`,
        content: [
          `This ${teachingBeat.replace('_', ' ')} beat develops an accurate structure-function link in the cell.`,
          `Use the labelled model to predict what changes when component ${index + 1} is altered.`
        ],
        visualSpec: {
          type: index === 5 ? 'exam_annotation' : 'labelled_diagram',
          template: index === 5 ? 'exam_annotation' : 'cell',
          title: `Cell structure model ${index + 1}`,
          elements: ['cell membrane', 'nucleus', 'mitochondrion'],
          relationships: ['Specialised structures support different cell functions.'],
          animationSteps: ['Reveal the cell boundary', 'Add and connect the organelles'],
          accuracyChecks: ['Confirm every structure-function link and spelling.'],
          modelLimitations: ['Organelles are schematic and are not shown to scale.']
        },
        retentionPurpose: 'Requires a prediction before the explanation is revealed.',
        duration: 55
      })),
      exitQuestion: {
        question: 'Explain why a cell with many mitochondria may require more energy.',
        commandWord: 'explain',
        marks: 2,
        modelAnswer: 'Mitochondria are the site of aerobic respiration, which releases energy for cell activities.',
        markScheme: ['links mitochondria to aerobic respiration', 'links respiration to energy release']
      },
      cta: 'Try the exit question before watching the next Biology lesson.'
    };
  }

  async testPublishingSafety() {
    const { PublishingSchedulingAgent } = require('./agents/publishing-scheduling-agent');
    const agent = new PublishingSchedulingAgent({
      updateScheduleEntry: async () => {}
    }, {});

    agent.publishQueue = [
      { productionId: 'prod-a', title: 'A', status: 'scheduled', metadata: {} },
      { productionId: 'prod-b', title: 'B', status: 'scheduled', metadata: {} }
    ];
    agent.uploadToYouTube = async () => ({ id: 'youtube-1' });

    await agent.publishContent('prod-a');

    if (agent.publishQueue.length !== 1 || agent.publishQueue[0].productionId !== 'prod-b') {
      throw new Error('publishContent removed the wrong publish queue entries');
    }

    let missingFileRejected = false;
    try {
      await agent.getVideoStream(path.join(__dirname, 'data', 'missing-placeholder.mp4'));
    } catch (error) {
      missingFileRejected = /video file not found/.test(error.message);
    }

    if (!missingFileRejected) {
      throw new Error('getVideoStream did not reject a missing video file');
    }

    this.logger.info('Publishing safety test completed successfully');
  }

  async testCredentialValidation() {
    const { PROVIDERS } = require('./utils/ai-text-service');
    const manager = new CredentialManager();

    // Isolate the test from any API keys set in the environment
    const envKeys = [...Object.values(PROVIDERS).map(p => p.envKey), 'GEMINI_API_KEY'];
    const savedEnv = {};
    for (const key of envKeys) {
      savedEnv[key] = process.env[key];
      delete process.env[key];
    }

    try {
      manager.credentials = { youtube: { client_id: 'x' }, gemini: { apiKey: 'gm-test' } };
      if (manager.getMissingCredentials().length !== 0) {
        throw new Error('Gemini-only configuration was incorrectly reported as missing credentials');
      }

      manager.credentials = { youtube: { client_id: 'x' }, aiProvider: { provider: 'openrouter', apiKey: 'sk-or-test' } };
      if (manager.getMissingCredentials().length !== 0) {
        throw new Error('OpenRouter configuration was incorrectly reported as missing credentials');
      }

      manager.credentials = { youtube: { client_id: 'x' } };
      const missingProvider = manager.getMissingCredentials();
      if (missingProvider.length !== 1 || !/AI provider/.test(missingProvider[0])) {
        throw new Error('Missing AI provider was not detected');
      }

      manager.credentials = { openai: { apiKey: 'sk-test' } };
      const missingYouTube = manager.getMissingCredentials();
      if (missingYouTube.length !== 1 || missingYouTube[0] !== 'youtube') {
        throw new Error('Missing YouTube credentials were not detected');
      }
    } finally {
      for (const key of envKeys) {
        if (savedEnv[key] === undefined) {
          delete process.env[key];
        } else {
          process.env[key] = savedEnv[key];
        }
      }
    }

    this.logger.info('Credential validation test completed successfully');
  }

  async testPlaceholderSchedulingGuard() {
    const { PublishingSchedulingAgent } = require('./agents/publishing-scheduling-agent');
    const agent = new PublishingSchedulingAgent({
      saveScheduleEntry: async () => {}
    }, {});

    const simulated = await agent.scheduleContent({
      id: 'prod-simulated',
      status: 'simulated',
      script: { title: 'Simulated' },
      assets: { finalVideo: { path: 'video.mp4.assembly.json', simulated: true } }
    });
    if (simulated !== null) {
      throw new Error('Simulated production was scheduled for publishing');
    }

    const missingVideo = await agent.scheduleContent({
      id: 'prod-missing',
      status: 'ready',
      script: { title: 'Missing' },
      assets: {}
    });
    if (missingVideo !== null) {
      throw new Error('Production without a final video was scheduled for publishing');
    }

    const missingNarration = await agent.scheduleContent({
      id: 'prod-no-narration',
      status: 'needs_narration',
      script: { title: 'Silent' },
      assets: { finalVideo: { path: 'silent-video.mp4' } }
    });
    if (missingNarration !== null) {
      throw new Error('Production without narration was scheduled for publishing');
    }

    const real = await agent.scheduleContent({
      id: 'prod-real',
      status: 'ready',
      script: { title: 'Real' },
      priority: 50,
      scheduledPublishTime: new Date().toISOString(),
      assets: { finalVideo: { path: 'video.mp4' }, thumbnail: {}, captions: {} },
      seo: {}
    });
    if (!real || agent.publishQueue.length !== 1) {
      throw new Error('Real production was not scheduled for publishing');
    }

    this.logger.info('Placeholder scheduling guard test completed successfully');
  }

  async testFFmpegResolution() {
    const { getFFmpegPath, checkFFmpeg, ffmpegInstallHint } = require('./utils/ffmpeg');

    const ffmpegPath = getFFmpegPath();
    if (typeof ffmpegPath !== 'string' || ffmpegPath.length === 0) {
      throw new Error('getFFmpegPath did not return a usable path');
    }

    const available = await checkFFmpeg();
    if (typeof available !== 'boolean') {
      throw new Error('checkFFmpeg did not return a boolean');
    }

    if (!/FFmpeg/i.test(ffmpegInstallHint())) {
      throw new Error('ffmpegInstallHint did not return install guidance');
    }

    this.logger.info(`FFmpeg resolution test completed (binary: ${ffmpegPath}, available: ${available})`);
  }

  async testGeminiMediaProvider() {
    const { AIVideoGenerator } = require('./utils/ai-video-generator');

    const envKeys = ['OPENAI_API_KEY', 'GEMINI_API_KEY', 'REPLICATE_API_KEY', 'ELEVENLABS_API_KEY'];
    const savedEnv = {};
    for (const key of envKeys) {
      savedEnv[key] = process.env[key];
      delete process.env[key];
    }

    try {
      const geminiOnly = new AIVideoGenerator({ gemini: { apiKey: 'test-key' } });
      if (!geminiOnly.gemini) {
        throw new Error('Gemini media service was not initialized from gemini credentials');
      }
      if (geminiOnly.openai) {
        throw new Error('OpenAI client initialized without a key');
      }

      const longNarration = `${'First sentence explains cells clearly. '.repeat(90)}Final sentence.`;
      const chunks = geminiOnly.splitTextForTTS(longNarration, 240);
      if (chunks.length < 2 || chunks.some(chunk => chunk.length > 240)) {
        throw new Error('Long Gemini narration was not split into bounded chunks');
      }

      let ttsCalls = 0;
      geminiOnly.gemini = {
        models: {
          generateContent: async () => {
            ttsCalls++;
            if (ttsCalls === 1) {
              const error = new Error('503 high demand');
              error.status = 503;
              throw error;
            }
            return {
              candidates: [{ content: { parts: [{ inlineData: { data: Buffer.from('pcm').toString('base64') } }] } }]
            };
          }
        }
      };
      geminiOnly.sleep = async () => {};
      const pcm = await geminiOnly.generateGeminiTTSChunk({
        text: 'Test narration',
        model: 'test-model',
        voiceName: 'Kore',
        chunkNumber: 1,
        totalChunks: 1,
        retries: 1
      });
      if (pcm.toString() !== 'pcm' || ttsCalls !== 2) {
        throw new Error('Transient Gemini TTS failure was not retried successfully');
      }

      const none = new AIVideoGenerator({});
      if (none.gemini || none.openai) {
        throw new Error('Media services initialized without any credentials');
      }
    } finally {
      for (const key of envKeys) {
        if (savedEnv[key] === undefined) {
          delete process.env[key];
        } else {
          process.env[key] = savedEnv[key];
        }
      }
    }

    this.logger.info('Gemini media provider selection test completed successfully');
  }

  async testStructuredAIGeneration() {
    const { AITextService } = require('./utils/ai-text-service');
    const { ContentStrategyAgent } = require('./agents/content-strategy-agent');
    const { ScriptWriterAgent } = require('./agents/script-writer-agent');
    const { ContentReviewAgent } = require('./agents/content-review-agent');
    const fs = require('fs').promises;
    const os = require('os');

    const service = new AITextService({});
    let providerCalls = 0;
    service.gemini = {
      models: {
        generateContent: async request => {
          providerCalls++;
          if (providerCalls === 1) {
            const error = new Error('503 high demand');
            error.status = 503;
            throw error;
          }
          if (request.config.responseMimeType !== 'application/json' || !request.config.responseJsonSchema) {
            throw new Error('Structured Gemini configuration was not forwarded');
          }
          if (request.config.thinkingConfig?.thinkingBudget !== 0) {
            throw new Error('Gemini thinking budget was not forwarded');
          }
          return { text: '{"ok":true}' };
        }
      }
    };
    service.model = 'test-gemini';
    service.providerName = 'Test Gemini';
    service.sleep = async () => {};
    let requestSlotCalls = 0;
    service.waitForGeminiRequestSlot = async () => { requestSlotCalls++; };

    const retryResult = await service.generateText('Return JSON', {
      retries: 1,
      thinkingBudget: 0,
      responseMimeType: 'application/json',
      responseJsonSchema: { type: 'object' }
    });
    if (retryResult !== '{"ok":true}' || providerCalls !== 2 || requestSlotCalls !== 2) {
      throw new Error('Transient Gemini failure was not retried successfully');
    }

    const quotaError = new Error('429 RESOURCE_EXHAUSTED. Please retry in 19.65s.');
    quotaError.status = 429;
    const quotaDelay = service.getRetryDelayMs(quotaError, 0);
    if (quotaDelay < 20000 || quotaDelay > 21000) {
      throw new Error('Gemini RetryInfo delay was not honoured');
    }

    const previousGeminiLimit = process.env.GEMINI_REQUESTS_PER_MINUTE;
    const originalDateNow = Date.now;
    let fakeNow = 100000;
    let pacingWaitMs = 0;
    try {
      process.env.GEMINI_REQUESTS_PER_MINUTE = '1';
      Date.now = () => fakeNow;
      const limiterService = new AITextService({});
      limiterService.sleep = async milliseconds => {
        pacingWaitMs += milliseconds;
        fakeNow += milliseconds;
      };
      await limiterService.waitForGeminiRequestSlot('rate-limiter-test-model');
      await limiterService.waitForGeminiRequestSlot('rate-limiter-test-model');
    } finally {
      Date.now = originalDateNow;
      if (previousGeminiLimit === undefined) delete process.env.GEMINI_REQUESTS_PER_MINUTE;
      else process.env.GEMINI_REQUESTS_PER_MINUTE = previousGeminiLimit;
    }
    if (pacingWaitMs < 60000) {
      throw new Error('Gemini rolling request budget did not pace the next request');
    }

    const truncationService = new AITextService({});
    truncationService.gemini = {
      models: {
        generateContent: async () => ({
          text: '{"partial":"response',
          candidates: [{ finishReason: 'MAX_TOKENS' }]
        })
      }
    };
    truncationService.model = 'test-gemini';
    truncationService.waitForGeminiRequestSlot = async () => {};
    let truncationDetected = false;
    try {
      await truncationService.generateTextOnce('Return JSON', { maxTokens: 64 });
    } catch (error) {
      truncationDetected = error.code === 'AI_OUTPUT_TRUNCATED' && /truncated/i.test(error.message);
    }
    if (!truncationDetected) {
      throw new Error('Gemini MAX_TOKENS response was not identified as truncation');
    }

    const compatibilityService = new AITextService({});
    const compatibilityRequests = [];
    compatibilityService.gemini = {
      models: {
        generateContent: async request => {
          compatibilityRequests.push(request.config);
          if (request.config.responseJsonSchema) {
            const error = new Error('Request contains an invalid argument.');
            error.status = 400;
            throw error;
          }
          return { text: '{"compatible":true}' };
        }
      }
    };
    compatibilityService.model = 'test-gemini';
    compatibilityService.providerName = 'Test Gemini';
    compatibilityService.waitForGeminiRequestSlot = async () => {};
    const compatibilityResult = await compatibilityService.generateTextOnce('Return JSON', {
      maxTokens: 12288,
      thinkingBudget: 0,
      responseMimeType: 'application/json',
      responseJsonSchema: { type: 'object' }
    });
    if (
      compatibilityResult !== '{"compatible":true}' || compatibilityRequests.length !== 3 ||
      compatibilityRequests[1].maxOutputTokens !== 8192 ||
      compatibilityRequests[2].responseJsonSchema !== undefined
    ) {
      throw new Error('Gemini request configuration was not downgraded safely');
    }

    const jsonService = new AITextService({});
    let jsonCalls = 0;
    let jsonOptions;
    jsonService.providerName = 'Test Gemini';
    jsonService.generateText = async (_prompt, options) => {
      jsonCalls++;
      jsonOptions = options;
      return jsonCalls === 1 ? '{"verdict":"pass"' : '{"verdict":"pass"}';
    };
    const parsedJson = await jsonService.generateJson('Review this lesson', {
      jsonRetries: 1,
      responseJsonSchema: { type: 'object' }
    });
    if (jsonCalls !== 2 || parsedJson.verdict !== 'pass') {
      throw new Error('Malformed structured JSON was not retried successfully');
    }
    if (jsonOptions.responseMimeType !== 'application/json' || !jsonOptions.responseJsonSchema) {
      throw new Error('Structured JSON configuration was not enforced');
    }

    const quotaJsonService = new AITextService({});
    let quotaJsonCalls = 0;
    quotaJsonService.generateText = async () => {
      quotaJsonCalls++;
      const error = new Error('429 RESOURCE_EXHAUSTED');
      error.status = 429;
      throw error;
    };
    let quotaPropagated = false;
    try {
      await quotaJsonService.generateJson('Return JSON', { jsonRetries: 2 });
    } catch (error) {
      quotaPropagated = error.status === 429;
    }
    if (!quotaPropagated || quotaJsonCalls !== 1) {
      throw new Error('Gemini quota exhaustion was misclassified as malformed JSON');
    }

    const previousFallbackModels = process.env.GEMINI_FALLBACK_MODELS;
    try {
      process.env.GEMINI_FALLBACK_MODELS = 'test-fallback';
      const modelFallbackService = new AITextService({});
      const attemptedModels = [];
      modelFallbackService.model = 'test-daily-primary';
      modelFallbackService.providerName = 'Test Gemini';
      modelFallbackService.waitForGeminiRequestSlot = async () => {};
      modelFallbackService.gemini = {
        models: {
          generateContent: async request => {
            attemptedModels.push(request.model);
            if (request.model === 'test-daily-primary') {
              const error = new Error(
                'Quota exceeded: GenerateRequestsPerDayPerProjectPerModel-FreeTier'
              );
              error.status = 429;
              throw error;
            }
            return { text: '{"fallback":true}' };
          }
        }
      };
      const fallbackResult = await modelFallbackService.generateText('Return JSON', { retries: 2 });
      if (
        fallbackResult !== '{"fallback":true}' ||
        attemptedModels.join(',') !== 'test-daily-primary,test-fallback'
      ) {
        throw new Error('Gemini daily quota did not switch to the configured fallback model');
      }

      process.env.GEMINI_FALLBACK_MODELS = 'test-available-fallback';
      const unavailableFallbackService = new AITextService({});
      const availabilityAttempts = [];
      unavailableFallbackService.model = 'test-unavailable-primary';
      unavailableFallbackService.waitForGeminiRequestSlot = async () => {};
      unavailableFallbackService.gemini = {
        models: {
          generateContent: async request => {
            availabilityAttempts.push(request.model);
            if (request.model === 'test-unavailable-primary') {
              const error = new Error('Requested model was not found for this project');
              error.status = 404;
              throw error;
            }
            return { text: 'available' };
          }
        }
      };
      const availabilityResult = await unavailableFallbackService.generateText('Continue');
      if (
        availabilityResult !== 'available' ||
        availabilityAttempts.join(',') !== 'test-unavailable-primary,test-available-fallback'
      ) {
        throw new Error('Unavailable Gemini model did not switch to the next configured fallback');
      }

      process.env.GEMINI_FALLBACK_MODELS = 'test-exhausted-fallback';
      const exhaustedService = new AITextService({});
      let exhaustedCalls = 0;
      let exhaustedSleeps = 0;
      exhaustedService.model = 'test-exhausted-primary';
      exhaustedService.providerName = 'Test Gemini';
      exhaustedService.waitForGeminiRequestSlot = async () => {};
      exhaustedService.sleep = async () => { exhaustedSleeps++; };
      exhaustedService.gemini = {
        models: {
          generateContent: async () => {
            exhaustedCalls++;
            const error = new Error(
              'Quota exceeded: GenerateRequestsPerDayPerProjectPerModel-FreeTier'
            );
            error.status = 429;
            throw error;
          }
        }
      };
      let dailyQuotaPropagated = false;
      try {
        await exhaustedService.generateText('Return JSON', { retries: 2 });
      } catch (error) {
        dailyQuotaPropagated = exhaustedService.isDailyQuotaError(error);
      }
      if (!dailyQuotaPropagated || exhaustedCalls !== 2 || exhaustedSleeps !== 0) {
        throw new Error('Exhausted Gemini daily quotas triggered pointless timed retries');
      }
    } finally {
      if (previousFallbackModels === undefined) delete process.env.GEMINI_FALLBACK_MODELS;
      else process.env.GEMINI_FALLBACK_MODELS = previousFallbackModels;
    }

    const reviewDir = await fs.mkdtemp(path.join(os.tmpdir(), 'yaa-review-'));
    try {
      const reviewer = new ContentReviewAgent(null, {});
      reviewer.reviewsPath = reviewDir;
      let reviewOptions;
      reviewer.aiTextService = {
        isAvailable: () => true,
        generateJson: async (_prompt, options) => {
          reviewOptions = options;
          return {
            verdict: 'pass',
            summary: 'No blocking issue found.',
            issues: [],
            claimsToVerify: [],
            curriculumChecks: ['Cell organisation covered.'],
            practicalSafetyChecks: [],
            pedagogyChecks: ['Teaching sequence is coherent.'],
            retentionChecks: ['Prediction advances the explanation.'],
            visualAccuracyChecks: ['Model limitation is disclosed.'],
            assessmentChecks: ['Exit task aligns to the lesson promise.'],
            revisionActions: []
          };
        }
      };
      const aiResponse = this.createValidBiologyAIResponse();
      const review = await reviewer.reviewScript(
        this.createValidBiologyStrategy(),
        {
          ...aiResponse,
          hook: { text: aiResponse.hook },
          mainContent: { sections: aiResponse.sections },
          fullScript: 'A complete, structured cell lesson.'
        }
      );
      if (review.automatedVerdict !== 'pass') {
        throw new Error('Structured Biology review result was not accepted');
      }
      if (
        !reviewOptions.responseJsonSchema || reviewOptions.maxTokens < 8192 ||
        reviewOptions.jsonRetries < 2 || reviewOptions.thinkingBudget !== 0
      ) {
        throw new Error('Biology review did not request resilient schema-constrained JSON');
      }
    } finally {
      await fs.rm(reviewDir, { recursive: true, force: true }).catch(() => {});
    }

    const previousMode = process.env.BLAIZE_BIOLOGY_MODE;
    process.env.BLAIZE_BIOLOGY_MODE = 'true';
    try {
      const strategist = new ContentStrategyAgent(null, {});
      const strategyOptions = [];
      let strategyCalls = 0;
      strategist.aiTextService = {
        isAvailable: () => true,
        providerName: 'Test Gemini',
        generateJson: async (_prompt, options) => {
          strategyCalls++;
          strategyOptions.push(options);
          if (strategyCalls === 1) {
            return {
              candidateAngles: this.createValidBiologyStrategy().candidateAngles,
              selectedAngle: this.createValidBiologyStrategy().angle,
              selectionRationale: this.createValidBiologyStrategy().selectionRationale,
              coreQuestion: this.createValidBiologyStrategy().coreQuestion,
              lessonPromise: this.createValidBiologyStrategy().lessonPromise
            };
          }
          return this.createValidBiologyStrategy();
        }
      };
      const strategy = await strategist.generateContentStrategyWithAI('Cell structure and organisation');
      if (!strategy || strategyCalls !== 2 || strategy.candidateAngles.length < 3) {
        throw new Error('Biology strategy did not complete staged brainstorm and blueprint generation');
      }
      if (
        strategyOptions.some(options => options.thinkingBudget !== 0) ||
        strategyOptions[1].maxTokens < 8192
      ) {
        throw new Error('Biology strategy did not request a resilient Gemini output budget');
      }

      const writer = new ScriptWriterAgent({ saveScript: async () => {} }, {});
      writer.checkpointsPath = await fs.mkdtemp(path.join(os.tmpdir(), 'yaa-script-checkpoints-'));
      const validResponse = this.createValidBiologyAIResponse();
      const outline = {
        title: validResponse.title,
        hook: validResponse.hook,
        lessonPromise: validResponse.lessonPromise,
        diagnosticQuestion: validResponse.diagnosticQuestion,
        sections: validResponse.sections.map(section => ({
          teachingBeat: section.teachingBeat,
          title: section.title,
          purpose: `Develop the ${section.teachingBeat} stage of the driving question.`,
          keyIdeas: ['Accurate structure-function relationship', 'Application to a new cell context'],
          visualIntent: section.visualSpec.title,
          retentionPurpose: section.retentionPurpose
        })),
        exitQuestion: validResponse.exitQuestion,
        cta: validResponse.cta
      };
      let scriptCalls = 0;
      let repairedModelSection = false;
      const scriptPrompts = [];
      const structuredOptions = [];
      writer.aiTextService = {
        isAvailable: () => true,
        providerName: 'Test Gemini',
        generateJson: async (scriptPrompt, options) => {
          scriptCalls++;
          scriptPrompts.push(scriptPrompt);
          structuredOptions.push(options);
          if (scriptPrompt.includes('seven-part lesson architecture')) return outline;

          const sectionNumber = Number(scriptPrompt.match(/section (\d+) of/i)?.[1] || 1);
          const source = validResponse.sections[sectionNumber - 1];
          if (source.teachingBeat === 'model' && !repairedModelSection) {
            repairedModelSection = true;
            return {
              ...source,
              content: source.content.slice(0, 1),
              visualSpec: { ...source.visualSpec, modelLimitations: [] }
            };
          }
          return source;
        }
      };

      const biologyStrategy = this.createValidBiologyStrategy();
      const script = await writer.generateScriptWithAI(biologyStrategy, writer.templates.explainer);

      if (!script || scriptCalls !== 9 || script.mainContent.sections.length !== 7) {
        throw new Error('Staged Biology script was not generated and repaired section by section');
      }
      if (structuredOptions.some(options => options.thinkingBudget !== 0 || !options.responseJsonSchema)) {
        throw new Error('Staged script writer did not request schema-constrained Gemini JSON');
      }
      if (
        !scriptPrompts[0].includes('Driving question:') ||
        !scriptPrompts[0].includes('Misconceptions:') ||
        !scriptPrompts[0].includes('Instructional visual plan:')
      ) {
        throw new Error('Staged script writer did not receive the complete Biology strategy blueprint');
      }
      if (
        !scriptPrompts.some(prompt => prompt.includes('previous section failed validation')) ||
        !scriptPrompts.some(prompt => prompt.includes('needs at least two substantive spoken-script beats')) ||
        !scriptPrompts.some(prompt => prompt.includes("does not disclose the model's limitations or scale"))
      ) {
        throw new Error('Targeted section repair did not include actionable validation feedback');
      }

      const callsBeforeResume = scriptCalls;
      const refreshedStrategy = { ...biologyStrategy, angle: 'A differently worded retry angle' };
      const resumedScript = await writer.generateScriptWithAI(refreshedStrategy, writer.templates.explainer);
      if (
        !resumedScript || scriptCalls !== callsBeforeResume ||
        resumedScript.metadata.generationSource !== 'staged_ai' ||
        resumedScript.metadata.strategy.angle !== biologyStrategy.angle
      ) {
        throw new Error('Validated Biology script checkpoint was not resumed without repeat AI calls');
      }
      await fs.rm(writer.checkpointsPath, { recursive: true, force: true });
    } finally {
      if (previousMode === undefined) delete process.env.BLAIZE_BIOLOGY_MODE;
      else process.env.BLAIZE_BIOLOGY_MODE = previousMode;
    }

    this.logger.info('Structured AI generation resilience test completed successfully');
  }

  async testMarkupRenderingSafety() {
    const fs = require('fs').promises;
    const os = require('os');
    const sharp = require('sharp');
    const { ThumbnailDesignerAgent } = require('./agents/thumbnail-designer-agent');
    const { ProductionManagementAgent } = require('./agents/production-management-agent');
    const { AIVideoGenerator } = require('./utils/ai-video-generator');

    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'yaa-markup-'));
    let renderedThumbnail;
    try {
      const baseImage = path.join(dir, 'base.png');
      await sharp({
        create: { width: 1280, height: 720, channels: 3, background: '#062C2A' }
      }).png().toFile(baseImage);

      const thumbnails = new ThumbnailDesignerAgent({ saveThumbnail: async () => {} }, {});
      await thumbnails.ensureTemplatesDirectory();
      if (thumbnails.hexToRgb('#062C2A') !== '#062C2A') {
        throw new Error('Blaize hex brand colours were not preserved');
      }
      renderedThumbnail = await thumbnails.addTextOverlay(baseImage, {
        primaryText: 'WAEC & GCSE <CELLS>',
        secondaryText: 'STRUCTURE & ORGANISATION',
        colors: { accent: '#FFD54A' }
      });
      const thumbnailStats = await fs.stat(renderedThumbnail);
      if (!thumbnailStats.size) {
        throw new Error('XML-safe thumbnail overlay was not rendered');
      }

      const placeholderPath = path.join(dir, 'thumbnail.info');
      await fs.writeFile(placeholderPath, 'placeholder');
      const production = new ProductionManagementAgent({}, {});
      production.aiVideoGenerator.generateThumbnail = async () => ({ path: placeholderPath });
      production.applyBrandMark = async imagePath => imagePath;
      const selectedThumbnail = await production.processThumbnail(
        { path: baseImage, dimensions: { width: 1280, height: 720 } },
        { title: 'Cells & Tissues' }
      );
      if (selectedThumbnail.path !== baseImage || selectedThumbnail.generatedWith !== 'Blaize heritage fallback') {
        throw new Error('Placeholder thumbnail was not replaced by the usable heritage image');
      }

      const video = new AIVideoGenerator({});
      const script = {
        title: 'Cells & Tissues <script>alert(1)</script>',
        hook: { text: 'Cells are organised.' },
        introduction: { greeting: 'Welcome', topicIntro: 'Cell organisation' },
        mainContent: {
          sections: [{
            title: 'Plant & Animal Cells',
            content: [
              'The cell membrane controls movement into & out of the cell.',
              'A tissue is a group of similar cells carrying out a function.',
              new Array(120).fill('cell').join(' ')
            ]
          }]
        },
        conclusion: { finalThought: 'Organisation supports function.' }
      };
      const html = video.createSlideshowHTML(script, []);
      if (html.includes('<script>alert(1)</script>') || !html.includes('&amp;') || !html.includes('&lt;script&gt;')) {
        throw new Error('Slideshow text was not safely HTML-escaped');
      }
      if (!html.includes('cell membrane controls movement')) {
        throw new Error('AI bullet content was not rendered on slides');
      }
      if (video.calculateScriptDuration(script) <= 30) {
        throw new Error('AI bullet content was excluded from slideshow duration');
      }
    } finally {
      if (renderedThumbnail) await fs.unlink(renderedThumbnail).catch(() => {});
      await fs.rm(dir, { recursive: true, force: true }).catch(() => {});
    }

    this.logger.info('Markup rendering safety test completed successfully');
  }

  async testSlideshowRenderer() {
    const { AIVideoGenerator } = require('./utils/ai-video-generator');
    const { checkFFmpeg } = require('./utils/ffmpeg');
    const fs = require('fs').promises;
    const os = require('os');

    if (!(await checkFFmpeg())) {
      this.logger.warn('FFmpeg unavailable — skipping slideshow renderer test');
      return;
    }

    const sharp = require('sharp');
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'yaa-slides-'));

    try {
      const stills = [];
      for (let i = 0; i < 3; i++) {
        const stillPath = path.join(dir, `slide_${i}.png`);
        await sharp({
          create: { width: 320, height: 180, channels: 3, background: { r: 60 * i, g: 80, b: 160 } }
        }).png().toFile(stillPath);
        stills.push(stillPath);
      }

      const generator = new AIVideoGenerator({});
      const videoPath = path.join(dir, 'out.mp4');
      await generator.renderSlidesToVideo(stills, 6, videoPath);

      const stats = await fs.stat(videoPath);
      if (!stats.size) {
        throw new Error('Rendered slideshow video is empty');
      }

      // Silent fallback: an unusable audio path must still yield a playable output
      const finalPath = path.join(dir, 'final.mp4');
      await generator.addAudioToVideo(videoPath, path.join(dir, 'missing.mp3'), finalPath);
      const finalStats = await fs.stat(finalPath);
      if (!finalStats.size) {
        throw new Error('Silent-audio fallback did not produce a video');
      }
    } finally {
      await fs.rm(dir, { recursive: true, force: true }).catch(() => {});
    }

    this.logger.info('Slideshow renderer test completed successfully');
  }

  async testEvergreenTopics() {
    const { ContentStrategyAgent } = require('./agents/content-strategy-agent');
    const agent = new ContentStrategyAgent(null, {});
    agent.historicalPerformance = [];

    // Single scraped keywords must never become video topics
    agent.trendingTopics = [{ topic: 'crown', score: 5 }, { topic: 'official', score: 3 }];
    const fallback = agent.selectOptimalTopic();
    if (!fallback.topic.includes(' ') || fallback.topic.length < 8) {
      throw new Error(`Template mode produced a junk topic: "${fallback.topic}"`);
    }

    // A readable multi-word trend should be used when available
    agent.trendingTopics = [{ topic: 'artificial intelligence explained', score: 5 }];
    const readable = agent.selectOptimalTopic();
    if (readable.topic !== 'artificial intelligence explained') {
      throw new Error(`Readable trending topic was not selected: "${readable.topic}"`);
    }

    this.logger.info('Evergreen template topics test completed successfully');
  }

  async testBlaizeBiologyProfile() {
    const previousMode = process.env.BLAIZE_BIOLOGY_MODE;
    const previousApproval = process.env.REQUIRE_HUMAN_APPROVAL;
    process.env.BLAIZE_BIOLOGY_MODE = 'true';
    process.env.REQUIRE_HUMAN_APPROVAL = 'true';
    try {
      const profile = require('./config/blaize-biology');
      if (!profile.isBiologyMode() || !profile.requiresHumanApproval()) {
        throw new Error('Blaize Biology safety mode is not active');
      }
      if (profile.CHANNEL_PROFILE.name !== 'Blaize Tutors') {
        throw new Error('Blaize Tutors channel profile is missing');
      }
      if (profile.BIOLOGY_TOPICS.length < 15) {
        throw new Error('Biology curriculum map is incomplete');
      }
      const { evaluateBiologyStrategy, evaluateBiologyScript } = require('./utils/biology-quality-gate');
      const strategy = this.createValidBiologyStrategy();
      const aiResponse = this.createValidBiologyAIResponse();
      const script = { ...aiResponse, hook: { text: aiResponse.hook }, mainContent: { sections: aiResponse.sections } };
      if (evaluateBiologyStrategy(strategy).length || evaluateBiologyScript(script).length) {
        throw new Error('A complete Biology editorial package was rejected by the quality gate');
      }
      const genericScript = JSON.parse(JSON.stringify(script));
      genericScript.mainContent.sections[0].content[0] = 'The shocking truth is game-changing.';
      if (!evaluateBiologyScript(genericScript).some(issue => /Generic/.test(issue))) {
        throw new Error('Generic clickbait language was not rejected');
      }
      const { Biology3DRenderer } = require('./utils/biology-3d-renderer');
      const renderer = new Biology3DRenderer();
      if (!renderer.createSceneHTML().includes('SCHEMATIC MODEL') || !renderer.threePath.endsWith('three.module.js')) {
        throw new Error('Defensible 3D Biology renderer is not configured');
      }
    } finally {
      if (previousMode === undefined) delete process.env.BLAIZE_BIOLOGY_MODE;
      else process.env.BLAIZE_BIOLOGY_MODE = previousMode;
      if (previousApproval === undefined) delete process.env.REQUIRE_HUMAN_APPROVAL;
      else process.env.REQUIRE_HUMAN_APPROVAL = previousApproval;
    }

    this.logger.info('Blaize Biology profile test completed successfully');
  }

  async testWalkthroughModule() {
    const { SetupWalkthrough, AI_PROVIDER_GUIDE } = require('./walkthrough');
    const { PROVIDERS } = require('./utils/ai-text-service');

    const walkthrough = new SetupWalkthrough();
    if (typeof walkthrough.run !== 'function') {
      throw new Error('SetupWalkthrough.run is not implemented');
    }

    // Every guided provider must be complete and coherent
    for (const [id, guide] of Object.entries(AI_PROVIDER_GUIDE)) {
      for (const field of ['label', 'keyUrl', 'instructions', 'models', 'defaultModel', 'save', 'validationCreds']) {
        if (!guide[field]) {
          throw new Error(`Provider guide "${id}" is missing "${field}"`);
        }
      }
      if (!guide.models.includes(guide.defaultModel)) {
        throw new Error(`Provider guide "${id}" default model is not in its model list`);
      }

      // save() must produce credentials that pass validation
      const credentials = {};
      guide.save(credentials, 'test-key', guide.defaultModel);
      const manager = new CredentialManager();
      manager.credentials = { youtube: { client_id: 'x' }, ...credentials };

      const envKeys = [...Object.values(PROVIDERS).map(p => p.envKey), 'GEMINI_API_KEY'];
      const savedEnv = {};
      for (const key of envKeys) {
        savedEnv[key] = process.env[key];
        delete process.env[key];
      }
      try {
        if (manager.getMissingCredentials().length !== 0) {
          throw new Error(`Provider guide "${id}" save() output fails credential validation`);
        }
      } finally {
        for (const key of envKeys) {
          if (savedEnv[key] === undefined) {
            delete process.env[key];
          } else {
            process.env[key] = savedEnv[key];
          }
        }
      }
    }

    this.logger.info('Walkthrough module test completed successfully');
  }

  async testLogger() {
    const testLogger = new Logger('TestLogger');
    
    testLogger.info('Test info message');
    testLogger.warn('Test warning message');
    testLogger.success('Test success message');
    
    // Test timer
    const timer = testLogger.startTimer('Test Operation');
    await new Promise(resolve => setTimeout(resolve, 100));
    timer.end();
    
    this.logger.info('Logger test completed successfully');
  }

  async testDirectories() {
    const fs = require('fs').promises;
    
    const requiredDirs = [
      'config',
      'logs', 
      'data',
      'agents',
      'database',
      'utils',
      'schedules'
    ];

    for (const dir of requiredDirs) {
      const dirPath = path.join(__dirname, dir);
      await fs.access(dirPath);
    }

    this.logger.info('Directory structure test completed successfully');
  }

  async testAgentLoading() {
    // Test that agent files can be loaded
    const agentFiles = [
      './agents/content-strategy-agent',
      './agents/script-writer-agent',
      './agents/content-review-agent',
      './agents/thumbnail-designer-agent',
      './agents/seo-optimizer-agent',
      './agents/production-management-agent',
      './agents/publishing-scheduling-agent',
      './agents/analytics-optimization-agent'
    ];

    for (const agentFile of agentFiles) {
      try {
        require(agentFile);
      } catch (error) {
        throw new Error(`Failed to load ${agentFile}: ${error.message}`);
      }
    }

    this.logger.info('Agent loading test completed successfully');
  }

  async testConfiguration() {
    const fs = require('fs').promises;
    
    // Check package.json
    const packageJson = JSON.parse(await fs.readFile('package.json', 'utf8'));
    if (!packageJson.name || !packageJson.dependencies) {
      throw new Error('Invalid package.json');
    }

    // Check if main index file exists
    await fs.access('./index.js');

    // The startup banner must report the real version. It was hardcoded to "v2.0"
    // through v2.4.0, so bug reports pasted a version that was four releases stale.
    const indexSource = await fs.readFile('index.js', 'utf8');
    const hardcodedBanner = indexSource.match(/YouTube Automation Agent v[\d.]/);
    if (hardcodedBanner) {
      throw new Error(
        `Startup banner hardcodes a version ("${hardcodedBanner[0]}") — interpolate package.json's version instead`
      );
    }
    if (!indexSource.includes('YouTube Automation Agent v${version}')) {
      throw new Error('Startup banner does not report the package.json version');
    }

    // package.json and package-lock.json drifted apart before v2.4.1; keep them aligned
    const lockJson = JSON.parse(await fs.readFile('package-lock.json', 'utf8'));
    if (lockJson.version !== packageJson.version) {
      throw new Error(
        `package-lock.json version (${lockJson.version}) does not match package.json (${packageJson.version})`
      );
    }

    this.logger.info('Configuration test completed successfully');
  }
}

// Run tests if called directly
if (require.main === module) {
  const tester = new SystemTest();
  tester.runAllTests()
    .then(success => process.exit(success ? 0 : 1))
    .catch(error => {
      console.error(chalk.red('Test runner failed:'), error);
      process.exit(1);
    });
}

module.exports = { SystemTest };
