const REQUIRED_TEACHING_BEATS = [
  'diagnostic',
  'phenomenon',
  'model',
  'guided_practice',
  'misconception',
  'exam_application',
  'payoff'
];

const GENERIC_CONTENT_PATTERNS = [
  /game[- ]changing/i,
  /shocking (?:truth|result)/i,
  /secret nobody/i,
  /experts are talking/i,
  /change everything/i,
  /most people (?:do not|don't) know/i,
  /the science behind this is fascinating/i,
  /\[(?:detailed explanation|specific case study|another relevant example|screen recording|visual demonstration)\]/i,
  /content coming soon/i
];

function nonEmptyArray(value, minimum) {
  return Array.isArray(value) && value.filter(item => String(item || '').trim()).length >= minimum;
}

function evaluateBiologyStrategy(strategy = {}) {
  const issues = [];
  if (!String(strategy.topic || '').trim()) issues.push('A specific Biology topic is required.');
  if (!String(strategy.coreQuestion || '').trim()) issues.push('The strategy needs one driving biological question.');
  if (!String(strategy.lessonPromise || '').trim()) issues.push('The learner payoff is not defined.');
  if (!nonEmptyArray(strategy.candidateAngles, 3)) issues.push('At least three genuinely different lesson angles must be considered.');
  if (!String(strategy.selectionRationale || '').trim()) issues.push('The selected angle needs a defensible rationale.');
  if (!nonEmptyArray(strategy.learningObjectives, 3)) issues.push('At least three measurable learning objectives are required.');
  if (!nonEmptyArray(strategy.prerequisiteKnowledge, 2)) issues.push('Prerequisite knowledge has not been diagnosed.');
  if (!nonEmptyArray(strategy.misconceptions, 1)) issues.push('At least one likely misconception must be anticipated.');
  if (!nonEmptyArray(strategy.retentionPlan, 4)) issues.push('The strategy needs at least four purposeful retention beats.');
  if (!nonEmptyArray(strategy.visualPlan, 5)) issues.push('The strategy needs at least five instructional visual beats.');
  if (!nonEmptyArray(strategy.examFocus?.commandWords, 1)) issues.push('Exam command words are missing.');
  if (!nonEmptyArray(strategy.examFocus?.commonTraps, 1)) issues.push('Common exam traps are missing.');
  return issues;
}

function evaluateBiologyScript(script = {}) {
  const issues = [];
  const sections = script.mainContent?.sections || script.sections || [];
  const beats = new Set(sections.map(section => section.teachingBeat));
  const serialized = JSON.stringify(script);

  for (const beat of REQUIRED_TEACHING_BEATS) {
    if (!beats.has(beat)) issues.push(`Required teaching beat is missing: ${beat}.`);
  }
  if (!String(script.lessonPromise || '').trim()) issues.push('The script does not state a learner payoff.');
  if (!String(script.diagnosticQuestion || '').trim()) issues.push('The script has no diagnostic retrieval question.');
  if (!script.exitQuestion?.question || !script.exitQuestion?.modelAnswer) {
    issues.push('The exit assessment and model answer are incomplete.');
  }
  if (!nonEmptyArray(script.exitQuestion?.markScheme, 1)) {
    issues.push('The exit assessment needs a mark scheme.');
  }

  sections.forEach((section, index) => {
    const label = section.title || `Section ${index + 1}`;
    if (!nonEmptyArray(section.content, 2)) issues.push(`${label} needs at least two substantive spoken-script beats.`);
    if (!String(section.retentionPurpose || '').trim()) issues.push(`${label} has no retention purpose.`);
    const visual = section.visualSpec;
    if (!visual || !String(visual.type || '').trim()) {
      issues.push(`${label} has no instructional visual specification.`);
      return;
    }
    if (!String(visual.template || '').trim()) issues.push(`${label} has no topic-specific 3D scene template.`);
    if (!nonEmptyArray(visual.elements, 2)) issues.push(`${label} visual needs at least two labelled elements.`);
    if (!nonEmptyArray(visual.animationSteps, 2)) issues.push(`${label} visual needs progressive reveal or animation steps.`);
    if (!nonEmptyArray(visual.accuracyChecks, 1)) issues.push(`${label} visual has no scientific accuracy check.`);
    if (!nonEmptyArray(visual.modelLimitations, 1)) issues.push(`${label} visual does not disclose the model's limitations or scale.`);
  });

  for (const pattern of GENERIC_CONTENT_PATTERNS) {
    if (pattern.test(serialized)) issues.push(`Generic or placeholder language detected: ${pattern.source}.`);
  }
  return issues;
}

module.exports = {
  REQUIRED_TEACHING_BEATS,
  GENERIC_CONTENT_PATTERNS,
  evaluateBiologyStrategy,
  evaluateBiologyScript
};
