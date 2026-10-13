const TAU = Math.PI * 2;
const clamp = v => Math.max(0, Math.min(1, v));
const smooth = v => { v = clamp(v); return v * v * (3 - 2 * v); };
const out = v => 1 - Math.pow(1 - clamp(v), 3);
const back = v => { v = clamp(v) - 1; return 1 + 2.70158 * v * v * v + 1.70158 * v * v; };
const mix = (a, b, v) => a + (b - a) * v;
const fract = v => v - Math.floor(v);
const noise = n => fract(Math.sin(n * 127.1 + 311.7) * 43758.5453123);

// Solid contours keep the insignia precise at every display scale.
const INSIGNIA = [
  { points: [[-165,-78],[-133,-78],[-133,78],[-165,78]], from: [-1.8,-.9], spin: -.38 },
  { points: [[-133,-78],[-102,-78],[-40,31],[-40,78],[-71,78],[-133,-31]], from: [.2,-2.4], spin: .48 },
  { points: [[-71,-78],[-39,-78],[-39,78],[-71,78]], from: [-1.2,1.7], spin: -.3 },
  { points: [[-14,-78],[112,-78],[112,-44],[-14,-44]], from: [1.9,-1.1], spin: .32 },
  { points: [[75,-44],[112,-44],[38,78],[-2,78]], from: [1.7,1.5], spin: -.42 },
  { points: [[130,-78],[141,-78],[68,78],[57,78]], from: [.4,2.1], spin: .55 },
  { points: [[152,-78],[185,-78],[112,78],[79,78]], from: [2.6,.2], spin: -.35, red: true },
];

