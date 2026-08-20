const { Logger } = require('../utils/logger');
const { AITextService } = require('../utils/ai-text-service');
const { CHANNEL_PROFILE, isBiologyMode } = require('../config/blaize-biology');
const { evaluateBiologyScript } = require('../utils/biology-quality-gate');

const SCRIPT_RESPONSE_SCHEMA = {
  type: 'object',
  required: ['title', 'hook', 'lessonPromise', 'diagnosticQuestion', 'sections', 'exitQuestion', 'cta'],
  properties: {
    title: { type: 'string' },
    hook: { type: 'string' },
    lessonPromise: { type: 'string' },
    diagnosticQuestion: { type: 'string' },
    sections: {
      type: 'array',
      minItems: 7,
      maxItems: 10,
      items: {
        type: 'object',
        required: ['teachingBeat', 'title', 'content', 'visualSpec', 'retentionPurpose', 'duration'],
        properties: {
          teachingBeat: {
            type: 'string',
            enum: ['diagnostic', 'phenomenon', 'model', 'guided_practice', 'misconception', 'exam_application', 'payoff', 'recap']
          },
          title: { type: 'string' },
          content: {
            type: 'array',
            minItems: 1,
            items: { type: 'string' }
          },
          visualSpec: {
            type: 'object',
            required: ['type', 'template', 'title', 'elements', 'relationships', 'animationSteps', 'accuracyChecks', 'modelLimitations'],
            properties: {
              type: {
                type: 'string',
                enum: ['labelled_diagram', 'process_flow', 'comparison', 'graph', 'data_table', 'practical_setup', 'exam_annotation', 'concept_map']
              },
              template: {
                type: 'string',
                enum: ['cell', 'membrane_transport', 'enzyme_reaction', 'molecule_model', 'plant_process', 'circulation', 'organ_system', 'inheritance', 'ecology', 'microorganism', 'practical_setup', 'data_visualization', 'exam_annotation', 'concept_map']
              },
              title: { type: 'string' },
              elements: { type: 'array', minItems: 2, items: { type: 'string' } },
              relationships: { type: 'array', items: { type: 'string' } },
              animationSteps: { type: 'array', minItems: 2, items: { type: 'string' } },
              accuracyChecks: { type: 'array', minItems: 1, items: { type: 'string' } },
              modelLimitations: { type: 'array', minItems: 1, items: { type: 'string' } }
            }
          },
          retentionPurpose: { type: 'string' },
          duration: { type: 'integer', minimum: 15, maximum: 180 }
        }
      }
    },
    exitQuestion: {
      type: 'object',
      required: ['question', 'commandWord', 'marks', 'modelAnswer', 'markScheme'],
      properties: {
        question: { type: 'string' },
        commandWord: { type: 'string' },
        marks: { type: 'integer', minimum: 1, maximum: 10 },
        modelAnswer: { type: 'string' },
        markScheme: { type: 'array', minItems: 1, items: { type: 'string' } }
      }
    },
    cta: { type: 'string' }
  }
};

class ScriptWriterAgent {
  constructor(db, credentials) {
    this.db = db;
    this.credentials = credentials;
    this.logger = new Logger('ScriptWriter');
    this.templates = this.loadTemplates();
    this.aiTextService = new AITextService(credentials?.credentials || credentials || {});
  }

  async initialize() {
    this.logger.info('Initializing Script Writer Agent...');
    return true;
  }

  loadTemplates() {
    return {
      tutorial: {
        structure: ['hook', 'introduction', 'problem', 'solution_steps', 'demonstration', 'recap', 'cta'],
        tone: 'educational',
        pacing: 'moderate'
      },
      explainer: {
        structure: ['hook', 'question', 'background', 'explanation', 'examples', 'implications', 'summary', 'cta'],
        tone: 'informative',
        pacing: 'steady'
      },
      list: {
        structure: ['hook', 'introduction', 'list_items', 'bonus_item', 'summary', 'cta'],
        tone: 'engaging',
        pacing: 'quick'
      },
      review: {
        structure: ['hook', 'introduction', 'overview', 'pros', 'cons', 'comparison', 'verdict', 'cta'],
        tone: 'analytical',
        pacing: 'detailed'
      },
      story: {
        structure: ['hook', 'setup', 'conflict', 'journey', 'climax', 'resolution', 'lesson', 'cta'],
        tone: 'narrative',
        pacing: 'dynamic'
      }
    };
  }

