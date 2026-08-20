import * as THREE from '/three.module.js';

const colours = {
  deepGreen: 0x062c2a,
  turquoise: 0x35d6cf,
  orange: 0xf36b21,
  yellow: 0xffd54a,
  paper: 0xf4e8cc,
  red: 0xd64b4b,
  blue: 0x3887d6,
  purple: 0x9768d1
};

const state = { objects: [], movers: [], progress: 0 };
const scene = new THREE.Scene();
scene.background = new THREE.Color(colours.deepGreen);
scene.fog = new THREE.FogExp2(colours.deepGreen, 0.025);

const camera = new THREE.PerspectiveCamera(42, innerWidth / innerHeight, 0.1, 100);
camera.position.set(0, 2.2, 12);
const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.setSize(innerWidth, innerHeight);
renderer.outputColorSpace = THREE.SRGBColorSpace;
document.getElementById('stage').appendChild(renderer.domElement);

scene.add(new THREE.HemisphereLight(colours.paper, 0x00110f, 3));
const key = new THREE.DirectionalLight(colours.turquoise, 5);
key.position.set(5, 8, 7);
scene.add(key);
const warm = new THREE.PointLight(colours.orange, 35, 30);
warm.position.set(-6, 2, 5);
scene.add(warm);

function material(colour, options = {}) {
  return new THREE.MeshPhysicalMaterial({
    color: colour,
    roughness: 0.38,
    metalness: 0.08,
    transparent: Boolean(options.transparent),
    opacity: options.opacity ?? 1,
    transmission: options.transmission ?? 0,
    side: THREE.DoubleSide
  });
}

function add(mesh, position = [0, 0, 0]) {
  mesh.position.set(...position);
  scene.add(mesh);
  state.objects.push(mesh);
  return mesh;
}

function sphere(radius, colour, position, options) {
  return add(new THREE.Mesh(new THREE.SphereGeometry(radius, 40, 28), material(colour, options)), position);
}

function box(size, colour, position, options) {
  return add(new THREE.Mesh(new THREE.BoxGeometry(...size), material(colour, options)), position);
}

function tubeBetween(a, b, colour = colours.paper, radius = 0.055) {
  const start = new THREE.Vector3(...a);
  const end = new THREE.Vector3(...b);
  const midpoint = start.clone().add(end).multiplyScalar(0.5);
  const length = start.distanceTo(end);
  const mesh = new THREE.Mesh(new THREE.CylinderGeometry(radius, radius, length, 12), material(colour));
  mesh.position.copy(midpoint);
  mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), end.clone().sub(start).normalize());
  scene.add(mesh);
  state.objects.push(mesh);
  return mesh;
}

function clearScene() {
  for (const object of state.objects) {
    scene.remove(object);
    object.geometry?.dispose();
    object.material?.dispose();
  }
  state.objects = [];
  state.movers = [];
}

function cellScene(spec) {
  const plant = /plant/i.test(spec.title + ' ' + spec.elements.join(' '));
  if (plant) {
    box([7.3, 5.0, 2.8], colours.turquoise, [0, 0, 0], { transparent: true, opacity: 0.16, transmission: 0.15 });
    box([6.8, 4.5, 2.5], colours.paper, [0, 0, 0], { transparent: true, opacity: 0.08 });
  } else {
    sphere(3.25, colours.turquoise, [0, 0, 0], { transparent: true, opacity: 0.18, transmission: 0.2 });
  }
  sphere(1.05, colours.purple, [-0.5, 0.4, 0.15]);
  sphere(0.35, colours.yellow, [-0.5, 0.4, 0.15]);
  for (const p of [[1.5, 1, 0.4], [1.7, -1.1, -0.2], [-1.8, -1.1, 0.5]]) {
    const organelle = sphere(0.48, colours.orange, p);
    organelle.scale.set(1.7, 0.7, 0.8);
  }
  if (plant) {
    for (const p of [[2, 1.3, 0.6], [-2.1, 1.4, -0.4], [2.2, -1.2, 0.3]]) {
      const chloroplast = sphere(0.42, 0x68b957, p);
      chloroplast.scale.set(1.7, 0.65, 0.75);
    }
  }
}

function membraneScene() {
  for (let row = -1; row <= 1; row += 2) {
    for (let x = -4; x <= 4; x += 0.55) {
      sphere(0.16, colours.turquoise, [x, row * 0.36, 0]);
      tubeBetween([x, row * 0.46, 0], [x, row * 0.06, 0], colours.paper, 0.035);
    }
  }
  box([0.8, 1.4, 1.6], colours.purple, [0, 0, 0], { transparent: true, opacity: 0.72 });
  for (let i = 0; i < 16; i++) {
    const start = [-4 + (i % 8) * 0.55, 2.4 + Math.floor(i / 8) * 0.55, (i % 3) * 0.35 - 0.35];
    const particle = sphere(0.13, colours.yellow, start);
    state.movers.push({ object: particle, start, end: [start[0] * 0.35, -2.4, start[2]] });
  }
}

