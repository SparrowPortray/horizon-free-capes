// A small 3D renderer for blocky players on a 2D canvas: textured boxes with
// Minecraft's skin and cape layouts, a fixed studio light, painter's order and
// pixelated sampling. Units are skin pixels: a player is 32 tall and faces +z.
// The art itself (skins, capes, wings) is in art.js.
(function () {
  const A = window.DripArt;
  const RAD = Math.PI / 180;

  // Vectors ------------------------------------------------------------------
  const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
  const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
  const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
  const norm = (a) => { const l = Math.hypot(a[0], a[1], a[2]) || 1; return [a[0] / l, a[1] / l, a[2] / l]; };
  const rotX = (p, a) => { const c = Math.cos(a), s = Math.sin(a); return [p[0], p[1] * c - p[2] * s, p[1] * s + p[2] * c]; };
  const rotY = (p, a) => { const c = Math.cos(a), s = Math.sin(a); return [p[0] * c + p[2] * s, p[1], -p[0] * s + p[2] * c]; };
  const rotZ = (p, a) => { const c = Math.cos(a), s = Math.sin(a); return [p[0] * c - p[1] * s, p[0] * s + p[1] * c, p[2]]; };
  const hexRgb = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));

  function canvas(w, h) {
    const c = document.createElement('canvas');
    c.width = w;
    c.height = h;
    return c;
  }

  // Texture slices ---------------------------------------------------------------
  // Each face samples its own copy of its rectangle, padded by one repeated
  // pixel, so neighbouring faces of the atlas never bleed into an edge.
  const slices = new Map();
  function slice(img, x, y, w, h) {
    let byImg = slices.get(img);
    if (!byImg) slices.set(img, (byImg = new Map()));
    const key = `${x},${y},${w},${h}`;
    if (!byImg.has(key)) {
      const c = canvas(w + 2, h + 2), g = c.getContext('2d');
      g.imageSmoothingEnabled = false;
      g.drawImage(img, x, y, w, h, 1, 1, w, h);
      g.drawImage(img, x, y, w, 1, 1, 0, w, 1);
      g.drawImage(img, x, y + h - 1, w, 1, 1, h + 1, w, 1);
      g.drawImage(c, 1, 0, 1, h + 2, 0, 0, 1, h + 2);
      g.drawImage(c, w, 0, 1, h + 2, w + 1, 0, 1, h + 2);
      const data = g.getImageData(1, 1, w, h).data;
      let empty = true;
      for (let i = 3; i < data.length; i += 4) if (data[i] > 8) { empty = false; break; }
      byImg.set(key, { c, empty });
    }
    return byImg.get(key);
  }

  // Shaded copies of a texture, so lighting never shows seams between triangles.
  const shades = new Map();
  function shaded(img, level) {
    let row = shades.get(img);
    if (!row) shades.set(img, (row = []));
    if (!row[level]) {
      const c = canvas(img.width, img.height), g = c.getContext('2d');
      g.drawImage(img, 0, 0);
      g.globalCompositeOperation = 'source-atop';
      g.fillStyle = `rgba(0,0,0,${1 - level / 24})`;
      g.fillRect(0, 0, c.width, c.height);
      row[level] = c;
    }
    return row[level];
  }

  // Meshes ---------------------------------------------------------------------------
  // A face is { pts, color } or a textured { pts, tex, rect, pixel } in model space.
  // Box faces come in the order front (+z), back (-z), +x, -x, top, bottom.
  function box(min, max, color, xf = (p) => p) {
    const [x0, y0, z0] = min, [x1, y1, z1] = max;
    const P = (x, y, z) => xf([x, y, z]);
    return [
      [P(x0, y1, z1), P(x1, y1, z1), P(x1, y0, z1), P(x0, y0, z1)],
      [P(x1, y1, z0), P(x0, y1, z0), P(x0, y0, z0), P(x1, y0, z0)],
      [P(x1, y1, z1), P(x1, y1, z0), P(x1, y0, z0), P(x1, y0, z1)],
      [P(x0, y1, z0), P(x0, y1, z1), P(x0, y0, z1), P(x0, y0, z0)],
      [P(x0, y1, z0), P(x1, y1, z0), P(x1, y1, z1), P(x0, y1, z1)],
      [P(x0, y0, z1), P(x1, y0, z1), P(x1, y0, z0), P(x0, y0, z0)],
    ].map((pts) => ({ pts, color }));
  }

  // A box textured from an atlas: uv maps face names to [x, y, w, h].
  // The player's right side is -x, so -x takes the "right" rectangle.
  const ORDER = ['front', 'back', 'left', 'right', 'top', 'bottom'];
  function texBox(img, uv, min, max, xf, { overlay = false, pixel = true } = {}) {
    return box(min, max, '#808080', xf).flatMap((f, i) => {
      const [x, y, w, h] = uv[ORDER[i]];
      const s = slice(img, x, y, w, h);
      if (s.empty) return [];
      return [{ ...f, tex: s.c, rect: [1, 1, w, h], pixel, rim: !overlay, cells: [w > 10 ? 2 : 1, h > 10 ? 2 : 1] }];
    });
  }

  // Arm and leg angles for an emote at time t, each [z, x] in degrees.
  function posture(emote, t = 0) {
    const s = Math.sin(t * 7);
    const P = {
      wave: { r: [-150 - 16 * s, 0] },
      dance: { r: [-110 - 30 * s, 0], l: [110 - 30 * s, 0], rl: [0, 20 * s], ll: [0, -20 * s] },
      sit: { r: [-4, -30], l: [4, -30], rl: [6, -85], ll: [-6, -85], drop: 10 },
      point: { r: [-4, -90] },
      clap: { r: [12 + 10 * s, -70], l: [-12 - 10 * s, -70] },
      bow: { r: [-6, -40], l: [6, -40], lean: 28 },
      facepalm: { r: [26, -150], head: -12 },
      gg: { r: [-160 - 8 * s, 0], l: [160 + 8 * s, 0] },
    }[emote] || {};
    return { r: P.r || [-3, 0], l: P.l || [3, 0], rl: P.rl || [0, 0], ll: P.ll || [0, 0], drop: P.drop || 0, lean: P.lean || 0, head: P.head || 0 };
  }

  function limb(pivot, [z, x]) {
    return (p) => {
      const q = rotX(rotZ(sub(p, pivot), z * RAD), x * RAD);
      return [q[0] + pivot[0], q[1] + pivot[1], q[2] + pivot[2]];
    };
  }
  const then = (a, b) => (p) => b(a(p));

  // A whole player. look: { skin, cape, wings, hat, pet }, pose: { emote, t }.
  function player(look = {}, pose = {}, t = 0) {
    const skin = A.skinTexture(look.skin || 'nightowl_07');
    const P = posture(pose.emote, pose.t != null ? pose.t : t);
    const uv = (k) => A.boxUV(...A.PARTS[k]);
    // The upper body leans and drops together for bows and sitting.
    const upper = (p) => {
      const q = rotX(sub(p, [0, 12, 0]), P.lean * RAD);
      return [q[0], q[1] + 12 - P.drop, q[2]];
    };
    const legDrop = (p) => [p[0], p[1] - P.drop, p[2]];
    const headXf = then(limb([0, 24, 0], [0, P.head]), upper);
    const parts = [
      ['head', 'hat', [-4, 24, -4], [4, 32, 4], headXf, 0.5],
      ['body', 'jacket', [-4, 12, -2], [4, 24, 2], upper, 0.25],
      ['rarm', 'rsleeve', [-8, 12, -2], [-4, 24, 2], then(limb([-5, 22, 0], P.r), upper), 0.25],
      ['larm', 'lsleeve', [4, 12, -2], [8, 24, 2], then(limb([5, 22, 0], P.l), upper), 0.25],
      ['rleg', 'rpant', [-4, 0, -2], [0, 12, 2], then(limb([-2, 12, 0], P.rl), legDrop), 0.25],
      ['lleg', 'lpant', [0, 0, -2], [4, 12, 2], then(limb([2, 12, 0], P.ll), legDrop), 0.25],
    ];
    const faces = [];
    for (const [base, over, min, max, xf, k] of parts) {
      faces.push(...texBox(skin, uv(base), min, max, xf));
      faces.push(...texBox(skin, uv(over), min.map((v) => v - k), max.map((v) => v + k), xf, { overlay: true }));
    }
    if (look.cape) faces.push(...cape(look.cape, look, t, upper));
    if (look.wings) faces.push(...wings(look.wings, look, t, upper));
    if (look.hat) for (const f of hat(look.hat)) faces.push({ ...f, pts: f.pts.map(headXf) });
    if (look.pet) for (const f of pet(look.pet)) faces.push({ ...f, pts: f.pts.map((p) => upper([p[0] + 6, p[1] + 24, p[2] - 0.2])) });
    return faces;
  }

  // The cape: 10x16x1 on the back, swaying gently. A catalog or squad cape uses
  // its pixel texture; your own picture is drawn smooth at 160x256.
  function cape(spec, look, t, upper) {
    const sway = look.capeTilt != null ? look.capeTilt : 8 + 3.5 * Math.sin(t * 1.25) + 1.2 * Math.sin(t * 2.9);
    const xf = then((p) => { const q = rotX([p[0], p[1] - 24, p[2] + 2.05], sway * RAD); return [q[0], q[1] + 24, q[2] - 2.05]; }, upper);
    const min = [-5, 8, -3.15], max = [5, 24, -2.15];
    if (spec.picture) {
      const faces = box(min, max, '#1c1a24', xf);
      faces[1] = { ...faces[1], tex: spec.picture, rect: [0, 0, spec.picture.width, spec.picture.height], pixel: false, cells: [2, 3] };
      return faces;
    }
    const img = A.capeTexture(spec);
    // Minecraft draws the cape turned around, so the "front" rectangle faces out.
    const U = A.CAPE_UV;
    return texBox(img, { front: U.back, back: U.front, left: U.right, right: U.left, top: U.top, bottom: U.bottom }, min, max, xf)
      .map((f) => (f.rect[2] === 20 && f.rect[3] === 32 ? { ...f, cells: [2, 3] } : f));
  }

  function wings(id, look, t, upper) {
    const img = A.wingTexture(id);
    const s = slice(img, 0, 0, img.width, img.height);
    const flap = (look.flap != null ? look.flap : 40 + 7 * Math.sin(t * 1.7)) * RAD;
    const out = [];
    for (const side of [1, -1]) {
      const xf = then((p) => { const q = rotY([p[0] * side, p[1], 0], side * flap); return [q[0] + side * 3, q[1] + 20.5, q[2] - 4.6]; }, upper);
      out.push({ pts: [xf([0, 6.5, 0]), xf([12, 6.5, 0]), xf([12, -5.5, 0]), xf([0, -5.5, 0])], tex: s.c, rect: [1, 1, img.width, img.height], pixel: true, two: true, cells: [2, 2], color: '#808080' });
    }
    return out;
  }

  // Hats, as small voxel builds on a head from y 24 to 32.
  function hat(id) {
    const f = [];
    const add = (a, b, c, xf) => f.push(...box(a, b, c, xf));
    switch (id) {
      case 'bucket':
        add([-6.2, 28.4, -6.2], [6.2, 29.2, 6.2], '#d8cfb8');
        add([-4.6, 29.2, -4.6], [4.6, 33.2, 4.6], '#e4dcc6');
        add([-4.7, 29.2, -4.7], [4.7, 30, 4.7], '#8a7a5a');
        break;
      case 'visor':
        add([-4.5, 31, -4.5], [4.5, 33.2, 4.5], '#3b6cff');
        add([-4.5, 31, 4.5], [4.5, 31.7, 8.4], '#2448c0');
        add([-0.6, 33.2, -0.6], [0.6, 33.7, 0.6], '#f5f5f7');
        break;
      case 'crown':
        add([-4.4, 31.6, -4.4], [4.4, 33.4, 4.4], '#e8b73a');
        for (const x of [-3.6, 0, 3.6]) for (const z of [-3.7, 3.7]) add([x - 0.7, 33.4, z - 0.7], [x + 0.7, 35.2, z + 0.7], '#f2cf6a');
        add([-0.7, 32, 4.4], [0.7, 33, 4.6], '#d8323a');
        add([-3.4, 32.2, 4.4], [-2.4, 32.8, 4.6], '#3b6cff');
        add([2.4, 32.2, 4.4], [3.4, 32.8, 4.6], '#3fd68a');
        break;
      case 'beret': {
        const tilt = (p) => rotZ([p[0], p[1] - 32, p[2]], -0.18).map((v, i) => (i === 1 ? v + 32 : v));
        add([-5, 31.6, -4.8], [4.4, 33.4, 4.8], '#c23a3a', tilt);
        add([-0.4, 33.4, -0.4], [0.4, 34.2, 0.4], '#8a2222', tilt);
        break;
      }
      case 'headset':
        add([-4.7, 32, -0.9], [4.7, 33, 0.9], '#26262c');
        add([-5.6, 25.6, -2], [-4, 30, 2], '#2e2e36');
        add([4, 25.6, -2], [5.6, 30, 2], '#2e2e36');
        add([-5.8, 27.2, -0.6], [-5.6, 28.4, 0.6], '#3b6cff');
        add([5.6, 27.2, -0.6], [5.8, 28.4, 0.6], '#3b6cff');
        add([-5.2, 26, 2], [-4.6, 26.6, 6.2], '#26262c');
        break;
      case 'antlers':
        for (const s of [-1, 1]) {
          add([s * 2.5 - 0.5, 32, -0.5], [s * 2.5 + 0.5, 35.5, 0.5], '#8a6a4a');
          add([s * 2.5 + (s > 0 ? 0 : -2.5), 34.5, -0.5], [s * 2.5 + (s > 0 ? 2.5 : 0), 35.4, 0.5], '#8a6a4a');
          add([s * 4.5 - 0.45, 35, -0.45], [s * 4.5 + 0.45, 37, 0.45], '#a8865e');
          add([s * 2 - 0.45, 35.5, -0.45], [s * 2 + 0.45, 37.4, 0.45], '#a8865e');
        }
        break;
      case 'hood':
        add([-4.8, 32, -4.8], [4.8, 33, 4.4], '#2a2f3e');
        add([-4.8, 24.5, -4.8], [4.8, 32, -4], '#2a2f3e');
        add([-4.8, 25, -4], [-4, 32, 4.4], '#323849');
        add([4, 25, -4], [4.8, 32, 4.4], '#323849');
        break;
      case 'topper':
        add([-6, 31.6, -6], [6, 32.4, 6], '#141416');
        add([-3.8, 32.4, -3.8], [3.8, 38, 3.8], '#1c1c20');
        add([-3.9, 32.4, -3.9], [3.9, 33.6, 3.9], '#b8262e');
        break;
      case 'bandana':
        add([-4.4, 29.2, -4.4], [4.4, 30.8, 4.4], '#d8323a');
        add([-1.2, 28, -5.6], [1.2, 29.6, -4.4], '#b8262e');
        for (const [x, z] of [[-2.6, 4.41], [2.6, 4.41], [0, 4.41]]) add([x - 0.4, 29.7, z - 0.01], [x + 0.4, 30.3, z + 0.01], '#f5f5f7');
        break;
      case 'halo':
        for (let i = 0; i < 14; i++) {
          const a = (i / 14) * Math.PI * 2;
          add([-0.9, 34.6, -0.3], [0.9, 35.1, 0.3], '#ffe08a', (p) => rotY([p[0], p[1], p[2] + 4.6], a));
        }
        break;
      case 'sprout':
        add([-0.35, 32, -0.35], [0.35, 34.6, 0.35], '#4e8a40');
        add([0.35, 34, -0.3], [2.6, 34.6, 0.9], '#7cbf4a');
        add([-2.6, 33.4, -0.9], [-0.35, 34, 0.3], '#5aa83a');
        break;
      default: // beanie
        add([-4.6, 29.4, -4.6], [4.6, 31, 4.6], '#1c2340');
        add([-4.4, 31, -4.4], [4.4, 33.4, 4.4], '#3b6cff');
        add([-4.45, 32, -4.45], [4.45, 32.5, 4.45], '#f5f5f7');
        add([-1.1, 33.4, -1.1], [1.1, 35.2, 1.1], '#f5f5f7');
    }
    return f;
  }

  // Shoulder pets, about 6 tall, sitting on the origin.
  function pet(id) {
    const f = [];
    const d = '#2e2420';
    const at = (p) => [p[0] * 0.78, p[1] * 0.78, p[2] * 0.78];
    const add = (a, b, c, xf = at) => f.push(...box(a, b, c, xf));
    const eyes = (y, z, gap = 0.9, c = d) => { add([-gap - 0.35, y, z], [-gap + 0.35, y + 0.6, z + 0.12], c); add([gap - 0.35, y, z], [gap + 0.35, y + 0.6, z + 0.12], c); };
    switch (id) {
      case 'owl':
        add([-1.8, 0, -1.6], [1.8, 5, 1.6], '#8b6a4f');
        add([-1.4, 0.6, 1.6], [1.4, 3.4, 1.75], '#d9c6a6');
        add([-1.6, 3.4, 1.6], [-0.2, 4.8, 1.75], '#f5e7b0');
        add([0.2, 3.4, 1.6], [1.6, 4.8, 1.75], '#f5e7b0');
        eyes(3.8, 1.75, 0.9);
        add([-0.3, 3, 1.6], [0.3, 3.6, 2.2], '#e0a33a');
        add([-1.8, 5, -0.4], [-1, 5.8, 0.4], '#6a5038');
        add([1, 5, -0.4], [1.8, 5.8, 0.4], '#6a5038');
        break;
      case 'frog':
        add([-2, 0, -1.8], [2, 2.4, 2], '#5fae4a');
        add([-1.8, 0.2, 2], [1.8, 1.4, 2.15], '#cfe6a8');
        add([-1.9, 2.2, 0.4], [-0.5, 3.4, 1.8], '#5fae4a');
        add([0.5, 2.2, 0.4], [1.9, 3.4, 1.8], '#5fae4a');
        eyes(2.6, 1.8, 1.2);
        break;
      case 'crow':
        add([-1.3, 0.6, -2.2], [1.3, 3.6, 1.2], '#26262c');
        add([-1.4, 3.2, -0.6], [1.4, 5.6, 1.8], '#2e2e36');
        add([-0.4, 3.9, 1.8], [0.4, 4.6, 3.2], '#d9a63a');
        add([-0.9, 1.2, -4], [0.9, 2, -2.2], '#1c1c22');
        eyes(4.6, 1.8, 0.7, '#f5f5f7');
        break;
      case 'snail':
        add([-1, 0, -1.8], [1, 1.2, 3], '#b9b3a6');
        add([-0.6, 1.2, 2.2], [-0.3, 2.6, 2.5], '#b9b3a6');
        add([0.3, 1.2, 2.2], [0.6, 2.6, 2.5], '#b9b3a6');
        add([-1.4, 1.2, -1.8], [1.4, 4.4, 1.2], '#c0783a');
        add([-1.5, 2.2, -0.8], [1.5, 3.4, 0.2], '#8a4f22');
        break;
      case 'hedgehog':
        add([-1.8, 0, -2], [1.8, 2.8, 1.4], '#6b4a32');
        add([-1.2, 0.3, 1.4], [1.2, 2, 2.8], '#d7b98f');
        add([-0.3, 0.9, 2.8], [0.3, 1.4, 3.1], d);
        eyes(1.6, 2.4, 0.7);
        for (const [x, z] of [[-1.2, -1.4], [0, -1.4], [1.2, -1.4], [-0.6, 0.2], [0.6, 0.2]]) add([x - 0.4, 2.8, z - 0.4], [x + 0.4, 3.6, z + 0.4], '#4a3222');
        break;
      default: { // fox
        const o = '#e3773a', w = '#f3ece2';
        add([-1.5, 0, -2], [1.5, 3.4, 1], o);
        add([-1.1, 0.4, 1], [1.1, 2.8, 1.3], w);
        add([-1.7, 3, -1.1], [1.7, 6, 1.7], o);
        add([-0.8, 3.2, 1.7], [0.8, 4.4, 3], w);
        add([-0.35, 4, 3], [0.35, 4.5, 3.2], d);
        eyes(4.7, 1.7);
        add([-1.6, 6, -0.2], [-0.5, 7.5, 0.6], o);
        add([0.5, 6, -0.2], [1.6, 7.5, 0.6], o);
        add([-1.3, 0, 0.4], [-0.5, 0.8, 1.2], d);
        add([0.5, 0, 0.4], [1.3, 0.8, 1.2], d);
        const tail = (p) => at(rotY(p, -0.6));
        add([-0.9, 0.2, -5.4], [0.9, 1.8, -1.8], o, tail);
        add([-0.9, 0.2, -6.6], [0.9, 1.8, -5.4], w, tail);
      }
    }
    return f;
  }

  // A round turntable for product shots.
  function turntable(r = 13, h = 1.6) {
    const n = 40, top = [], faces = [];
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2, b = ((i + 1) / n) * Math.PI * 2;
      top.push([Math.cos(a) * r, 0, Math.sin(a) * r]);
      faces.push({ pts: [[Math.cos(b) * r, 0, Math.sin(b) * r], [Math.cos(a) * r, 0, Math.sin(a) * r], [Math.cos(a) * r, -h, Math.sin(a) * r], [Math.cos(b) * r, -h, Math.sin(b) * r]], color: '#1c1c21', flat: 0.9 });
    }
    faces.push({ pts: top, color: '#18181c', ground: true, flat: 1.2 });
    return faces;
  }

  // Rendering ------------------------------------------------------------------------
  const KEY = norm([-0.5, 0.8, 0.55]);
  const RIM = norm([0.7, 0.25, -0.7]);

  function project(p, cam) {
    let q = [p[0], p[1] - cam.target, p[2]];
    q = rotX(q, cam.pitch * RAD);
    const z = cam.dist - q[2];
    return [cam.cx + (cam.ppu * cam.dist * q[0]) / z, cam.cy - (cam.ppu * cam.dist * q[1]) / z, z];
  }

  function drawTextured(g, scr, face, level) {
    const img = shaded(face.tex, level);
    const [rx, ry, rw, rh] = face.rect;
    const [nx, ny] = face.cells || [1, 1];
    const lerp = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
    const at = (u, v) => lerp(lerp(scr[0], scr[1], u), lerp(scr[3], scr[2], u), v);
    g.imageSmoothingEnabled = !face.pixel;
    for (let j = 0; j < ny; j++) {
      for (let i = 0; i < nx; i++) {
        const u0 = i / nx, u1 = (i + 1) / nx, v0 = j / ny, v1 = (j + 1) / ny;
        const s = [at(u0, v0), at(u1, v0), at(u1, v1), at(u0, v1)];
        const t = [[rx + u0 * rw, ry + v0 * rh], [rx + u1 * rw, ry + v0 * rh], [rx + u1 * rw, ry + v1 * rh], [rx + u0 * rw, ry + v1 * rh]];
        tri(g, img, s[0], s[1], s[2], t[0], t[1], t[2]);
        tri(g, img, s[0], s[2], s[3], t[0], t[2], t[3]);
      }
    }
    g.imageSmoothingEnabled = true;
  }

  // Draws the texture triangle (t0, t1, t2) onto the screen triangle (s0, s1, s2).
  function tri(g, img, s0, s1, s2, t0, t1, t2) {
    const cx = (s0[0] + s1[0] + s2[0]) / 3, cy = (s0[1] + s1[1] + s2[1]) / 3;
    const grow = (p) => { const dx = p[0] - cx, dy = p[1] - cy, l = Math.hypot(dx, dy) || 1; return [p[0] + (dx / l) * 0.6, p[1] + (dy / l) * 0.6]; };
    const a = grow(s0), b = grow(s1), c = grow(s2);
    const d = (t1[0] - t0[0]) * (t2[1] - t0[1]) - (t2[0] - t0[0]) * (t1[1] - t0[1]);
    if (Math.abs(d) < 1e-9) return;
    g.save();
    g.beginPath();
    g.moveTo(a[0], a[1]); g.lineTo(b[0], b[1]); g.lineTo(c[0], c[1]);
    g.closePath();
    g.clip();
    const m11 = ((s1[0] - s0[0]) * (t2[1] - t0[1]) - (s2[0] - s0[0]) * (t1[1] - t0[1])) / d;
    const m12 = ((s1[1] - s0[1]) * (t2[1] - t0[1]) - (s2[1] - s0[1]) * (t1[1] - t0[1])) / d;
    const m21 = ((s2[0] - s0[0]) * (t1[0] - t0[0]) - (s1[0] - s0[0]) * (t2[0] - t0[0])) / d;
    const m22 = ((s2[1] - s0[1]) * (t1[0] - t0[0]) - (s1[1] - s0[1]) * (t2[0] - t0[0])) / d;
    const dx = s0[0] - m11 * t0[0] - m21 * t0[1];
    const dy = s0[1] - m12 * t0[0] - m22 * t0[1];
    g.transform(m11, m12, m21, m22, dx, dy);
    g.drawImage(img, 0, 0);
    g.restore();
  }

  // items: [{ faces, pos: [x, y, z], yaw (degrees), scale }]
  function render(g, items, cam) {
    const polys = [];
    for (const it of items) {
      const yaw = (it.yaw || 0) * RAD;
      const pos = it.pos || [0, 0, 0];
      const k = it.scale || 1;
      for (const face of it.faces) {
        const world = face.pts.map((p) => { const q = rotY(p, yaw); return [q[0] * k + pos[0], q[1] * k + pos[1], q[2] * k + pos[2]]; });
        const scr = world.map((p) => project(p, cam));
        let n = norm(cross(sub(world[2], world[0]), sub(world[1], world[0])));
        const area = (scr[1][0] - scr[0][0]) * (scr[2][1] - scr[0][1]) - (scr[2][0] - scr[0][0]) * (scr[1][1] - scr[0][1]);
        if (area <= 0) {
          if (!face.two) continue;
          n = [-n[0], -n[1], -n[2]];
        }
        const depth = scr.reduce((s, p) => s + p[2], 0) / scr.length;
        polys.push({ face, scr, n, depth: face.ground ? 1e9 : depth });
      }
    }
    polys.sort((a, b) => b.depth - a.depth);
    for (const { face, scr, n } of polys) {
      const light = Math.max(0, dot(n, KEY));
      const shade = face.flat != null ? face.flat * 0.6 : 0.42 + 0.58 * light;
      const rim = face.flat != null || face.rim === false ? 0 : Math.max(0, dot(n, RIM)) * 0.42;
      const path = () => { g.beginPath(); scr.forEach((p, i) => (i ? g.lineTo(p[0], p[1]) : g.moveTo(p[0], p[1]))); g.closePath(); };
      if (face.tex) {
        drawTextured(g, scr, face, Math.max(4, Math.min(24, Math.round(shade * 24))));
        if (rim > 0.02 && face.rim) {
          g.save();
          g.globalCompositeOperation = 'lighter';
          g.fillStyle = `rgba(59,108,255,${(rim * 0.55).toFixed(3)})`;
          path();
          g.fill();
          g.restore();
        }
        continue;
      }
      const base = hexRgb(face.color);
      const c = base.map((v, i) => Math.round(Math.min(255, v * shade + [59, 108, 255][i] * rim)));
      g.fillStyle = `rgb(${c[0]},${c[1]},${c[2]})`;
      path();
      g.fill();
      g.strokeStyle = g.fillStyle;
      g.lineWidth = 0.6;
      g.stroke();
    }
  }

  function shadow(g, cam, pos, r) {
    const c = project(pos, cam);
    const e = project([pos[0] + r, pos[1], pos[2]], cam);
    const rx = Math.abs(e[0] - c[0]);
    const gr = g.createRadialGradient(c[0], c[1], 0, c[0], c[1], rx);
    gr.addColorStop(0, 'rgba(0,0,0,0.55)');
    gr.addColorStop(1, 'rgba(0,0,0,0)');
    g.save();
    g.translate(c[0], c[1]);
    g.scale(1, 0.32);
    g.translate(-c[0], -c[1]);
    g.fillStyle = gr;
    g.beginPath(); g.arc(c[0], c[1], rx, 0, 7); g.fill();
    g.restore();
  }

  function nameTag(g, cam, pos, name, squad, size = 13, above = 37) {
    const p = project([pos[0], pos[1] + above, pos[2]], cam);
    g.save();
    const font = (w) => `${w} ${size}px Inter, system-ui, sans-serif`;
    g.font = font(600);
    const text = squad ? `${name} · ` : name;
    const w1 = g.measureText(text).width;
    g.font = font(500);
    const w2 = squad ? g.measureText(squad).width : 0;
    const w = w1 + w2 + size * 1.4, h = size * 1.9;
    const x = p[0] - w / 2, y = p[1] - h;
    g.fillStyle = 'rgba(10,10,11,0.62)';
    g.beginPath(); g.roundRect(x, y, w, h, h / 2); g.fill();
    g.textBaseline = 'middle';
    g.font = font(600);
    g.fillStyle = '#f5f5f7';
    g.fillText(text, x + size * 0.7, y + h / 2 + 0.5);
    if (squad) {
      g.font = font(500);
      g.fillStyle = '#8fb0ff';
      g.fillText(squad, x + size * 0.7 + w1, y + h / 2 + 0.5);
    }
    g.restore();
  }

  // A canvas that keeps its backing store in step with its CSS size.
  function fit(c) {
    const r = c.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    const w = Math.round(r.width * dpr), h = Math.round(r.height * dpr);
    if (c.width !== w || c.height !== h) { c.width = w; c.height = h; }
    const g = c.getContext('2d');
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.clearRect(0, 0, r.width, r.height);
    return { g, w: r.width, h: r.height };
  }

  window.DripFigure = { player, hat, pet, box, turntable, render, shadow, nameTag, fit, project };
})();