  async generateScript(strategy) {
    try {
      this.logger.info(`Generating script for: ${strategy.topic}`);
      
      const template = this.templates[strategy.contentType.toLowerCase()] || this.templates.explainer;
      const aiScript = await this.generateScriptWithAI(strategy, template);
      if (aiScript) {
        aiScript.fullScript = this.formatFullScript(aiScript);
        await this.db.saveScript(aiScript);
        this.logger.info(`Script generated with AI provider: ${aiScript.title}`);
        return aiScript;
      }

      if (isBiologyMode()) {
        throw new Error('Blaize Biology mode requires a configured AI provider; generic template scripts are disabled for accuracy.');
      }
      
      this.logger.info('Using template script generation');
      // Generate script components
      const hook = await this.generateHook(strategy);
      const introduction = await this.generateIntroduction(strategy);
      const mainContent = await this.generateMainContent(strategy, template);
      const conclusion = await this.generateConclusion(strategy);
      const cta = await this.generateCTA(strategy);

      // Assemble complete script
      const script = {
        title: await this.generateTitle(strategy),
        hook,
        introduction,
        mainContent,
        conclusion,
        callToAction: cta,
        duration: this.estimateDuration(mainContent),
        tone: template.tone,
        pacing: template.pacing,
        keywords: strategy.keywords,
        metadata: {
          strategy: strategy,
          generatedAt: new Date().toISOString(),
          version: '1.0'
        }
      };

      // Format for readability
      script.fullScript = this.formatFullScript(script);
      
      // Save to database
      await this.db.saveScript(script);
      
      this.logger.info(`Script generated: ${script.title}`);
      return script;
    } catch (error) {
      this.logger.error('Failed to generate script:', error);
      throw error;
    }
  }

