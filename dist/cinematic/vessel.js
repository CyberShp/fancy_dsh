import * as THREE from '../vendor/three.module.js';
import { createNormandy } from '../ship.js';

const clamp = (v, lo = 0, hi = 1) => Math.max(lo, Math.min(hi, v));
const smooth = v => { const x = clamp(v); return x * x * (3 - 2 * x); };
const easeOut = v => 1 - Math.pow(1 - clamp(v), 3);
const mix = (a, b, p) => a + (b - a) * p;

/** Normandy flyby and tactical model. All motion is derived from the film clock. */
export function createVessel(canvas) {
  const renderer = new THREE.WebGLRenderer({ canvas, alpha: true, antialias: true, powerPreference: 'high-performance' });
  renderer.setClearColor(0x000000, 0);
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.45;
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(33, 1, .1, 220);
  const hero = createNormandy();
  const tactical = createNormandy();
  const heroRig = new THREE.Group();
  const tacticalRig = new THREE.Group();
  heroRig.add(hero.group);
  tacticalRig.add(tactical.group);
  scene.add(heroRig, tacticalRig);

  const extraMaterials = [];
  const retiredMaterials = new Set();
  hero.group.traverse(obj => {
    if (obj.isMesh && obj.material.isMeshBasicMaterial && obj.material.blending !== THREE.AdditiveBlending) {
      const source = obj.material;
      retiredMaterials.add(source);
      const color = source.color.clone();
      if (color.r + color.g + color.b > 1.15) color.set(0xd3e5ec);
      else if (color.b > .28 && color.r > .10) color.set(0x8eacbb);
      else if (source.opacity > .55) color.set(0x102433);
      const material = new THREE.MeshStandardMaterial({
        color, metalness: .46, roughness: .44,
        vertexColors: !!obj.geometry.attributes.color,
        side: THREE.DoubleSide,
      });
      if (source.color.b > .35 && source.color.r < .08) material.color.set(0x24638a);
      obj.material = material;
      extraMaterials.push(material);
    } else if (obj.isLineSegments) {
      obj.material.opacity *= .32;
    } else if (obj.material?.isShaderMaterial) {
      obj.visible = false;
    }
  });

  const hemisphere = new THREE.HemisphereLight(0xc4eeff, 0x071524, 2.5);
  const key = new THREE.DirectionalLight(0xe9f7ff, 4.4);
  key.position.set(3, 8, 5);
  const rim = new THREE.DirectionalLight(0x2096ff, 5.2);
  rim.position.set(-7, 1, -5);
  const warm = new THREE.DirectionalLight(0xffdebf, .85);
  warm.position.set(10, 2, -2);
  scene.add(hemisphere, key, rim, warm);

  // Analytic radial texture keeps the engine bloom smooth at every viewport size.
  const size = 128;
  const pixels = new Uint8Array(size * size * 4);
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const r = Math.hypot((x + .5 - size / 2) / (size / 2), (y + .5 - size / 2) / (size / 2));
    const i = (y * size + x) * 4;
    pixels[i] = 155; pixels[i + 1] = 231; pixels[i + 2] = 255;
    pixels[i + 3] = Math.round(clamp(Math.exp(-r * r * 10) * Math.pow(1 - clamp(r), .6)) * 255);
  }
  const glowTexture = new THREE.DataTexture(pixels, size, size, THREE.RGBAFormat);
  glowTexture.needsUpdate = true;
  glowTexture.magFilter = THREE.LinearFilter;
  glowTexture.minFilter = THREE.LinearFilter;
  const drivePoints = [[-5.57, .31, -3.32, .265], [-5.57, .31, 3.32, .265], [-5.1, -.07, -1.58, .19], [-5.1, -.07, 1.58, .19]];
  const plumes = new THREE.Group();
  const bloomSprites = [];
  hero.group.add(plumes);
  for (const [x, y, z, radius] of drivePoints) {
    const material = new THREE.SpriteMaterial({ map: glowTexture, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, opacity: .94 });
    extraMaterials.push(material);
    const glow = new THREE.Sprite(material);
    glow.position.set(x - .2, y, z);
    glow.scale.set(2.6, 2.6, 1);
    bloomSprites.push(glow);
    plumes.add(glow);
    for (let layer = 0; layer < 2; layer++) {
      const length = layer ? 4.6 : 7.4;
      const geometry = new THREE.ConeGeometry(radius * (layer ? .43 : .78), length, 32, 1, true);
      geometry.rotateZ(Math.PI / 2);
      geometry.translate(x - length / 2 - .16, y, z);
      const exhaustMaterial = new THREE.MeshBasicMaterial({ color: layer ? 0xb4f4ff : 0x1b88ff, transparent: true, opacity: layer ? .35 : .10, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide });
      extraMaterials.push(exhaustMaterial);
      plumes.add(new THREE.Mesh(geometry, exhaustMaterial));
    }
  }

  let width = 1;
  let height = 1;
  function resize(w, h, dpr = 1) {
    width = Math.max(1, w);
    height = Math.max(1, h);
    renderer.setPixelRatio(Math.min(2, Math.max(1, dpr)));
    renderer.setSize(width, height, false);
    camera.aspect = width / height;
    camera.updateProjectionMatrix();
  }

  function update(t) {
    heroRig.visible = t >= 3.2 && t < 6.8;
    tacticalRig.visible = t >= 10 && t < 19;
    if (!heroRig.visible && !tacticalRig.visible) {
      renderer.clear();
      return;
    }
    camera.position.set(0, 10, 19);
    camera.lookAt(0, 0, 0);
    const wide = clamp(camera.aspect / 1.55, .65, 1.18);
    if (heroRig.visible) {
      const entry = easeOut((t - 3.2) / 1.18);
      const glide = smooth((t - 4.05) / 1.55);
      const leave = Math.pow(clamp((t - 5.75) / 1.05), 2.35);
      heroRig.position.set(mix(-10.2, -.5, entry) + glide * .8 + leave * 20, mix(-2.4, -.25, entry) + leave * 4.5, mix(-28, 0, entry) + leave * 4);
      heroRig.scale.setScalar(mix(.18, 1.22 * wide, entry) * (1 + leave * .36));
      hero.group.rotation.set(mix(-.23, .06, entry) + glide * .1, mix(-.9, -.10, glide), mix(-.34, .12, glide) + leave * .3);
      camera.position.set(mix(-1.3, .4, glide), mix(10.5, 8.7, glide), mix(20.5, 17.9, glide));
      camera.lookAt(0, -.25, 0);
      for (let i = 0; i < bloomSprites.length; i++) {
        const size = 2.2 + .12 * Math.sin(t * 18 + i * 2) + leave * 1.5;
        bloomSprites[i].scale.set(size, size, 1);
      }
    }
    if (tacticalRig.visible) {
      const intro = easeOut((t - 10) / .8);
      const outro = 1 - smooth((t - 18.55) / .45);
      const fieldHeight = 2 * Math.tan(THREE.MathUtils.degToRad(camera.fov / 2)) * camera.position.length();
      const fieldWidth = fieldHeight * camera.aspect;
      tacticalRig.position.set(fieldWidth * .275, .4, 0);
      tacticalRig.scale.setScalar((.50 + .04 * Math.sin((t - 10) * .4)) * intro * outro * Math.min(1, camera.aspect / 1.5));
      tactical.group.rotation.set(.09 + Math.sin(t * .36) * .055, -.52 + (t - 10) * .17, -.10);
      tactical.update(t, .86 * intro * outro);
    }
    renderer.render(scene, camera);
  }

  function dispose() {
    const geometries = new Set();
    const materials = new Set(extraMaterials);
    scene.traverse(obj => {
      if (obj.geometry) geometries.add(obj.geometry);
      if (obj.material) for (const material of Array.isArray(obj.material) ? obj.material : [obj.material]) materials.add(material);
    });
    for (const geometry of geometries) geometry.dispose();
    for (const material of [...materials, ...retiredMaterials]) material.dispose();
    glowTexture.dispose();
    renderer.dispose();
  }
  return { resize, update, dispose };
}
