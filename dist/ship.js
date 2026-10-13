import * as THREE from './vendor/three.module.js';

/** Procedural reconnaissance frigate, bow +X, dorsal +Y. */
export function createNormandy() {
  const group = new THREE.Group();
  group.name = 'Normandy SR-2 hologram';
  const materials = [];
  const engines = [];
  const lineVertices = [];
  const fineVertices = [];
  const CYAN = 0x85eaff;
  const ICE = 0xd8f7ff;

  function material(color, opacity, extra = {}) {
    const m = new THREE.MeshBasicMaterial({ color, opacity, transparent: true,
      depthWrite: false, side: THREE.DoubleSide, ...extra });
    materials.push({ material: m, opacity });
    return m;
  }
  const hull = material(0x6dacbf, 0.24, { vertexColors: true });
  const armor = material(0xabdae4, 0.31, { vertexColors: true });
  const underside = material(0x356f84, 0.19, { vertexColors: true });
  const dark = material(0x123b51, 0.61);
  const light = material(ICE, 0.8, { blending: THREE.AdditiveBlending });
  const stripe = material(0x278bb2, 0.64);
  const engineMat = material(0x67dfff, 0.92, { blending: THREE.AdditiveBlending });

  function addLine(a, b, fine = false) {
    (fine ? fineVertices : lineVertices).push(...a, ...b);
  }
  function polyline(points, close = false, fine = false) {
    for (let i = 1; i < points.length; i++) addLine(points[i - 1], points[i], fine);
    if (close) addLine(points.at(-1), points[0], fine);
  }
  function mesh(geo, mat, outline = true) {
    const obj = new THREE.Mesh(geo, mat);
    group.add(obj);
    if (outline) {
      const edges = new THREE.EdgesGeometry(geo, 17);
      const arr = edges.attributes.position.array;
      for (let i = 0; i < arr.length; i++) lineVertices.push(arr[i]);
      edges.dispose();
    }
    return obj;
  }

  // Each loft station is [longitudinal position, half width, height, center height].
  function loft(stations, zCenter = 0, mat = hull, outline = true) {
    const rings = stations.map(([x, w, h, y = 0]) => [
      [x, y + h * .52, zCenter - w * .55],
      [x, y + h * .52, zCenter + w * .55],
      [x, y + h * .18, zCenter + w],
      [x, y - h * .23, zCenter + w],
      [x, y - h * .52, zCenter + w * .5],
      [x, y - h * .52, zCenter - w * .5],
      [x, y - h * .23, zCenter - w],
      [x, y + h * .18, zCenter - w],
    ]);
    const points = [], colors = [];
    const faceTones = [.94, .68, .53, .38, .32, .43, .64, .83];
    function tri(a, b, c, shade) {
      points.push(...a, ...b, ...c);
      for (let j = 0; j < 3; j++) colors.push(shade * .76, shade * .94, shade);
    }
    for (let i = 1; i < rings.length; i++) {
      for (let j = 0; j < 8; j++) {
        const k = (j + 1) % 8;
        tri(rings[i-1][j], rings[i][j], rings[i][k], faceTones[j]);
        tri(rings[i-1][j], rings[i][k], rings[i-1][k], faceTones[j]);
      }
    }
    for (const ring of [rings[0], rings.at(-1)]) {
      for (let j = 1; j < 7; j++) tri(ring[0], ring[j], ring[j + 1], .7);
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(points, 3));
    geo.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
    geo.computeVertexNormals();
    const obj = mesh(geo, mat, outline);
    return { obj, rings };
  }

  function plate(points, thickness, mat = armor) {
    const p = [], cols = [];
    function tri(a, b, c, shade) {
      p.push(...a, ...b, ...c);
      for (let j = 0; j < 3; j++) cols.push(shade * .8, shade * .94, shade);
    }
    const lower = points.map(([x,y,z]) => [x,y-thickness,z]);
    for (let i=1;i<points.length-1;i++) {
      tri(points[0],points[i],points[i+1],.95);
      tri(lower[0],lower[i+1],lower[i],.35);
    }
    for(let i=0;i<points.length;i++) {
      const j=(i+1)%points.length;
      tri(points[i],lower[i],lower[j],.6);
      tri(points[i],lower[j],points[j],.6);
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position',new THREE.Float32BufferAttribute(p,3));
    geo.setAttribute('color',new THREE.Float32BufferAttribute(cols,3));
    geo.computeVertexNormals();
    return mesh(geo,mat);
  }
  function box(x,y,z,sx,sy,sz,mat) {
    const geo = new THREE.BoxGeometry(sx,sy,sz);
    geo.translate(x,y,z);
    return mesh(geo,mat,false);
  }
  function engine(x,y,z,radius) {
    const rimGeo = new THREE.CylinderGeometry(radius,radius * .9,.3,12,1,true);
    rimGeo.rotateZ(Math.PI/2); rimGeo.translate(x,y,z);
    mesh(rimGeo,dark,false);
    const disc = new THREE.CircleGeometry(radius*.77,24);
    disc.rotateY(-Math.PI/2); disc.translate(x-.17,y,z);
    const em = engineMat.clone();
    materials.push({material:em,opacity:.92});
    const obj = mesh(disc,em,false);
    engines.push(em);
    const ring = new THREE.TorusGeometry(radius,.016,4,32);
    ring.rotateY(Math.PI/2);ring.translate(x-.18,y,z);
    mesh(ring,light,false);
    const core = new THREE.CircleGeometry(radius*.27,12);
    core.rotateY(-Math.PI/2); core.translate(x-.19,y,z);
    mesh(core,light,false);
    // Nested ion cones make the exhaust luminous from oblique viewpoints.
    for (let i=0;i<2;i++) {
      const plume = new THREE.ConeGeometry(radius*(i ? .45 : .7),.85 + i*.4,12,1,true);
      plume.rotateZ(Math.PI/2);plume.translate(x-.58-i*.15,y,z);
      mesh(plume,material(CYAN,.055 + i*.025,{blending:THREE.AdditiveBlending}),false);
    }
    return obj;
  }

  const body = loft([
    [-4.65,.37,.48,.02],[-3.8,.62,.75,.08],[-2.4,.86,1.03,.14],
    [-.9,.98,1.09,.16],[.9,.82,.85,.12],[2.6,.62,.65,.055],
    [4.2,.43,.45,.015],[5.45,.21,.24,-.025],[6.2,.025,.08,-.045],
  ]);
  // A separate dorsal shell gives the frigate its slim forward-neck silhouette.
  loft([[-3.9,.27,.32,.48],[-2.4,.5,.55,.64],[-.7,.54,.52,.64],
    [.65,.41,.36,.56],[1.9,.26,.22,.4],[3.05,.07,.12,.31]],0,armor);
  loft([[-3.65,.29,.25,-.47],[-1.2,.47,.4,-.45],[.6,.35,.29,-.35],
    [3.25,.065,.12,-.21]],0,underside);

  // Dorsal central band and paired flight-deck windows.
  plate([[-3.45,.925,-.075],[-.75,.925,-.075],[1.28,.568,-.06],
    [2.45,.36,0],[1.28,.568,.06],[-.75,.925,.075],[-3.45,.925,.075]],.008,stripe);
  for (const side of [-1,1]) {
    plate([[.12,.813,side*.3],[.66,.739,side*.28],[1.55,.537,side*.17],
      [1.19,.515,side*.3],[.4,.696,side*.43]],.012,dark);
    polyline([[.14,.818,side*.31],[.67,.747,side*.29],[1.52,.548,side*.18]],false,true);
  }

  for (const side of [-1,1]) {
    const s = side;
    // Long swept shoulders connect the core to independent nacelles.
    plate([[1.45,.24,s*.64],[.1,.38,s*1.38],[-2.1,.37,s*3.46],
      [-4.85,.16,s*3.66],[-4.14,.14,s*2.64],[-2.5,.2,s*.65]],.16);
    plate([[-.08,.405,s*1.23],[-1.92,.405,s*2.98],[-3.52,.29,s*3.19],
      [-2.58,.295,s*2.4]],.035,hull);
    polyline([[.94,.27,s*.84],[-.21,.413,s*1.55],[-2.26,.413,s*3.34],
      [-4.55,.205,s*3.51]],false,true);
    polyline([[-1.03,.411,s*1.15],[-2.32,.411,s*2.52],[-4.24,.21,s*2.98]],false,true);
    // Outboard drive pods: broad aft exhaust and tapered forward armor.
    const z = s*3.32;
    const nacelle = loft([[-5.48,.29,.47,.29],[-4.96,.46,.7,.31],
      [-3.95,.48,.68,.35],[-1.66,.37,.52,.43],[-.33,.26,.39,.43],
      [.68,.07,.19,.42]],z,armor);
    loft([[-4.95,.19,.21,.73],[-2.5,.17,.2,.73],[-1.12,.075,.12,.66]],z,hull);
    // Engine-rib seams and narrow blue inset running the length of each pod.
    for (let i=1;i<nacelle.rings.length-1;i++) polyline(nacelle.rings[i],true,true);
    box(-3.27,.71,z,2.25,.025,.062,stripe);
    engine(-5.57,.31,z,.265);
    // Inner auxiliary drives complete the four-engine planform.
    const inner = s*1.58;
    plate([[-1.22,.13,s*.75],[-1.96,.08,s*1.7],[-4.43,-.07,s*1.8],
      [-4.01,-.12,s*.7]],.11,underside);
    loft([[-5.02,.24,.36,-.07],[-4.47,.31,.46,-.035],[-2.84,.23,.35,.035],
      [-1.7,.055,.16,.12]],inner,hull);
    engine(-5.1,-.07,inner,.19);
    // Wingtip navigation light and flat aerodynamic end-fins.
    plate([[-3.9,.58,s*3.47],[-4.5,1.02,s*3.48],[-5.24,.46,s*3.49]],.045,hull);
    box(-.3,.615,z,.12,.025,.14,light);
    box(-4.67,.51,z+s*.34,.28,.028,.025,light);
    // Small nose sensor, shoulder insets, and service-panel geometry.
    plate([[2.54,.349,s*.31],[3.95,.235,s*.2],[3.28,.259,s*.32],
      [2.55,.322,s*.4]],.007,stripe);
    for(let i=0;i<5;i++) {
      const x=-2.48+i*.24;
      box(x,.724,s*.66,.09,.028,.19,dark);
      addLine([x,.75,s*.55],[x,.75,s*.75],true);
    }
    for(let i=0;i<4;i++) {
      const x=1.5+i*.67;
      const w=.69-(x-1.5)*.115;
      addLine([x,.15,s*w],[x+.13,.25,s*(w-.08)],true);
    }
  }

  // Continuous structural seams follow selected facets, with cross-bulkhead detail.
  for(let i=1;i<body.rings.length-1;i++) polyline(body.rings[i],true,true);
  for(const j of [0,1,3,6]) polyline(body.rings.map(r=>r[j]),false,true);
  for(let i=0;i<7;i++) {
    const x=-2.9+i*.43;
    addLine([x,-.395,-.35],[x,-.395,.35],true);
  }

  // Tactical markings use geometry, keeping the module self-contained.
  for (const side of [-1,1]) {
    const z=side*.69;
    polyline([[-1.05,.715,z],[-1.05,.715,z+side*.1],[-.53,.715,z+side*.1]],false,true);
    polyline([[-.38,.696,z],[-.08,.657,z],[-.08,.657,z+side*.09]],false,true);
    for(let i=0;i<3;i++) addLine([-3.47+i*.17,.66,side*.47],[-3.39+i*.17,.66,side*.56],true);
  }

  function lines(vertices,color,opacity) {
    const geo=new THREE.BufferGeometry();
    geo.setAttribute('position',new THREE.Float32BufferAttribute(vertices,3));
    const mat=new THREE.LineBasicMaterial({color,transparent:true,opacity,
      depthWrite:false,blending:THREE.AdditiveBlending});
    materials.push({material:mat,opacity});
    const obj=new THREE.LineSegments(geo,mat);group.add(obj);return obj;
  }
  lines(lineVertices,CYAN,.56);
  lines(fineVertices,0x96dce8,.25);

  // A thin scanning plane intersects the actual faceted hull surface.
  const scanMat = new THREE.ShaderMaterial({
    transparent:true,depthWrite:false,side:THREE.DoubleSide,
    blending:THREE.AdditiveBlending,
    uniforms:{uScan:{value:-6},uOpacity:{value:0}},
    vertexShader:`varying vec3 vPosition;
      void main(){vPosition=position;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0);}`,
    fragmentShader:`uniform float uScan;uniform float uOpacity;varying vec3 vPosition;
      void main(){float band=exp(-pow((vPosition.x-uScan)*8.0,2.0));
        gl_FragColor=vec4(.42,.89,1.,band*uOpacity);}`,
  });
  const scanSources=group.children.filter(obj=>obj.isMesh && (obj.material===hull || obj.material===armor));
  const scanPositions=[];
  for(const obj of scanSources) scanPositions.push(...obj.geometry.attributes.position.array);
  const scanGeo=new THREE.BufferGeometry();
  scanGeo.setAttribute('position',new THREE.Float32BufferAttribute(scanPositions,3));
  mesh(scanGeo,scanMat,false);

  function update(timeSeconds, reveal=1) {
    const r=THREE.MathUtils.clamp(reveal,0,1);
    group.visible=r>.001;
    for(const entry of materials) entry.material.opacity=entry.opacity*r;
    for(let i=0;i<engines.length;i++) engines[i].opacity=r*(.78+.14*Math.sin(timeSeconds*3.1+i*.63));
    scanMat.uniforms.uScan.value=-6.2+((timeSeconds*.2)%1)*12.6;
    scanMat.uniforms.uOpacity.value=r*.5;
  }
  update(0,1);
  return { group, update };
}