  async generateScriptWithAI(strategy, template) {
    if (!this.aiTextService.isAvailable()) {
      this.logger.info('Using template script generation because no AI text provider is configured');
      return null;
    }

    const biologyRequirements = isBiologyMode()
      ? `This is for ${CHANNEL_PROFILE.name} — ${CHANNEL_PROFILE.seriesName}.
The audience is ${CHANNEL_PROFILE.audience}.
Build the sections in this teaching sequence:
1. diagnostic retrieval question;
2. surprising but defensible phenomenon, specimen, dataset, practical observation or exam problem;
3. modelled explanation from observable evidence to mechanism to terminology;
4. guided prediction or application;
5. named misconception, why it feels plausible and the correction;
6. exam application with command-word and mark-logic coaching;
7. payoff that resolves the opening question, followed by an aligned exit question.
Use the exact teachingBeat values diagnostic, phenomenon, model, guided_practice, misconception, exam_application and payoff at least once each.
Every section must include a structured visualSpec. Select the closest topic-specific 3D template from cell, membrane_transport, enzyme_reaction, molecule_model, plant_process, circulation, organ_system, inheritance, ecology, microorganism, practical_setup, data_visualization, exam_annotation or concept_map. Its elements and relationships must be scientifically meaningful; animationSteps must progressively reveal an idea rather than decorate the screen; accuracyChecks must state what a human reviewer should verify; modelLimitations must explicitly identify simplification, omitted scale or other limits of the school-level model.
Keep on-screen concepts concise but make content a complete spoken teaching script, not notes or placeholders. Create an attention reset every 45–90 seconds through prediction, contrast, diagram reveal, data reading, practical reasoning or exam decision.
Use British English. Define specialist vocabulary before using it. Do not invent statistics, research, citations, personal experience or exam-board wording. Do not give medical diagnosis or treatment advice.`
      : '';
    const prompt = `You are writing a YouTube script plan.
Return only valid JSON with this exact shape:
{
  "title": "compelling title under 100 characters",
  "hook": "opening hook in one sentence",
  "lessonPromise": "specific learner payoff",
  "diagnosticQuestion": "short prerequisite retrieval question",
  "sections": [
    {
      "teachingBeat": "diagnostic|phenomenon|model|guided_practice|misconception|exam_application|payoff|recap",
      "title": "section title",
      "content": ["complete spoken-script beat"],
      "visualSpec": {
        "type": "labelled_diagram|process_flow|comparison|graph|data_table|practical_setup|exam_annotation|concept_map",
        "template": "cell|membrane_transport|enzyme_reaction|molecule_model|plant_process|circulation|organ_system|inheritance|ecology|microorganism|practical_setup|data_visualization|exam_annotation|concept_map",
        "title": "visual teaching title",
        "elements": ["precise labelled element"],
        "relationships": ["A causes or connects to B"],
        "animationSteps": ["progressive reveal step"],
        "accuracyChecks": ["specific scientific check"],
        "modelLimitations": ["what is simplified, omitted or not to scale"]
      },
      "retentionPurpose": "how this beat renews attention while advancing learning",
      "duration": 60
    }
  ],
  "exitQuestion": { "question": "aligned exam question", "commandWord": "explain", "marks": 3, "modelAnswer": "concise answer", "markScheme": ["one mark point"] },
  "cta": "clear call to action"
}

Topic: ${strategy.topic}
Style/content type: ${strategy.contentType}
Angle: ${strategy.angle}
Target audience: ${strategy.targetAudience}
Desired length: ${process.env.DEFAULT_VIDEO_LENGTH || '8-12 minutes'}
Tone: ${template.tone}
Pacing: ${template.pacing}
Keywords: ${(strategy.keywords || []).join(', ')}
${biologyRequirements}
Avoid fabricated statistics, unsupported claims, and fake urgency.`;

    let lastError;
    for (let attempt = 1; attempt <= 2; attempt++) {
      try {
        const retryInstruction = attempt > 1
          ? '\nThis is a retry because the previous response was invalid. Return one complete JSON object only.'
          : '';
        const response = await this.aiTextService.generateText(prompt + retryInstruction, {
          maxTokens: 8192,
          temperature: 0.25,
          retries: 2,
          responseMimeType: 'application/json',
          responseJsonSchema: SCRIPT_RESPONSE_SCHEMA
        });
        const parsed = this.parseAIJsonResponse(response);
        const sections = this.normalizeAISections(parsed.sections, strategy);

        if (!parsed.title || !parsed.hook || sections.length === 0) {
          throw new Error('AI script response missing required fields');
        }

        this.logger.info(`Using AI script generation via ${this.aiTextService.providerName}`);
        const script = {
          title: String(parsed.title).slice(0, 100),
          hook: this.normalizeAIHook(parsed.hook),
          lessonPromise: String(parsed.lessonPromise || strategy.lessonPromise || '').trim(),
          diagnosticQuestion: String(parsed.diagnosticQuestion || '').trim(),
          introduction: await this.generateIntroduction(strategy),
          mainContent: {
            sections,
            totalDuration: this.calculateSectionsDuration(sections)
          },
          conclusion: await this.generateConclusion(strategy),
          exitQuestion: parsed.exitQuestion,
          callToAction: this.normalizeAICTA(parsed.cta, strategy),
          duration: this.estimateDuration({ sections }),
          tone: template.tone,
          pacing: template.pacing,
          keywords: strategy.keywords || [],
          metadata: {
            strategy,
            generatedAt: new Date().toISOString(),
            version: '1.0',
            generationSource: 'ai'
          }
        };
        if (isBiologyMode()) {
          const issues = evaluateBiologyScript(script);
          if (issues.length > 0) throw new Error(`Script failed teaching-quality gate: ${issues.join(' ')}`);
        }
        return script;
      } catch (error) {
        lastError = error;
        if (attempt < 2) {
          this.logger.warn(`AI script response was unusable; retrying: ${error.message}`);
        }
      }
    }

    if (isBiologyMode()) {
      throw new Error(
        `AI Biology script generation did not return a complete validated response after retries: ${lastError.message}`
      );
    }

    this.logger.warn(`AI script generation failed; using template fallback: ${lastError.message}`);
    return null;
  }

  parseAIJsonResponse(response) {
    const text = String(response || '').trim();
    const withoutFences = text
      .replace(/^```(?:json)?\s*/i, '')
      .replace(/```$/i, '')
      .trim();

    try {
      return JSON.parse(withoutFences);
    } catch (error) {
      const match = withoutFences.match(/\{[\s\S]*\}/);
      if (!match) {
        throw error;
      }
      return JSON.parse(match[0]);
    }
  }

