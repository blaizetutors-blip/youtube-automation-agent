const BIOLOGY_TOPICS = [
  'Cell structure and organisation',
  'Movement of substances across cell membranes',
  'Biological molecules and food tests',
  'Enzymes and factors affecting enzyme activity',
  'Photosynthesis and limiting factors',
  'Respiration and energy release',
  'Transport systems in plants',
  'The human circulatory system',
  'Nutrition and digestion in humans',
  'Excretion and homeostasis',
  'Coordination and response',
  'Reproduction in flowering plants',
  'Human reproduction and development',
  'Inheritance, variation and evolution',
  'Ecology, food chains and nutrient cycles',
  'Microorganisms, disease and immunity',
  'Classification and diversity of organisms',
  'Biology practical skills and data interpretation'
];

const CHANNEL_PROFILE = {
  name: 'Blaize Tutors',
  seriesName: 'The Biology Series',
  promise: 'Biology, explained. From first principles to exam marks.',
  audience: 'Secondary-school learners preparing for WAEC, NECO, UTME/JAMB, IGCSE and GCSE',
  exams: ['WAEC', 'NECO', 'UTME/JAMB', 'IGCSE', 'GCSE'],
  language: 'en',
  categoryId: 27,
  region: 'NG',
  brand: {
    deepGreen: '#062C2A',
    turquoise: '#35D6CF',
    flameOrange: '#F36B21',
    flameYellow: '#FFD54A',
    paper: '#F4E8CC'
  }
};

function isBiologyMode() {
  return String(process.env.BLAIZE_BIOLOGY_MODE || '').toLowerCase() === 'true';
}

function requiresHumanApproval() {
  return String(process.env.REQUIRE_HUMAN_APPROVAL || 'true').toLowerCase() !== 'false';
}

module.exports = {
  BIOLOGY_TOPICS,
  CHANNEL_PROFILE,
  isBiologyMode,
  requiresHumanApproval
};