function enzymeScene() {
  const enzyme = new THREE.Mesh(new THREE.TorusGeometry(2.1, 0.65, 20, 70, Math.PI * 1.55), material(colours.turquoise));
  add(enzyme, [-0.8, 0, 0]);
  const substrate = box([1.1, 0.75, 0.75], colours.yellow, [4, 0.5, 0]);
  substrate.rotation.z = 0.35;
  state.movers.push({ object: substrate, start: [4, 0.5, 0], end: [1.0, 0.15, 0] });
  sphere(0.38, colours.orange, [-0.1, 0.1, 0.45]);
}

function moleculeScene() {
  const positions = [[-2.4, 0, 0], [-0.8, 1, 0], [0.8, 0, 0], [2.4, 1, 0], [0.8, -1.6, 0]];
  positions.forEach((p, i) => sphere(i === 0 ? 0.65 : 0.48, [colours.orange, colours.paper, colours.turquoise][i % 3], p));
  positions.slice(1).forEach((p, i) => tubeBetween(positions[i], p, colours.paper, 0.12));
}

function plantProcessScene() {
  const leaf = sphere(2.6, 0x58a85a, [0, 0, 0]);
  leaf.scale.set(1.65, 0.65, 0.18);
  tubeBetween([-4, 3, 0], [-1.6, 0.8, 0], colours.yellow, 0.1);
  tubeBetween([4, -2.5, 0], [1.7, -0.7, 0], colours.blue, 0.1);
  for (let i = 0; i < 12; i++) {
    const start = [-4 + (i % 4) * 0.5, 3 + Math.floor(i / 4) * 0.3, 0];
    const ray = sphere(0.12, colours.yellow, start);
    state.movers.push({ object: ray, start, end: [-1.3 + (i % 4) * 0.55, 0.4, 0] });
  }
}

function circulationScene() {
  const left = add(new THREE.Mesh(new THREE.TorusGeometry(2.0, 0.18, 18, 80), material(colours.blue)), [-2.2, 0, 0]);
  left.rotation.x = 0.4;
  const right = add(new THREE.Mesh(new THREE.TorusGeometry(2.0, 0.18, 18, 80), material(colours.red)), [2.2, 0, 0]);
  right.rotation.x = -0.4;
  sphere(0.9, colours.orange, [0, 0, 0]);
  for (let i = 0; i < 12; i++) {
    const colour = i < 6 ? colours.blue : colours.red;
    const angle = (i % 6) / 6 * Math.PI * 2;
    const centre = i < 6 ? -2.2 : 2.2;
    const particle = sphere(0.12, colour, [centre + Math.cos(angle) * 2, Math.sin(angle) * 2, 0]);
    state.movers.push({ object: particle, orbit: { centre, offset: angle } });
  }
}

function inheritanceScene() {
  for (let pair = 0; pair < 2; pair++) {
    const x = pair ? 2.1 : -2.1;
    for (const shift of [-0.32, 0.32]) {
      const chromosome = box([0.38, 3.8, 0.38], pair ? colours.yellow : colours.turquoise, [x + shift, 0, 0]);
      chromosome.rotation.z = shift > 0 ? 0.35 : -0.35;
    }
  }
  tubeBetween([-1.3, 0, 0], [1.3, 0, 0], colours.paper, 0.06);
}

function ecologyScene() {
  const levels = [
    { y: -2.2, count: 5, colour: 0x58a85a },
    { y: -0.5, count: 3, colour: colours.yellow },
    { y: 1.2, count: 2, colour: colours.orange },
    { y: 2.7, count: 1, colour: colours.red }
  ];
  for (const level of levels) {
    for (let i = 0; i < level.count; i++) {
      const x = (i - (level.count - 1) / 2) * 1.35;
      sphere(0.35, level.colour, [x, level.y, 0]);
      if (level.y < 2.7) tubeBetween([x, level.y + 0.4, 0], [x * 0.55, level.y + 1.25, 0], colours.paper, 0.045);
    }
  }
}

function practicalScene() {
  for (let i = -2; i <= 2; i++) {
    const tube = add(new THREE.Mesh(new THREE.CylinderGeometry(0.35, 0.28, 3, 28), material(colours.paper, { transparent: true, opacity: 0.35 })), [i * 1.25, 0, 0]);
    const liquid = add(new THREE.Mesh(new THREE.CylinderGeometry(0.27, 0.23, 1.25, 28), material(i % 2 ? colours.orange : colours.turquoise, { transparent: true, opacity: 0.78 })), [i * 1.25, -0.72, 0]);
    state.movers.push({ object: liquid, pulse: i * 0.4 });
    tube.rotation.z = i * 0.025;
  }
  box([7.3, 0.25, 2.0], colours.paper, [0, -1.7, 0], { transparent: true, opacity: 0.3 });
}