  normalizeAIHook(hook) {
    const text = typeof hook === 'object' && hook !== null ? hook.text : hook;
    return {
      type: 'ai',
      text: String(text).trim(),
      duration: '0:00-0:05'
    };
  }

  normalizeAISections(sections, strategy) {
    if (!Array.isArray(sections)) {
      return [];
    }

    return sections
      .slice(0, 8)
      .map((section, index) => {
        const rawContent = Array.isArray(section.content)
          ? section.content
          : [section.content || section.summary || section.description];
        const content = rawContent
          .filter(Boolean)
          .map(line => String(line).trim())
          .filter(Boolean);

        return {
          type: 'ai_generated',
          teachingBeat: String(section.teachingBeat || '').trim(),
          title: String(section.title || `${strategy.topic} Part ${index + 1}`).trim(),
          content,
          visualSpec: this.normalizeVisualSpec(section.visualSpec, section.title),
          retentionPurpose: String(section.retentionPurpose || '').trim(),
          duration: parseInt(section.duration, 10) || 60
        };
      })
      .filter(section => section.title && section.content.length > 0);
  }

  normalizeVisualSpec(visualSpec = {}, fallbackTitle = 'Teaching visual') {
    const normalize = value => Array.isArray(value)
      ? value.map(item => String(item).trim()).filter(Boolean)
      : [];
    return {
      type: String(visualSpec.type || '').trim(),
      template: String(visualSpec.template || '').trim(),
      title: String(visualSpec.title || fallbackTitle || 'Teaching visual').trim(),
      elements: normalize(visualSpec.elements),
      relationships: normalize(visualSpec.relationships),
      animationSteps: normalize(visualSpec.animationSteps),
      accuracyChecks: normalize(visualSpec.accuracyChecks),
      modelLimitations: normalize(visualSpec.modelLimitations)
    };
  }

  normalizeAICTA(cta, strategy) {
    if (isBiologyMode()) {
      const text = cta && typeof cta === 'object' ? cta.subscribe || cta.text : cta;
      return {
        type: 'call_to_action',
        subscribe: String(text || `Subscribe to ${CHANNEL_PROFILE.name} for weekly Biology lessons and revision.`),
        like: 'Like the lesson if the explanation helped you.',
        comment: `Try the exam check for ${strategy.topic} and share your answer in the comments.`,
        nextVideo: 'Continue with the next lesson in the Biology Series.',
        duration: '15 seconds'
      };
    }

    if (cta && typeof cta === 'object') {
      return {
        type: 'call_to_action',
        subscribe: String(cta.subscribe || cta.text || `Subscribe for more on ${strategy.topic}.`),
        like: String(cta.like || 'Like this video if it helped.'),
        comment: String(cta.comment || `Share your experience with ${strategy.topic} in the comments.`),
        nextVideo: String(cta.nextVideo || 'Watch the next related video for more context.'),
        duration: '15 seconds'
      };
    }

    return {
      type: 'call_to_action',
      subscribe: String(cta || `Subscribe for more practical videos about ${strategy.topic}.`),
      like: 'Like this video if it helped.',
      comment: `Share your experience with ${strategy.topic} in the comments.`,
      nextVideo: 'Watch the next related video for more context.',
      duration: '15 seconds'
    };
  }
  async generateTitle(strategy) {
    const templates = [
      `${strategy.angle}`,
      `${strategy.topic}: The Complete Guide`,
      `Everything You Need to Know About ${strategy.topic}`,
      `${strategy.topic} in ${new Date().getFullYear()}: What's Changed?`,
      `The Truth About ${strategy.topic} (Shocking Results)`,
      `How to Master ${strategy.topic} in 30 Days`,
      `${strategy.topic}: Beginner to Expert Guide`
    ];

    // Select based on content type
    if (strategy.contentType === 'Tutorial') {
      return `How to ${strategy.topic}: Step-by-Step Guide`;
    } else if (strategy.contentType === 'List') {
      return `Top 10 ${strategy.topic} Tips You Need to Know`;
    } else if (strategy.contentType === 'Review') {
      return `${strategy.topic} Review: Is It Worth It?`;
    }

    return templates[Math.floor(Math.random() * templates.length)];
  }