export function createMotion(canvas) {
  const ctx = canvas.getContext('2d', { alpha: false });
  let width = 1440, height = 900, dpr = 1, unit = 900;
  const stars = Array.from({ length: 270 }, (_, i) => ({
    a: noise(i + 1) * TAU,
    r: .04 + noise(i + 273) * .96,
    z: noise(i + 671),
    size: .35 + noise(i + 312) * 1.15,
  }));
  const nodes = Array.from({ length: 28 }, (_, i) => ({
    a: noise(i + 985) * TAU,
    r: .15 + noise(i + 1310) * .75,
    z: noise(i + 881),
  }));

  function resize(w, h, ratio = window.devicePixelRatio || 1) {
    width = Math.max(1, w); height = Math.max(1, h); unit = Math.min(w, h);
    dpr = Math.min(2, Math.max(1, ratio));
    canvas.width = Math.round(width * dpr); canvas.height = Math.round(height * dpr);
    canvas.style.width = `${width}px`; canvas.style.height = `${height}px`;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  function line(x1, y1, x2, y2, color, weight = 1) {
    ctx.strokeStyle = color; ctx.lineWidth = weight;
    ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(x2, y2); ctx.stroke();
  }

  function arc(x, y, r, start, length, alpha = .45, weight = 1, color = '127,223,255') {
    if (r <= 0 || alpha <= 0) return;
    ctx.strokeStyle = `rgba(${color},${alpha})`; ctx.lineWidth = weight;
    ctx.beginPath(); ctx.arc(x, y, r, start, start + length); ctx.stroke();
  }

  function polygon(points, color) {
    ctx.fillStyle = color; ctx.beginPath();
    points.forEach(([x, y], i) => i ? ctx.lineTo(x, y) : ctx.moveTo(x, y));
    ctx.closePath(); ctx.fill();
  }

  function pulse(x, y, age, radius, alpha = 1) {
    if (age < 0 || age > 1.3) return;
    const p = age / 1.3;
    arc(x, y, radius * (.25 + out(p) * 1.6), 0, TAU, (1 - p) ** 2 * .65 * alpha, mix(5, .5, p));
    arc(x, y, radius * (.18 + out(p) * 1.32), 0, TAU, (1 - p) ** 3 * .35 * alpha, .7);
  }

  function etchedRing(x, y, radius, t, alpha, reveal = 1, mode = 0) {
    ctx.save(); ctx.translate(x, y);
    const spin = t * (mode ? -.085 : .11);
    for (let band = 0; band < 3; band++) {
      const r = radius * (1 + band * .068);
      const turn = spin * (band % 2 ? -1.65 : 1);
      for (let i = 0; i < 3; i++) {
        arc(0, 0, r, turn + i * TAU / 3, (TAU / 3 - .22) * reveal, alpha * (band === 1 ? .62 : .28), band === 1 ? 1.2 : .65);
      }
    }
    for (let i = 0; i < 96 * reveal; i++) {
      const angle = i / 96 * TAU + spin * .34;
      const large = i % 8 === 0;
      const r = radius * 1.142;
      line(Math.cos(angle) * r, Math.sin(angle) * r, Math.cos(angle) * (r + (large ? unit * .013 : unit * .004)), Math.sin(angle) * (r + (large ? unit * .013 : unit * .004)), `rgba(140,221,245,${alpha * (large ? .57 : .22)})`, large ? 1 : .55);
    }
    for (let i = 0; i < 6; i++) {
      const angle = i * TAU / 6 - spin * .8;
      arc(0, 0, radius * 1.205, angle, .055 * reveal, alpha * .75, 2.3);
    }
    ctx.restore();
  }

  function insignia(x, y, targetWidth, age, alpha = 1, assembled = false) {
    if (alpha <= 0) return;
    const settle = back(age / .85);
    const scale = targetWidth / 350 * mix(1.32, 1, settle);
    ctx.save(); ctx.translate(x, y); ctx.scale(scale, scale);
    ctx.globalAlpha = alpha;
    INSIGNIA.forEach((part, i) => {
      const p = assembled ? 1 : back((age - i * .048) / .66);
      if (age < i * .048 && !assembled) return;
      const cx = part.points.reduce((s, p) => s + p[0], 0) / part.points.length;
      const cy = part.points.reduce((s, p) => s + p[1], 0) / part.points.length;
      ctx.save();
      ctx.translate(part.from[0] * 440 * (1 - p), part.from[1] * 440 * (1 - p));
      ctx.translate(cx, cy); ctx.rotate(part.spin * (1 - p)); ctx.translate(-cx, -cy);
      ctx.shadowColor = part.red ? 'rgba(249,40,62,.46)' : 'rgba(123,216,255,.32)';
      ctx.shadowBlur = assembled ? 9 : 12 + Math.max(0, 1 - p) * 12;
      polygon(part.points, part.red ? '#f33d55' : '#e9f8ff');
      ctx.restore();
    });
    ctx.restore();
    const glint = age - 1.5;
    if (glint > 0 && glint < .55 && !assembled) {
      ctx.save(); ctx.globalCompositeOperation = 'screen';
      const sx = x + targetWidth * (glint / .55 - .5);
      const g = ctx.createLinearGradient(sx - 45, y, sx + 45, y);
      g.addColorStop(0, 'rgba(90,188,240,0)'); g.addColorStop(.5, 'rgba(158,230,255,.2)'); g.addColorStop(1, 'rgba(90,188,240,0)');
      ctx.fillStyle = g; ctx.fillRect(sx - 45, y - targetWidth * .25, 90, targetWidth * .5);
      ctx.restore();
    }
  }

  function background(t) {
    ctx.fillStyle = '#020711'; ctx.fillRect(0, 0, width, height);
    const glowX = t < 3.2 ? .5 : t < 6.8 ? .65 : t < 10 ? .5 : t < 19 ? .76 : .5;
    const g = ctx.createRadialGradient(width * glowX, height * .43, 0, width * glowX, height * .43, width * .67);
    g.addColorStop(0, 'rgba(17,59,85,.31)'); g.addColorStop(.43, 'rgba(4,24,44,.35)'); g.addColorStop(1, 'rgba(0,2,8,0)');
    ctx.fillStyle = g; ctx.fillRect(0, 0, width, height);
    const warp = t < 3.2 ? .06 : t < 4.7 ? (1 - smooth((t - 3.2) / 1.5)) * .75 : t >= 19 && t < 20.55 ? Math.sin(clamp((t - 19) / 1.55) * Math.PI) : .015;
    const originX = width * (t >= 10 && t < 19 ? .73 : .5), originY = height * .46;
    ctx.save(); ctx.globalCompositeOperation = 'screen';
    stars.forEach((s, i) => {
      const depth = fract(s.r + t * (.014 + s.z * .018) + (t > 19 ? out((t - 19) / 1.8) * .75 : 0));
      const r = depth * Math.hypot(width, height) * .65;
      const a = s.a + t * .002;
      const x = originX + Math.cos(a) * r, y = originY + Math.sin(a) * r * .69;
      const brightness = Math.min(1, depth * 3) * (.14 + s.z * .35);
      if (warp > .1) {
        const tail = Math.max(2, depth * unit * .22 * warp);
        line(x, y, x - Math.cos(a) * tail, y - Math.sin(a) * tail * .69, `rgba(124,209,255,${brightness * .76})`, s.size * .6);
      }
      ctx.fillStyle = `rgba(184,230,255,${brightness})`;
      ctx.beginPath(); ctx.arc(x, y, s.size * (.45 + depth * .55), 0, TAU); ctx.fill();
      if (i % 23 === 0) {
        const n = 2 + Math.sin(t * 1.3 + i) * .5;
        line(x - n, y, x + n, y, `rgba(180,235,255,${brightness * .45})`, .6);
        line(x, y - n, x, y + n, `rgba(180,235,255,${brightness * .45})`, .6);
      }
    });
    ctx.restore();
    ctx.strokeStyle = 'rgba(115,202,238,.025)'; ctx.lineWidth = .7;
    const step = unit * .093;
    for (let x = (width % step) / 2; x < width; x += step) line(x, 0, x, height, 'rgba(100,185,228,.022)', .5);
    for (let y = (height % step) / 2; y < height; y += step) line(0, y, width, y, 'rgba(100,185,228,.02)', .5);
    const margin = width * .045;
    for (const x of [margin, width - margin]) {
      for (const y of [height * .17, height * .82]) {
        line(x - 5, y, x + 5, y, 'rgba(142,218,243,.33)', .75);
        line(x, y - 5, x, y + 5, 'rgba(142,218,243,.33)', .75);
      }
    }
  }

  function opening(t) {
    const exit = smooth((t - 2.73) / .47);
    const alpha = 1 - exit;
    const x = width * (.5 + exit * .23), y = height * .46;
    const r = unit * .28 * mix(3.35, 1, out(t / 1.16)) * (1 - exit * .42);
    etchedRing(x, y, r, t * 1.7, .63 * alpha, out(t / .9));
    ctx.save(); ctx.translate(x, y); ctx.rotate(-.16 + t * .045 + exit * .65);
    for (let k = 0; k < 3; k++) {
      const p = out((t - k * .065) / 1.02);
      const rad = unit * (.37 + k * .095) * mix(3, 1, p);
      ctx.strokeStyle = `rgba(133,218,249,${.09 * alpha * p})`; ctx.lineWidth = .8;
      ctx.beginPath();
      for (let i = 0; i < 6; i++) { const a = i / 6 * TAU; const px = Math.cos(a) * rad, py = Math.sin(a) * rad; i ? ctx.lineTo(px, py) : ctx.moveTo(px, py); }
      ctx.closePath(); ctx.stroke();
    }
    ctx.restore();
    insignia(x, y, Math.min(width * .39, height * .52) * (1 - exit * .7), t, alpha);
    pulse(x, y, t - .46, unit * .36, alpha);
    const br = unit * .215;
    const locked = out((t - .7) / .5);
    const length = unit * .024;
    for (let sx of [-1, 1]) for (let sy of [-1, 1]) {
      const bx = x + sx * br * (1 + (1 - locked) * .8), by = y + sy * br * .62 * (1 + (1 - locked) * .8);
      line(bx, by, bx - sx * length, by, `rgba(170,234,255,${alpha * locked * .7})`, 1.1);
      line(bx, by, bx, by - sy * length, `rgba(170,234,255,${alpha * locked * .7})`, 1.1);
    }
  }

  function arrival(age, t) {
    const enter = out(age / 1.2), fade = 1 - smooth((age - 3.15) / .45);
    const x = width * .64, y = height * .47;
    const rad = unit * .36 * mix(1.55, 1, enter);
    etchedRing(x, y, rad, t, .32 * enter * fade, enter);
    ctx.save(); ctx.translate(x, y); ctx.scale(1, .28); ctx.rotate(-.2);
    for (let i = 0; i < 6; i++) arc(0, 0, unit * (.31 + i * .087), age * .06, TAU, .12 * enter * fade, .75);
    ctx.restore();
    const horizonY = height * (.55 + (1 - enter) * .23);
    const gradient = ctx.createLinearGradient(0, 0, width, 0);
    gradient.addColorStop(0, 'rgba(92,191,249,0)'); gradient.addColorStop(.66, `rgba(144,228,255,${.3 * enter * fade})`); gradient.addColorStop(1, 'rgba(92,191,249,0)');
    line(0, horizonY, width, horizonY, gradient, 1);
    pulse(x, y, age, unit * .35, .55);
    for (let i = 0; i < 7; i++) {
      const p = fract(age * .2 + i / 7);
      const xx = width * (1 - p);
      const yy = height * (.24 + i * .072);
      line(xx, yy, xx + width * (.08 + .07 * (1 - enter)), yy, `rgba(101,197,248,${.08 * fade * (1 - p)})`, .7);
    }
  }

  function identity(age, t) {
    const enter = out(age / 1.12), fade = 1 - smooth((age - 2.75) / .45);
    const x = width * .5, y = height * .46, rad = unit * .287 * mix(3.35, 1, enter);
    etchedRing(x, y, rad, t * 1.4, .7 * fade, out(age / 1.3), 1);
    pulse(x, y, age - .28, unit * .34, fade * .6);
    const br = width * .25 * mix(1.4, 1, back(age / .75));
    const by = unit * .137;
    for (const sx of [-1, 1]) for (const sy of [-1, 1]) {
      const bx = x + sx * br, yy = y + sy * by;
      line(bx, yy, bx - sx * unit * .033, yy, `rgba(172,236,255,${enter * fade * .65})`, 1);
      line(bx, yy, bx, yy - sy * unit * .033, `rgba(172,236,255,${enter * fade * .65})`, 1);
    }
    const sweep = fract(age * .35);
    const sy = y - rad + rad * 2 * sweep;
    ctx.save(); ctx.beginPath(); ctx.arc(x, y, rad * .91, 0, TAU); ctx.clip();
    const g = ctx.createLinearGradient(0, sy - unit * .045, 0, sy + 1);
    g.addColorStop(0, 'rgba(70,201,255,0)'); g.addColorStop(1, `rgba(79,205,255,${.07 * fade})`);
    ctx.fillStyle = g; ctx.fillRect(x - rad, sy - unit * .045, rad * 2, unit * .045);
    line(x - rad, sy, x + rad, sy, `rgba(139,227,255,${.2 * fade})`, .7);
    ctx.restore();
  }

  function network(age, t, mcp = false) {
    const enter = out(age / .85), fade = 1 - smooth((age - (mcp ? 3.95 : 4.15)) / .45);
    const x = width * .74, y = height * .49, rad = unit * .273;
    const alpha = enter * fade;
    ctx.save(); ctx.translate(x, y); ctx.scale(mix(1.8, 1, enter), mix(1.8, 1, enter));
    etchedRing(0, 0, rad, t * (mcp ? -.8 : 1), .43 * alpha, enter);
    for (let k = 0; k < 3; k++) {
      ctx.save(); ctx.rotate(k * Math.PI / 3 + age * .028);
      ctx.scale(1, .32 + .075 * k); arc(0, 0, rad * .86, 0, TAU, .15 * alpha, .8); ctx.restore();
    }
    for (let k = 1; k < 4; k++) arc(0, 0, rad * k / 4, 0, TAU, .09 * alpha, .7);
    line(-rad, 0, rad, 0, `rgba(139,215,245,${.13 * alpha})`, .6);
    line(0, -rad, 0, rad, `rgba(139,215,245,${.13 * alpha})`, .6);
    const phase = age * .59 - Math.PI * .65;
    const scan = ctx.createConicGradient(phase, 0, 0);
    scan.addColorStop(0, 'rgba(69,182,241,0)'); scan.addColorStop(.85, 'rgba(69,182,241,0)'); scan.addColorStop(.999, `rgba(69,182,241,${.09 * alpha})`); scan.addColorStop(1, 'rgba(69,182,241,0)');
    ctx.fillStyle = scan; ctx.beginPath(); ctx.arc(0, 0, rad, 0, TAU); ctx.fill();
    line(0, 0, Math.cos(phase) * rad, Math.sin(phase) * rad, `rgba(130,224,255,${.36 * alpha})`, 1);
    const count = mcp ? 12 : 22;
    const points = nodes.slice(0, count).map((n, i) => ({ x: Math.cos(n.a + t * .014) * n.r * rad, y: Math.sin(n.a + t * .014) * n.r * rad * .81, seen: smooth((age - i * (mcp ? .16 : .1)) / .55) }));
    points.forEach((p, i) => {
      const next = points[(i + (mcp ? 3 : 1)) % count];
      const a = Math.min(p.seen, next.seen) * alpha;
      line(p.x, p.y, next.x, next.y, `rgba(108,205,250,${a * .13})`, .7);
      if (mcp && i % 3 === 0) line(p.x, p.y, 0, 0, `rgba(147,231,255,${a * .21})`, 1);
      ctx.fillStyle = `rgba(174,234,255,${p.seen * alpha * .85})`;
      ctx.beginPath(); ctx.arc(p.x, p.y, (mcp ? 2.2 : 1.7) + Math.sin(age * 2 + i) * .35, 0, TAU); ctx.fill();
      if (i % 4 === 0) arc(p.x, p.y, 6 + Math.sin(age * 1.5 + i) * 2, 0, TAU, .2 * p.seen * alpha, .7);
      const carrier = fract(age * .5 + i * .31);
      if (i % 3 === 0 && a > 0) {
        ctx.fillStyle = `rgba(193,244,255,${a * .9})`;
        ctx.beginPath(); ctx.arc(mix(p.x, next.x, carrier), mix(p.y, next.y, carrier), 1.4, 0, TAU); ctx.fill();
      }
    });
    ctx.restore();
    const branchCount = mcp ? 4 : 8;
    for (let i = 0; i < branchCount; i++) {
      const p = out((age - .35 - i * .11) / .55);
      const yy = height * (.345 + i * (mcp ? .088 : .047));
      const x1 = width * .47, x2 = width * .535, x3 = width * .59;
      const targetY = y + (i - (branchCount - 1) / 2) * unit * .026;
      ctx.strokeStyle = `rgba(112,204,245,${alpha * p * .2})`; ctx.lineWidth = .7;
      ctx.beginPath(); ctx.moveTo(x1, yy); ctx.lineTo(mix(x1, x2, p), yy);
      if (p > .55) { ctx.lineTo(mix(x2, x3, (p - .55) / .45), mix(yy, targetY, (p - .55) / .45)); }
      ctx.stroke();
    }
    const sx = width * (.075 + fract(age * .22) * .395);
    const g = ctx.createLinearGradient(sx - unit * .09, 0, sx, 0);
    g.addColorStop(0, 'rgba(104,210,255,0)'); g.addColorStop(1, `rgba(104,210,255,${.045 * alpha})`);
    ctx.save(); ctx.beginPath(); ctx.rect(width * .075, height * .31, width * .41, height * .42); ctx.clip();
    ctx.transform(1, 0, -.2, 1, height * .09, 0);
    ctx.fillStyle = g; ctx.fillRect(sx - unit * .09, height * .31, unit * .09, height * .42);
    line(sx, height * .31, sx, height * .73, `rgba(114,223,255,${alpha * .23})`, 1);
    ctx.restore();
  }

  function finale(age, t) {
    const enter = out((age - .33) / 1.15);
    const x = width * .5, y = height * .32;
    const rad = unit * .2 * mix(3.35, 1, enter);
    etchedRing(x, y, rad, t * .8, .55 * enter, enter);
    insignia(x, y, Math.min(width * .22, height * .3), age - .35, enter);
    pulse(x, y, age - .82, unit * .42, .65);
    const horizon = smooth((age - 1.9) / .8);
    const g = ctx.createLinearGradient(0, 0, width, 0);
    g.addColorStop(0, 'rgba(92,210,255,0)'); g.addColorStop(.5, `rgba(137,228,255,${horizon * .5})`); g.addColorStop(1, 'rgba(92,210,255,0)');
    line(width * .15, height * .76, width * .85, height * .76, g, .75);
    for (let i = 0; i < 3; i++) {
      const p = out((age - i * .115) / 1.05);
      if (p <= 0 || p >= 1) continue;
      ctx.save(); ctx.translate(width * (1.5 - p * 3), 0); ctx.transform(1, 0, -.42, 1, 0, 0);
      ctx.fillStyle = `rgba(27,105,149,${.16 * Math.sin(p * Math.PI)})`;
      ctx.fillRect(-width * .15 + i * width * .19, 0, width * .28, height); ctx.restore();
    }
  }

  function sweeps(t) {
    for (const at of [3.2, 6.8, 10, 14.6, 19]) {
      const age = t - at;
      if (age < -.17 || age > .65) continue;
      for (let k = 0; k < 3; k++) {
        const p = clamp((age + .17 - k * .052) / .67);
        if (p === 0 || p === 1) continue;
        ctx.save(); ctx.translate(width * (-.8 + p * 2.9), 0); ctx.transform(1, 0, -.38, 1, 0, 0);
        const g = ctx.createLinearGradient(-width * .15, 0, width * .15, 0);
        const opacity = Math.sin(p * Math.PI) * (k === 0 ? .13 : .06);
        g.addColorStop(0, 'rgba(43,166,239,0)'); g.addColorStop(.7, `rgba(67,179,242,${opacity})`); g.addColorStop(1, 'rgba(163,230,255,0)');
        ctx.fillStyle = g; ctx.fillRect(-width * .15, 0, width * .3, height);
        line(width * .06, 0, width * .06, height, `rgba(181,237,255,${opacity * 2})`, 1);
        ctx.restore();
      }
    }
  }

  function update(time) {
    const t = Math.max(0, Math.min(24, Number(time) || 0));
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.globalAlpha = 1; ctx.globalCompositeOperation = 'source-over';
    background(t);
    if (t < 3.2) opening(t);
    else if (t < 6.8) arrival(t - 3.2, t);
    else if (t < 10) identity(t - 6.8, t);
    else if (t < 14.6) network(t - 10, t);
    else if (t < 19) network(t - 14.6, t, true);
    else finale(t - 19, t);
    sweeps(t);
    const vignette = ctx.createRadialGradient(width * .5, height * .48, unit * .2, width * .5, height * .48, Math.hypot(width, height) * .6);
    vignette.addColorStop(0, 'rgba(0,1,6,0)'); vignette.addColorStop(1, 'rgba(0,1,6,.57)');
    ctx.fillStyle = vignette; ctx.fillRect(0, 0, width, height);
  }

  resize(canvas.clientWidth || width, canvas.clientHeight || height);
  return { resize, update, dispose() { ctx.clearRect(0, 0, width, height); } };
}