function dataScene() {
  const heights = [1.1, 2.2, 3.8, 2.9, 4.5];
  heights.forEach((height, i) => {
    const bar = box([0.8, height, 0.8], [colours.turquoise, colours.yellow, colours.orange][i % 3], [-3.2 + i * 1.6, -2.3 + height / 2, 0]);
    state.movers.push({ object: bar, targetScale: height });
  });
  tubeBetween([-4.2, -2.3, 0], [4.2, -2.3, 0], colours.paper, 0.05);
  tubeBetween([-4.2, -2.3, 0], [-4.2, 3.2, 0], colours.paper, 0.05);
}

function generalScene(spec) {
  const elements = spec.elements.slice(0, 7);
  elements.forEach((_, i) => {
    const angle = i / elements.length * Math.PI * 2;
    const p = [Math.cos(angle) * 3.4, Math.sin(angle) * 2.5, Math.sin(angle * 2) * 0.6];
    sphere(0.48, [colours.turquoise, colours.yellow, colours.orange, colours.purple][i % 4], p);
    if (i > 0) tubeBetween([0, 0, 0], p, colours.paper, 0.045);
  });
  sphere(0.75, colours.paper, [0, 0, 0]);
}

const sceneFactories = {
  cell: cellScene,
  membrane_transport: membraneScene,
  enzyme_reaction: enzymeScene,
  molecule_model: moleculeScene,
  plant_process: plantProcessScene,
  circulation: circulationScene,
  organ_system: circulationScene,
  inheritance: inheritanceScene,
  ecology: ecologyScene,
  microorganism: cellScene,
  practical_setup: practicalScene,
  data_visualization: dataScene,
  exam_annotation: dataScene
};

window.configureScene = spec => {
  clearScene();
  const safeSpec = {
    template: String(spec.template || 'concept_map'),
    title: String(spec.title || 'Biology model'),
    elements: Array.isArray(spec.elements) ? spec.elements.map(String) : [],
    relationships: Array.isArray(spec.relationships) ? spec.relationships.map(String) : [],
    modelLimitations: Array.isArray(spec.modelLimitations) ? spec.modelLimitations.map(String) : []
  };
  document.getElementById('visual-title').textContent = safeSpec.title;
  document.getElementById('labels').innerHTML = safeSpec.elements.slice(0, 6)
    .map((label, index) => `<li><span>${index + 1}</span>${label.replace(/[<>&]/g, '')}</li>`).join('');
  document.getElementById('relationship').textContent = safeSpec.relationships[0] || '';
  document.getElementById('limitation').textContent = safeSpec.modelLimitations[0] || 'Schematic model; not to scale.';
  const factory = sceneFactories[safeSpec.template] || generalScene;
  factory(safeSpec);
  window.setProgress(0);
  return true;
};

window.setProgress = value => {
  state.progress = Math.max(0, Math.min(1, Number(value) || 0));
  state.objects.forEach((object, index) => {
    object.visible = index / Math.max(1, state.objects.length - 1) <= Math.min(1, state.progress * 1.4 + 0.12);
  });
  state.movers.forEach((mover, index) => {
    if (mover.start && mover.end) {
      const eased = 0.5 - Math.cos(state.progress * Math.PI) / 2;
      mover.object.position.fromArray(mover.start).lerp(new THREE.Vector3(...mover.end), eased);
    } else if (mover.orbit) {
      const angle = mover.orbit.offset + state.progress * Math.PI * 2;
      mover.object.position.set(mover.orbit.centre + Math.cos(angle) * 2, Math.sin(angle) * 2, 0);
    } else if (mover.pulse !== undefined) {
      mover.object.scale.y = 0.9 + Math.sin(state.progress * Math.PI * 4 + mover.pulse) * 0.08;
    }
    mover.object.visible = state.progress > index / Math.max(1, state.movers.length) * 0.4;
  });
};

function animate(time) {
  camera.position.x = Math.sin(time * 0.00018) * 1.25;
  camera.position.y = 2.0 + Math.cos(time * 0.00015) * 0.45;
  camera.lookAt(0, 0, 0);
  state.objects.forEach((object, index) => {
    if (object.geometry?.type === 'SphereGeometry') object.rotation.y = time * 0.00025 + index;
  });
  renderer.render(scene, camera);
}
renderer.setAnimationLoop(animate);
window.__biology3dReady = true;

addEventListener('resize', () => {
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(innerWidth, innerHeight);
});