  async generateHook(strategy) {
    const hooks = [
      {
        type: 'question',
        text: `Have you ever wondered ${this.generateQuestionAbout(strategy.topic)}?`
      },
      {
        type: 'statistic',
        text: `Did you know that ${this.generateStatistic(strategy.topic)}?`
      },
      {
        type: 'statement',
        text: `${strategy.topic} is about to change everything, and here's why...`
      },
      {
        type: 'challenge',
        text: `Most people think they understand ${strategy.topic}, but they're completely wrong.`
      },
      {
        type: 'promise',
        text: `In the next few minutes, you'll learn exactly how to master ${strategy.topic}.`
      }
    ];

    const selected = hooks[Math.floor(Math.random() * hooks.length)];
    
    return {
      type: selected.type,
      text: selected.text,
      duration: '0:00-0:05'
    };
  }

  generateQuestionAbout(topic) {
    const questions = [
      `why ${topic} is becoming so important`,
      `how ${topic} actually works`,
      `what makes ${topic} different from everything else`,
      `why experts are talking about ${topic}`,
      `how ${topic} could change your life`
    ];
    
    return questions[Math.floor(Math.random() * questions.length)];
  }

  generateStatistic(topic) {
    const stats = [
      `many people are still figuring out how ${topic} works`,
      `the conversation around ${topic} keeps expanding`,
      `experts continue to debate where ${topic} is headed`,
      `people often miss the practical side of ${topic}`,
      `${topic} can be easier to approach with a clear framework`
    ];
    
    return stats[Math.floor(Math.random() * stats.length)];
  }

  async generateIntroduction(strategy) {
    if (isBiologyMode()) {
      return {
        greeting: `Welcome to ${CHANNEL_PROFILE.name}.`,
        topicIntro: `In this Biology lesson, we are studying ${strategy.topic}.`,
        valueProposition: 'By the end, you should be able to explain the idea clearly and apply it to an exam-style question.',
        credibility: 'We will use precise school-level Biology language and correct a common misconception as we go.',
        duration: '0:05-0:20'
      };
    }

    return {
      greeting: "Hey everyone, welcome back to the channel!",
      topicIntro: `Today, we're diving deep into ${strategy.topic}.`,
      valueProposition: `By the end of this video, you'll understand exactly ${this.getValueProposition(strategy)}.`,
      credibility: this.getCredibilityStatement(strategy),
      duration: '0:05-0:20'
    };
  }

  getValueProposition(strategy) {
    const propositions = {
      'Tutorial': `how to implement ${strategy.topic} step by step`,
      'Explainer': `what ${strategy.topic} is and why it matters`,
      'List': `the most important things about ${strategy.topic}`,
      'Review': `whether ${strategy.topic} is right for you`,
      'Story': `the incredible journey of ${strategy.topic}`
    };
    
    return propositions[strategy.contentType] || `everything about ${strategy.topic}`;
  }

  getCredibilityStatement(strategy) {
    const statements = [
      "I've spent months researching this topic",
      "After working with hundreds of people on this",
      "Based on the latest research and data",
      "Drawing from real-world experience",
      "Using proven methods and strategies"
    ];
    
    return statements[Math.floor(Math.random() * statements.length)];
  }

  async generateMainContent(strategy, template) {
    const sections = [];
    
    for (const section of template.structure) {
      if (!['hook', 'introduction', 'cta'].includes(section)) {
        sections.push(await this.generateSection(section, strategy));
      }
    }
    
    return {
      sections,
      totalDuration: this.calculateSectionsDuration(sections)
    };
  }

  async generateSection(sectionType, strategy) {
    const sectionGenerators = {
      problem: () => this.generateProblemSection(strategy),
      solution_steps: () => this.generateSolutionSteps(strategy),
      demonstration: () => this.generateDemonstration(strategy),
      explanation: () => this.generateExplanation(strategy),
      examples: () => this.generateExamples(strategy),
      list_items: () => this.generateListItems(strategy),
      pros: () => this.generatePros(strategy),
      cons: () => this.generateCons(strategy),
      comparison: () => this.generateComparison(strategy),
      implications: () => this.generateImplications(strategy)
    };

    const generator = sectionGenerators[sectionType];
    
    if (generator) {
      return await generator();
    }
    
    return this.generateGenericSection(sectionType, strategy);
  }

  async generateProblemSection(strategy) {
    return {
      type: 'problem',
      title: 'The Challenge',
      content: [
        `Many people struggle with ${strategy.topic}.`,
        `The main issues are:`,
        `1. Lack of clear information`,
        `2. Complexity and confusion`,
        `3. Not knowing where to start`,
        `But don't worry, we're going to solve all of these today.`
      ],
      visuals: ['Problem illustration', 'Statistics graphic'],
      duration: 30
    };
  }

  async generateSolutionSteps(strategy) {
    const steps = [];
    const numSteps = 3 + Math.floor(Math.random() * 3); // 3-5 steps
    
    for (let i = 1; i <= numSteps; i++) {
      steps.push({
        number: i,
        title: `Step ${i}: ${this.generateStepTitle(strategy.topic, i)}`,
        description: this.generateStepDescription(strategy.topic, i),
        tip: this.generateProTip(strategy.topic)
      });
    }
    
    return {
      type: 'solution_steps',
      title: 'The Solution',
      steps,
      duration: steps.length * 45
    };
  }

  generateStepTitle(topic, stepNumber) {
    const titles = [
      'Research and Preparation',
      'Setting Up the Foundation',
      'Implementation and Execution',
      'Testing and Optimization',
      'Scaling and Automation'
    ];
    
    return titles[stepNumber - 1] || `Advanced ${topic} Techniques`;
  }

  generateStepDescription(topic, stepNumber) {
    return `This step involves understanding the key aspects of ${topic} and how to apply them effectively. Pay special attention to the details here, as they make all the difference.`;
  }

  generateProTip(topic) {
    const tips = [
      `Pro tip: Start small and scale gradually`,
      `Remember: Consistency is more important than perfection`,
      `Quick tip: Document everything as you go`,
      `Expert advice: Focus on one aspect at a time`,
      `Insider secret: This works best when combined with regular practice`
    ];
    
    return tips[Math.floor(Math.random() * tips.length)];
  }

  async generateDemonstration(strategy) {
    return {
      type: 'demonstration',
      title: 'Live Demo',
      content: [
        `Now let me show you exactly how this works.`,
        `[Screen recording or visual demonstration]`,
        `As you can see, the process is straightforward once you understand the basics.`,
        `The key is to follow the steps exactly as shown.`
      ],
      visuals: ['Screen recording', 'Step-by-step graphics'],
      duration: 120
    };
  }

  async generateExplanation(strategy) {
    return {
      type: 'explanation',
      title: 'Deep Dive',
      content: [
        `Let's break down ${strategy.topic} into its core components.`,
        `First, we need to understand the fundamental principles.`,
        `The science behind this is fascinating...`,
        `[Detailed explanation with visuals]`,
        `This is why ${strategy.topic} works so effectively.`
      ],
      visuals: ['Diagrams', 'Infographics', 'Charts'],
      duration: 90
    };
  }

  async generateExamples(strategy) {
    return {
      type: 'examples',
      title: 'Real-World Examples',
      content: [
        `Let's look at some real examples of ${strategy.topic} in action.`,
        `Example 1: [Specific case study]`,
        `Example 2: [Another relevant example]`,
        `Example 3: [Third compelling example]`,
        `These examples show the versatility and power of ${strategy.topic}.`
      ],
      visuals: ['Case study graphics', 'Before/after comparisons'],
      duration: 75
    };
  }

  async generateListItems(strategy) {
    const items = [];
    const numItems = 5 + Math.floor(Math.random() * 6); // 5-10 items
    
    for (let i = 1; i <= numItems; i++) {
      items.push({
        number: numItems - i + 1, // Countdown for engagement
        title: this.generateListItemTitle(strategy.topic, i),
        description: this.generateListItemDescription(strategy.topic),
        impact: this.generateImpactStatement()
      });
    }
    
    return {
      type: 'list_items',
      title: `Top ${numItems} Things About ${strategy.topic}`,
      items,
      duration: items.length * 30
    };
  }

  generateListItemTitle(topic, index) {
    const titles = [
      `The Hidden Power of ${topic}`,
      `Why ${topic} Matters More Than You Think`,
      `The Surprising Truth About ${topic}`,
      `How ${topic} Can Transform Your Approach`,
      `The ${topic} Secret Nobody Talks About`,
      `Mastering ${topic} in Record Time`,
      `The Ultimate ${topic} Hack`,
      `${topic}: The Game Changer`,
      `Breaking Down ${topic} Myths`,
      `The Future of ${topic}`
    ];
    
    return titles[index - 1] || `Advanced ${topic} Technique #${index}`;
  }

  generateListItemDescription(topic) {
    return `This aspect of ${topic} is crucial because it fundamentally changes how we approach the subject. Understanding this will give you a significant advantage.`;
  }

  generateImpactStatement() {
    const impacts = [
      'This alone can save you hours',
      'Game-changing for beginners',
      'Essential for long-term success',
      'Often overlooked but critical',
      'The difference between success and failure'
    ];
    
    return impacts[Math.floor(Math.random() * impacts.length)];
  }

  async generatePros(strategy) {
    return {
      type: 'pros',
      title: 'The Benefits',
      points: [
        'Easy to get started',
        'Cost-effective solution',
        'Proven results',
        'Scalable approach',
        'Community support'
      ],
      duration: 45
    };
  }

  async generateCons(strategy) {
    return {
      type: 'cons',
      title: 'Things to Consider',
      points: [
        'Learning curve at the beginning',
        'Requires consistent effort',
        'Results may vary',
        'Some technical knowledge helpful'
      ],
      duration: 30
    };
  }

  async generateComparison(strategy) {
    return {
      type: 'comparison',
      title: 'How It Compares',
      content: `Compared to alternatives, ${strategy.topic} stands out because of its unique approach and proven effectiveness.`,
      comparisonPoints: [
        'More efficient than traditional methods',
        'Better ROI than competitors',
        'Easier to implement',
        'More sustainable long-term'
      ],
      duration: 60
    };
  }

  async generateImplications(strategy) {
    return {
      type: 'implications',
      title: 'What This Means',
      content: [
        `The implications of ${strategy.topic} are far-reaching.`,
        'This will change how we think about the industry.',
        'Early adopters will have a significant advantage.',
        'The potential for growth is enormous.'
      ],
      duration: 45
    };
  }

  generateGenericSection(sectionType, strategy) {
    return {
      type: sectionType,
      title: sectionType.replace(/_/g, ' ').replace(/\b\w/g, l => l.toUpperCase()),
      content: `This section covers important aspects of ${strategy.topic} that you need to know.`,
      duration: 60
    };
  }

  async generateConclusion(strategy) {
    if (isBiologyMode()) {
      return {
        type: 'conclusion',
        title: 'Exam recap',
        recap: [
          `Restate the key definition for ${strategy.topic}.`,
          'Link structure to function or cause to effect.',
          'Check the corrected misconception before attempting the exam question.'
        ],
        finalThought: 'Understand the science. Master the exam.',
        duration: '30 seconds'
      };
    }

    return {
      type: 'conclusion',
      title: 'Wrapping Up',
      recap: [
        `So that's everything you need to know about ${strategy.topic}.`,
        'We covered the key points:',
        '- The fundamentals and why they matter',
        '- Practical steps to get started',
        '- Real-world applications and examples',
        '- Tips for long-term success'
      ],
      finalThought: `Remember, ${strategy.topic} is a journey, not a destination. Keep learning and improving!`,
      duration: '30 seconds'
    };
  }

  async generateCTA(strategy) {
    if (isBiologyMode()) {
      return {
        type: 'call_to_action',
        subscribe: `Subscribe to ${CHANNEL_PROFILE.name} for weekly Biology lessons and revision.`,
        like: 'Like the lesson if the explanation helped you.',
        comment: `Try the exam check for ${strategy.topic} and share your answer in the comments.`,
        nextVideo: 'Continue with the next lesson in the Biology Series.',
        duration: '15 seconds'
      };
    }

    return {
      type: 'call_to_action',
      subscribe: "If you found this helpful, make sure to subscribe and hit the notification bell!",
      like: "Give this video a thumbs up if you learned something new.",
      comment: `Let me know in the comments: What's your experience with ${strategy.topic}?`,
      nextVideo: "Check out this related video for more insights.",
      duration: '15 seconds'
    };
  }

  formatFullScript(script) {
    let fullScript = '';
    
    // Title
    fullScript += `TITLE: ${script.title}\n\n`;
    fullScript += '═'.repeat(50) + '\n\n';
    
    // Hook
    fullScript += `[${script.hook.duration}] HOOK\n`;
    fullScript += `${script.hook.text}\n\n`;

    if (script.lessonPromise) fullScript += `LESSON PROMISE\n${script.lessonPromise}\n\n`;
    if (script.diagnosticQuestion) fullScript += `DIAGNOSTIC QUESTION\n${script.diagnosticQuestion}\n\n`;
    
    // Introduction
    fullScript += `[${script.introduction.duration}] INTRODUCTION\n`;
    fullScript += `${script.introduction.greeting}\n`;
    fullScript += `${script.introduction.topicIntro}\n`;
    fullScript += `${script.introduction.valueProposition}\n`;
    fullScript += `${script.introduction.credibility}\n\n`;
    
    // Main Content
    fullScript += 'MAIN CONTENT\n';
    fullScript += '─'.repeat(30) + '\n\n';
    
    for (const section of script.mainContent.sections) {
      fullScript += `[${this.formatDuration(section.duration)}] ${section.title.toUpperCase()}\n`;
      
      if (Array.isArray(section.content)) {
        section.content.forEach(line => {
          fullScript += `${line}\n`;
        });
      } else if (section.steps) {
        section.steps.forEach(step => {
          fullScript += `\n${step.title}\n`;
          fullScript += `${step.description}\n`;
          fullScript += `💡 ${step.tip}\n`;
        });
      } else if (section.items) {
        section.items.forEach(item => {
          fullScript += `\n#${item.number}: ${item.title}\n`;
          fullScript += `${item.description}\n`;
          fullScript += `Impact: ${item.impact}\n`;
        });
      } else if (section.points) {
        section.points.forEach(point => {
          fullScript += `• ${point}\n`;
        });
      } else {
        fullScript += `${section.content}\n`;
      }
      
      if (section.visuals) {
        fullScript += `\n[VISUALS: ${section.visuals.join(', ')}]\n`;
      }
      if (section.visualSpec) {
        fullScript += `\n[3D VISUAL: ${section.visualSpec.template} — ${section.visualSpec.title}]\n`;
        fullScript += `[MODEL LIMITS: ${section.visualSpec.modelLimitations.join('; ')}]\n`;
      }
      
      fullScript += '\n';
    }
    
    // Conclusion
    fullScript += `[${script.conclusion.duration}] CONCLUSION\n`;
    script.conclusion.recap.forEach(line => {
      fullScript += `${line}\n`;
    });
    fullScript += `\n${script.conclusion.finalThought}\n\n`;

    if (script.exitQuestion?.question) {
      fullScript += `EXIT QUESTION (${script.exitQuestion.marks} marks)\n`;
      fullScript += `${script.exitQuestion.question}\n`;
      fullScript += `MODEL ANSWER: ${script.exitQuestion.modelAnswer}\n`;
      fullScript += `MARK SCHEME: ${script.exitQuestion.markScheme.join('; ')}\n\n`;
    }
    
    // Call to Action
    fullScript += `[${script.callToAction.duration}] CALL TO ACTION\n`;
    fullScript += `${script.callToAction.subscribe}\n`;
    fullScript += `${script.callToAction.like}\n`;
    fullScript += `${script.callToAction.comment}\n`;
    fullScript += `${script.callToAction.nextVideo}\n\n`;
    
    // Metadata
    fullScript += '═'.repeat(50) + '\n';
    fullScript += `ESTIMATED DURATION: ${script.duration}\n`;
    fullScript += `TONE: ${script.tone}\n`;
    fullScript += `PACING: ${script.pacing}\n`;
    fullScript += `KEYWORDS: ${script.keywords.join(', ')}\n`;
    
    return fullScript;
  }

  estimateDuration(mainContent) {
    const totalSeconds = mainContent.sections.reduce((total, section) => {
      return total + (section.duration || 60);
    }, 0);
    
    // Add hook, intro, conclusion, CTA
    const fullDuration = totalSeconds + 5 + 15 + 30 + 15;
    
    return this.formatDuration(fullDuration);
  }

  formatDuration(seconds) {
    const minutes = Math.floor(seconds / 60);
    const remainingSeconds = seconds % 60;
    return `${minutes}:${remainingSeconds.toString().padStart(2, '0')}`;
  }

  calculateSectionsDuration(sections) {
    return sections.reduce((total, section) => total + (section.duration || 60), 0);
  }
}

module.exports = { ScriptWriterAgent };
