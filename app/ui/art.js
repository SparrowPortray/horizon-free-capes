// Drip's pixel art, all of it drawn in code and all of it ours: the
// players' 64x64 skins, the 24 capes in Minecraft's cape layout (at 2x, so a
// face is 20x32), squad capes and wings. Nothing here comes from the game.
(function () {
  const BAYER = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5];
  const rgb = (h) => [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)];
  const col = (c) => (typeof c === 'string' ? rgb(c) : c);
  const tone = (c, k) => col(c).map((v) => Math.max(0, Math.min(255, Math.round(v * k))));
  const mix = (a, b, t) => { a = col(a); b = col(b); return a.map((v, i) => Math.round(v + (b[i] - v) * t)); };
  function rng(seed) { let s = (seed >>> 0) % 2147483646 + 1; return () => ((s = (s * 16807) % 2147483647) - 1) / 2147483646; }
  function hash(str) { let h = 7; for (const ch of str) h = (h * 31 + ch.charCodeAt(0)) >>> 0; return h; }
  // A dithered step through a palette, t from 0 to 1, at pixel (x, y).
  function ramp(pal, t, x, y) {
    const f = Math.max(0, Math.min(0.9999, t)) * (pal.length - 1);
    const i = Math.floor(f);
    return pal[f - i > (BAYER[((y & 3) << 2) | (x & 3)] + 0.5) / 16 ? i + 1 : i];
  }

  // A pixel buffer --------------------------------------------------------------
  class Pix {
    constructor(w, h) { this.w = w; this.h = h; this.d = new Uint8ClampedArray(w * h * 4); }
    set(x, y, c, a = 255) {
      x = Math.floor(x); y = Math.floor(y);
      if (!c || x < 0 || y < 0 || x >= this.w || y >= this.h) return;
      const v = col(c), i = (y * this.w + x) * 4;
      this.d[i] = v[0]; this.d[i + 1] = v[1]; this.d[i + 2] = v[2]; this.d[i + 3] = v[3] != null ? v[3] : a;
    }
    get(x, y) { const i = (y * this.w + x) * 4; return [this.d[i], this.d[i + 1], this.d[i + 2], this.d[i + 3]]; }
    fill(x0, y0, w, h, fn) { for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) this.set(x0 + x, y0 + y, fn(x, y)); }
    canvas() {
      const c = document.createElement('canvas');
      c.width = this.w; c.height = this.h;
      c.getContext('2d').putImageData(new ImageData(this.d, this.w, this.h), 0, 0);
      return c;
    }
  }

  // A rectangle of a buffer with shape helpers, in its own coordinates.
  // k > 1 draws the same design with k times the pixels (an HD texture).
  function region(P, ox, oy, w, h, k = 1) {
    const set = (x, y, c) => { if (x >= 0 && y >= 0 && x < w * k && y < h * k) P.set(ox + x, oy + y, c); };
    const R = {
      w, h,
      px(x, y, c) { for (let j = 0; j < k; j++) for (let i = 0; i < k; i++) set(Math.floor(x * k) + i, Math.floor(y * k) + j, c); },
      get(x, y) { return P.get(ox + Math.floor(x * k), oy + Math.floor(y * k)); },
      each(fn) { for (let y = 0; y < h * k; y++) for (let x = 0; x < w * k; x++) { const c = k === 1 ? fn(x, y) : fn(x / k, y / k); if (c) set(x, y, c); } },
      // Every pixel whose centre passes test(cx, cy) gets c (a colour or fn(x, y)).
      shape(test, c) { R.each((x, y) => (test(x + 0.5 / k, y + 0.5 / k) ? (typeof c === 'function' ? c(x, y) : c) : null)); },
      disc(cx, cy, r, c) { R.shape((x, y) => (x - cx) ** 2 + (y - cy) ** 2 <= r * r, c); },
      poly(pts, c) { R.shape((x, y) => inPoly(pts, x, y), c); },
      line(x0, y0, x1, y1, wd, c) { R.shape((x, y) => segDist(x, y, x0, y0, x1, y1).d <= wd / 2, c); },
    };
    return R;
  }
  function inPoly(pts, x, y) {
    let inside = false;
    for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
      const [xi, yi] = pts[i], [xj, yj] = pts[j];
      if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
    }
    return inside;
  }
  function segDist(px, py, x0, y0, x1, y1) {
    const dx = x1 - x0, dy = y1 - y0, l = dx * dx + dy * dy || 1;
    const t = Math.max(0, Math.min(1, ((px - x0) * dx + (py - y0) * dy) / l));
    return { d: Math.hypot(px - x0 - t * dx, py - y0 - t * dy), t };
  }
  // Inside an ellipse when < 1.
  const ell = (x, y, cx, cy, rx, ry, rot = 0) => {
    const c = Math.cos(rot), s = Math.sin(rot), dx = x - cx, dy = y - cy;
    return ((dx * c + dy * s) / rx) ** 2 + ((-dx * s + dy * c) / ry) ** 2;
  };

  // Minecraft's box layout: the faces of a w x h x d box unfolded from (u, v).
  function boxUV(u, v, w, h, d) {
    return {
      top: [u + d, v, w, d], bottom: [u + d + w, v, w, d],
      right: [u, v + d, d, h], front: [u + d, v + d, w, h],
      left: [u + d + w, v + d, d, h], back: [u + 2 * d + w, v + d, w, h],
    };
  }

  // Skins -----------------------------------------------------------------------
  const PARTS = {
    head: [0, 0, 8, 8, 8], hat: [32, 0, 8, 8, 8],
    body: [16, 16, 8, 12, 4], jacket: [16, 32, 8, 12, 4],
    rarm: [40, 16, 4, 12, 4], rsleeve: [40, 32, 4, 12, 4],
    larm: [32, 48, 4, 12, 4], lsleeve: [48, 48, 4, 12, 4],
    rleg: [0, 16, 4, 12, 4], rpant: [0, 32, 4, 12, 4],
    lleg: [16, 48, 4, 12, 4], lpant: [0, 48, 4, 12, 4],
  };
  // Paints a face of a part: fn(x, y, w, h) gives a colour, or null to leave it.
  function face(P, part, f, fn) {
    const [u, v, w, h] = boxUV(...PARTS[part])[f];
    P.fill(u, v, w, h, (x, y) => fn(x, y, w, h));
  }
  function every(P, part, fn) {
    for (const f of ['top', 'bottom', 'right', 'front', 'left', 'back']) face(P, part, f, (x, y, w, h) => fn(f, x, y, w, h));
  }
  // Side faces run back to front on the right and front to back on the left.
  const fromFront = (f, x, w) => (f === 'right' ? w - 1 - x : x);

  const PLAYERS = {
    nightowl_07: {
      skin: '#c48a64', hair: '#2a1c16', iris: '#4a2f22', lip: '#9a5646',
      fringe: [2, 2, 3, 2, 2, 1, 2, 2], hairSide: 4, hairBack: 7,
      shirt: '#1f2944', sleeve: 11, pants: '#2b303b', shoes: '#e8e8ee', sole: '#8f8f9a', shoeRows: 2,
      extra(P, n) {
        const navy = '#1f2944', hi = '#2c3a62', dark = '#161d33';
        face(P, 'body', 'front', (x, y) => {
          if ((x === 2 || x === 5) && y < 4) return y === 3 ? '#b9b9c4' : '#ececf2';
          if (y === 0 && x > 2 && x < 5) return dark;
          if (y >= 7 && y <= 10 && x >= 1 && x <= 6) return y === 7 ? hi : n(tone(navy, 0.8));
          if (y === 11) return n(dark);
          return null;
        });
        face(P, 'body', 'back', (x, y) => (y === 11 ? n(dark) : null));
        for (const arm of ['rarm', 'larm']) every(P, arm, (f, x, y) => (y === 10 && f !== 'top' && f !== 'bottom' ? n(dark) : null));
        // The hood, down around the neck.
        every(P, 'jacket', (f, x, y, w) => {
          if (f === 'back' && y < 4) return y === 3 ? n(dark) : n(hi, 0.05);
          if ((f === 'left' || f === 'right') && y < 2) return n(hi, 0.05);
          if (f === 'front' && y === 0 && (x < 2 || x > 5)) return n(hi, 0.05);
          if (f === 'top' && (y === 0 || x === 0 || x === w - 1)) return n(hi, 0.05);
          return null;
        });
        // Headphones: a band over the top and a cup on each side.
        every(P, 'hat', (f, x, y, w) => {
          if (f === 'top' && (y === 3 || y === 4)) return y === 3 ? '#3a3a44' : '#1a1a1f';
          if (f === 'left' || f === 'right') {
            const z = fromFront(f, x, w);
            if (y < 3 && (z === 3 || z === 4)) return '#1a1a1f';
            if (y >= 3 && y <= 6 && z >= 2 && z <= 5) return z === 3 && y === 4 ? '#3b6cff' : (y === 3 || z === 2) ? '#33333c' : '#222228';
          }
          return null;
        });
      },
    },
    mossy: {
      skin: '#f0c6a4', hair: '#b4552b', iris: '#3f7a3a', lip: '#c4705a', freckles: '#c07a4e',
      fringe: [3, 3, 2, 2, 1, 1, 1, 2], hairSide: 5, hairBack: 7,
      shirt: '#4e7a3c', sleeve: 11, pants: '#5c4733', shoes: '#3a2a1e', sole: '#241a12', shoeRows: 3,
      extra(P, n) {
        for (const f of ['front', 'back']) face(P, 'body', f, (x, y) => ((x === 2 || x === 5) && y % 3 !== 2 ? n('#6a9c52') : y === 0 ? n('#3c5e2e') : null));
        // A mustard scarf, one end hanging down the front.
        every(P, 'jacket', (f, x, y, w) => {
          if (f === 'top') return n('#d9a43a');
          if (y < 2 && f !== 'bottom') return n(y === 1 ? '#c08d2e' : '#d9a43a');
          if (f === 'front' && x >= 5 && x <= 6 && y < 6) return y === 5 ? '#a8761f' : n('#d9a43a');
          return null;
        });
      },
    },
    kai_builds: {
      skin: '#7a4a30', hair: '#151112', iris: '#2a1a12', lip: '#5a3222',
      fringe: [1, 1, 1, 1, 1, 1, 1, 1], hairSide: 3, hairBack: 6,
      shirt: '#c8ccd4', sleeve: 3, pants: '#e07a2e', shoes: '#9a6a34', sole: '#4a3220', shoeRows: 3,
      extra(P, n) {
        const orange = '#e07a2e';
        face(P, 'body', 'front', (x, y) => {
          if ((x === 1 || x === 6) && y < 5) return n(orange);
          if (y === 8) return x === 4 ? '#d4b04a' : n('#6a4a2a');
          if (y >= 4) return y >= 5 && y <= 6 && x >= 3 && x <= 4 ? n(tone(orange, 0.8)) : n(orange);
          return null;
        });
        face(P, 'body', 'back', (x, y) => ((y < 5 && (x === y + 1 || x === 6 - y)) || y >= 5 ? (y === 8 ? n('#6a4a2a') : n(orange)) : null));
        for (const f of ['left', 'right']) face(P, 'body', f, (x, y) => (y >= 5 ? (y === 8 ? n('#6a4a2a') : n(orange)) : null));
        // A yellow hard hat.
        every(P, 'hat', (f, x, y) => {
          if (f === 'top') return n('#f2c230', 0.04);
          if (f !== 'bottom' && y < 2) return n(y === 1 ? '#d9a91c' : '#f2c230', 0.04);
          if (f === 'front' && y === 2) return '#c99a18';
          return null;
        });
      },
    },
    Lumen: {
      skin: '#f3d5c2', hair: '#ebe1c4', iris: '#5f95c9', lip: '#d48a84',
      fringe: [2, 3, 3, 2, 2, 3, 3, 2], hairSide: 8, hairBack: 8,
      shirt: '#efe8da', sleeve: 11, pants: '#d6d6dc', shoes: '#c9a46a', sole: '#8a6a3a', shoeRows: 2,
      extra(P, n) {
        face(P, 'body', 'front', (x, y) => (x === 4 && y < 11 ? (y % 3 === 0 ? '#f2cf6a' : '#d4a73a') : y === 0 && x > 1 && x < 6 ? n('#fffaf0') : y === 11 ? n('#d9d0bd') : null));
        for (const arm of ['rarm', 'larm']) face(P, arm, 'front', (x, y) => (y === 10 && x === 1 ? '#d4a73a' : null));
        // Long hair down the back and over the shoulders.
        every(P, 'jacket', (f, x, y, w) => {
          if (f === 'back' && y < 5) return n(y === 4 ? '#d8cca8' : '#ebe1c4', 0.08);
          if ((f === 'left' || f === 'right') && y < 3 && fromFront(f, x, w) > 1) return n('#ebe1c4', 0.08);
          return null;
        });
        every(P, 'hat', (f, x, y, w) => (f === 'back' || ((f === 'left' || f === 'right') && fromFront(f, x, w) > 3) ? (y > 5 ? n('#ebe1c4', 0.08) : null) : null));
      },
    },
    ripley_r: {
      skin: '#d29a74', hair: '#221a1b', iris: '#3e7a4c', lip: '#a65a4a', streak: '#c43038',
      fringe: [2, 2, 2, 1, 1, 2, 3, 3], hairSide: 4, hairBack: 7,
      shirt: '#b3262e', sleeve: 11, pants: '#1d1d22', shoes: '#121215', sole: '#2a2a30', shoeRows: 3,
      extra(P, n) {
        face(P, 'head', 'front', (x, y) => ((x === 5 || x === 6) && y < 3 ? '#c43038' : null));
        face(P, 'head', 'right', (x, y, w) => (fromFront('right', x, w) === 3 && y === 5 ? '#dcdce4' : null));
        face(P, 'body', 'front', (x, y) => {
          if (y === 0) return x % 2 ? '#1a1a1e' : '#2a2a30';
          if (y === 11) return x % 2 ? '#1a1a1e' : '#2a2a30';
          if (x === 4 && y < 11) return '#c9c9d0';
          if (x === 1 && y >= 2 && y <= 3) return '#f08a2a';
          return null;
        });
        face(P, 'body', 'back', (x, y) => (y === 0 || y === 11 ? (x % 2 ? '#1a1a1e' : '#2a2a30') : null));
        for (const arm of ['rarm', 'larm']) every(P, arm, (f, x, y) => (y === 10 && f !== 'top' && f !== 'bottom' ? (x % 2 ? '#1a1a1e' : '#2a2a30') : null));
      },
    },
  };

  function skinTexture(name) {
    return memo(`skin:${name}`, () => {
      const s = PLAYERS[name] || PLAYERS.nightowl_07;
      const P = new Pix(64, 64);
      const r = rng(hash(name));
      const n = (c, a = 0.06) => tone(c, 1 + (r() - 0.5) * 2 * a);
      every(P, 'head', (f, x, y, w) => {
        if (f === 'top') return n(s.hair, 0.12);
        if (f === 'bottom') return n(tone(s.skin, 0.85), 0.02);
        if (f === 'back') return y < s.hairBack ? n(s.hair, 0.12) : n(tone(s.skin, 0.88), 0.02);
        if (f === 'left' || f === 'right') {
          const z = fromFront(f, x, w);
          if (y < 2 || (z > 2 && y < s.hairSide) || (z === 2 && y < 4)) return n(s.hair, 0.12);
          if (z === 4 && (y === 4 || y === 5)) return tone(s.skin, 0.86);
          return n(tone(s.skin, 0.94), 0.02);
        }
        // The face: our own, no default faces.
        if (y < s.fringe[x]) return n(s.hair, 0.12);
        if (y === 3 && (x === 1 || x === 2 || x === 5 || x === 6)) return tone(s.hair, 0.8);
        if (y === 4 && (x === 1 || x === 6)) return '#f4f1ec';
        if (y === 4 && (x === 2 || x === 5)) return s.iris;
        if (y === 5 && s.freckles && (x === 1 || x === 6)) return s.freckles;
        if (y === 5 && (x === 3 || x === 4)) return tone(s.skin, 0.9);
        if (y === 6 && (x === 3 || x === 4)) return s.lip;
        if (x === 0 || x === 7 || y === 7) return n(tone(s.skin, 0.93), 0.02);
        return n(s.skin, 0.025);
      });
      every(P, 'body', () => n(s.shirt, 0.06));
      for (const arm of ['rarm', 'larm']) {
        every(P, arm, (f, x, y) => {
          if (f === 'top') return n(s.sleeve > 0 ? s.shirt : s.skin, 0.06);
          if (f === 'bottom' || y >= Math.max(s.sleeve, 11)) return n(tone(s.skin, 0.95), 0.03);
          return y < s.sleeve ? n(s.shirt, 0.06) : n(s.skin, 0.03);
        });
      }
      for (const leg of ['rleg', 'lleg']) {
        every(P, leg, (f, x, y) => {
          if (f === 'top') return n(s.pants, 0.06);
          if (f === 'bottom' || y === 11) return n(s.sole, 0.04);
          if (y >= 12 - s.shoeRows) return n(s.shoes, 0.04);
          return n(s.pants, 0.06);
        });
      }
      s.extra(P, n);
      return P.canvas();
    });
  }

  // Capes ---------------------------------------------------------------------------
  // Minecraft's cape texture is 64x32: a 10x16x1 box from (0, 0). Drip's are at
  // 2x (128x64), so a face is 20x32 and a side is 2 wide.
  const CAPE_UV = Object.fromEntries(Object.entries(boxUV(0, 0, 10, 16, 1)).map(([k, v]) => [k, v.map((n) => n * 2)]));

  const CAPES = {
    ember(F, r) {
      F.each((x, y) => {
        const d = Math.hypot(x + 0.5 - 10, (y + 0.5 - 14.5) * 0.8);
        if (d < 9.5) return ramp(['#4a0a0d', '#6e1412', '#9a2216', '#c83a1a'], 1 - d / 9.5, x, y);
        return ramp(['#3a080b', '#2e0609', '#220406'], y / 31, x, y);
      });
      const flame = (cx, cy, s) => [[cx, cy - 8 * s], [cx + 2 * s, cy - 4.5 * s], [cx + 4.2 * s, cy - 0.8 * s], [cx + 4.6 * s, cy + 2.6 * s], [cx + 3 * s, cy + 5.2 * s], [cx, cy + 6.2 * s], [cx - 3 * s, cy + 5.2 * s], [cx - 4.6 * s, cy + 2.6 * s], [cx - 4 * s, cy - 1.2 * s], [cx - 2.6 * s, cy - 3 * s], [cx - 1.4 * s, cy - 1.2 * s], [cx - 0.6 * s, cy - 5 * s]];
      F.poly(flame(10, 14.5, 1.15), '#ff5a1a');
      F.poly(flame(10, 15.8, 0.8), '#ffa62b');
      F.poly(flame(10, 17.3, 0.45), '#fff0b0');
      for (const [x, y, c] of [[4, 9, '#ff8a2a'], [15, 6, '#ffb02e'], [14, 3, '#ff6a1f'], [6, 4, '#ffd27a'], [16, 12, '#ff6a1f'], [3, 15, '#c8401a']]) F.px(x, y, c);
      F.each((x, y) => (y === 29 && x % 2 === 0 ? '#d48a2a' : y >= 30 ? '#1c0304' : null));
      return { inner: '#2a0507', edge: '#1c0304' };
    },
    tide(F) {
      const bands = ['#cdf4f4', '#8fdde6', '#4dbad4', '#2490b8', '#156690', '#0c4566', '#082f48'];
      const crest = (k, x) => 2.5 + k * 4.6 + 1.6 * Math.sin((x + k * 2.3) * 0.62);
      F.each((x, y) => {
        let k = 0;
        while (k < 6 && y + 0.5 >= crest(k + 1, x + 0.5)) k++;
        const c = crest(k, x + 0.5);
        if (k > 0 && y === Math.floor(c)) return x % 3 ? '#f4ffff' : '#d6f6fa';
        if (k > 0 && y === Math.floor(c) + 1) return mix(bands[k], '#ffffff', 0.25);
        return bands[k];
      });
      return { inner: '#082f48', edge: '#061f30' };
    },
    static(F, r) {
      const greys = ['#1c1c22', '#3a3a42', '#62626c', '#9a9aa4', '#d6d6de', '#f4f4f8'];
      F.each((x, y) => tone(greys[Math.min(5, Math.floor(r() ** 1.3 * 6))], y % 2 ? 0.8 : 1));
      for (const [y, s] of [[7, 0], [8, 3], [20, 5], [25, 1]]) for (let x = 0; x < 20; x++) if (r() < 0.75) F.px(x, y, ['#ff3b6b', '#38d9ff', '#3b6cff', '#f4f4f8'][(x + s) % 4]);
      F.each((x, y) => (x === 0 || x === 19 || y === 0 || y === 31 ? '#0e0e12' : (x === 1 || x === 18) && (y === 1 || y === 30) ? '#0e0e12' : null));
      return { inner: '#1c1c22', edge: '#0e0e12' };
    },
    aurora(F, r) {
      const green = ['#0d2a36', '#13604f', '#22a37a', '#46e3a8', '#b8ffe2'];
      const violet = ['#140f3a', '#3a2a8a', '#6a4ad0', '#a88cff', '#e0d4ff'];
      const curtain = (y, yc) => (y <= yc ? Math.exp(-(((yc - y) / 6.5) ** 2)) : Math.exp(-(((y - yc) / 1.2) ** 2)));
      F.each((x, y) => {
        const s = 0.6 + 0.4 * Math.sin(x * 1.7 + 0.4);
        const a = curtain(y, 12 + 2.6 * Math.sin(x * 0.42 + 0.6)) * s;
        const b = curtain(y, 20 + 2.2 * Math.sin(x * 0.36 + 2.4)) * (0.55 + 0.45 * Math.sin(x * 1.3 + 2));
        if (a > 0.14 && a >= b) return ramp(green, a, x, y);
        if (b > 0.14) return ramp(violet, b, x, y);
        return ramp(['#04081a', '#081232', '#0d1a44'], y / 31, x, y);
      });
      for (let i = 0; i < 9; i++) { const x = Math.floor(r() * 20), y = Math.floor(r() * 9); F.px(x, y, r() < 0.4 ? '#e8f0ff' : '#7a8ac0'); }
      F.each((x, y) => (y >= 27 + Math.round(1.4 * Math.sin(x * 0.8) + 0.5) ? '#02040c' : null));
      return { inner: '#04081a', edge: '#02040c' };
    },
    comet(F, r) {
      F.each((x, y) => ramp(['#050820', '#0a1032', '#111a48'], y / 31, x, y));
      for (let i = 0; i < 12; i++) F.px(Math.floor(r() * 20), Math.floor(r() * 32), r() < 0.3 ? '#ffffff' : '#6a78b8');
      const pal = ['#16206a', '#2c48b8', '#5a8cff', '#a8d4ff', '#ffffff'];
      F.each((x, y) => {
        const { d, t } = segDist(x + 0.5, y + 0.5, 15.5, 6.5, 2, 27);
        const w = 0.5 + 2.6 * (1 - t);
        return d < w ? ramp(pal, (1 - t) * (1 - (d / w) * 0.5), x, y) : null;
      });
      F.disc(15.5, 6.5, 3.2, '#8fd0ff');
      F.disc(15.5, 6.5, 2.1, '#ffffff');
      for (const [x, y] of [[15, 1], [15, 2], [15, 11], [19, 6], [11, 6]]) F.px(x, y, '#cfe8ff');
      return { inner: '#050820', edge: '#03051a' };
    },
    glacier(F, r) {
      const pal = ['#3f78a8', '#5e97c6', '#86b9df', '#b4d9f0', '#e2f3fc'];
      const pts = Array.from({ length: 12 }, () => [r() * 20, r() * 32, Math.floor(r() * 5)]);
      F.each((x, y) => {
        let d1 = 1e9, d2 = 1e9, k = 0;
        pts.forEach((p, i) => { const d = Math.hypot(x + 0.5 - p[0], y + 0.5 - p[1]); if (d < d1) { d2 = d1; d1 = d; k = i; } else if (d < d2) d2 = d; });
        if (d2 - d1 < 0.8) return '#f4fbff';
        return pal[pts[k][2]];
      });
      F.each((x, y) => (y < 2 && (x + y) % 2 === 0 ? '#ffffff' : null));
      return { inner: '#2d5a82', edge: '#244a6c' };
    },
    moss(F, r) {
      const stone = ['#3e423c', '#4b5047', '#585e54', '#666c60'];
      F.each(() => (r() < 0.05 ? '#30332d' : stone[Math.floor(r() * 4)]));
      const h = Array.from({ length: 20 }, (_, x) => 6 + 2.5 * Math.sin(x * 0.7 + 1) + r() * 2.5);
      F.each((x, y) => (y < h[x] ? ramp(['#24461c', '#3a6e28', '#5a9a38', '#8acb52'], 1 - y / h[x] + (r() - 0.5) * 0.3, x, y) : null));
      for (let i = 0; i < 6; i++) {
        const x = Math.floor(r() * 20), len = 2 + Math.floor(r() * 5);
        for (let y = Math.floor(h[x]); y < h[x] + len; y++) F.px(x, y, '#3a6e28');
        F.px(x, Math.floor(h[x] + len), '#7cc04a');
      }
      for (let y = 8; y < 22; y++) { if (r() < 0.45) F.px(0, y, '#4a8a30'); if (r() < 0.45) F.px(19, y, '#4a8a30'); }
      for (const [x, y, c] of [[4, 3, '#f5b8d8'], [13, 2, '#fff2a8'], [16, 5, '#f5b8d8'], [8, 6, '#ffffff']]) F.px(x, y, c);
      return { inner: '#2e322b', edge: '#24461c' };
    },
    ink(F, r) {
      F.each((x, y) => ['#e6dcc6', '#ece4d2', '#f2ebdc'][Math.floor(r() * 3)]);
      const R = (a) => 5.4 + 1.3 * Math.sin(5 * a + 1) + 0.7 * Math.sin(3 * a);
      F.shape((x, y) => Math.hypot(x - 10, y - 12) < R(Math.atan2(y - 12, x - 10)), '#121216');
      for (let i = 0; i < 7; i++) {
        const a = (i / 7) * Math.PI * 2 + 0.3, l = 8.5 + r() * 2;
        F.line(10 + 5 * Math.cos(a), 12 + 5 * Math.sin(a), 10 + l * Math.cos(a), 12 + l * Math.sin(a), 1.1, '#121216');
        F.disc(10 + (l + 1.2) * Math.cos(a), 12 + (l + 1.2) * Math.sin(a), 0.9, '#121216');
      }
      F.line(8, 16, 8, 23, 1.7, '#121216'); F.disc(8, 23.5, 1.3, '#121216');
      F.line(12.5, 16, 12.5, 27, 1.5, '#121216'); F.disc(12.5, 27.5, 1.2, '#121216');
      F.px(8, 9, '#3a3f5a'); F.px(9, 9, '#3a3f5a'); F.px(8, 10, '#2a2e44');
      return { inner: '#d9cfb8', edge: '#121216' };
    },
    lantern(F) {
      F.each((x, y) => {
        const d = Math.hypot(x + 0.5 - 10, (y + 0.5 - 15) * 0.9);
        return d < 11 ? ramp(['#2a1424', '#5a2422', '#9a4220', '#e08a38'], 1 - d / 11, x, y) : ramp(['#1a0e1e', '#24121f'], y / 31, x, y);
      });
      F.line(10, 2, 10, 6, 1, '#2a1a12'); F.px(9, 2, '#2a1a12'); F.px(11, 2, '#2a1a12');
      F.poly([[6, 9], [14, 9], [12.5, 6.5], [7.5, 6.5]], '#c99a3a');
      F.each((x, y) => (y >= 9 && y < 20 && x >= 7 && x < 13 ? (x === 7 || x === 12 ? '#8a6a22' : ramp(['#ff9a3a', '#ffc35a', '#ffe08a'], 1 - Math.abs(y - 14.5) / 6, x, y)) : null));
      F.disc(10, 15, 1.6, '#fff4c8');
      F.each((x, y) => (y >= 20 && y < 22 && x >= 6 && x < 14 ? (y === 20 ? '#c99a3a' : '#8a6a22') : null));
      for (const [x, y] of [[3, 14], [17, 14], [4, 9], [16, 20], [10, 25]]) F.px(x, y, '#f0a040');
      return { inner: '#1a0e1e', edge: '#120a14' };
    },
    dusk(F) {
      F.each((x, y) => ramp(['#2a1b4a', '#5a2a66', '#a03a62', '#e0604a', '#f8a24a'], y / 24, x, y));
      F.disc(10, 24, 5.5, (x, y) => (y % 3 === 2 && y > 19 ? null : '#ffd27a'));
      F.each((x, y) => (y >= 24 + Math.round(1.6 * Math.sin(x * 0.9) + Math.sin(x * 2.3)) ? (y >= 29 ? '#120a1c' : '#1a0f26') : null));
      return { inner: '#2a1b4a', edge: '#120a1c' };
    },
    vapor(F) {
      F.each((x, y) => (y < 18 ? ramp(['#1a0f3a', '#4a1a6a', '#a02a8a', '#ff5aa8'], y / 18, x, y) : '#1a0830'));
      F.disc(10, 12, 6, (x, y) => ([13, 15, 17].includes(y) ? null : ramp(['#ff4fa0', '#ff8a5a', '#ffd25a'], 1 - (y - 6) / 12, x, y)));
      F.each((x, y) => {
        if (y < 18) return null;
        if ([18, 19, 21, 24, 28].includes(y)) return '#ff4fd8';
        const k = (x + 0.5 - 10) / (y - 16);
        return Math.abs(k * 4 - Math.round(k * 4)) < 0.09 ? '#c23ad0' : null;
      });
      return { inner: '#1a0830', edge: '#100520' };
    },
    flint(F, r) {
      const cells = Array.from({ length: 40 }, () => ['#26262b', '#2e2e34', '#36363e', '#3e3e47'][Math.floor(r() * 4)]);
      F.each((x, y) => cells[(Math.floor(x / 4) + Math.floor(y / 3) * 5) % 40]);
      F.line(2, 26, 9, 20, 1, '#4a4a54'); F.line(12, 30, 18, 24, 1, '#4a4a54');
      F.line(13, 3, 13, 15, 1, '#ffe8a0'); F.line(7, 9, 19, 9, 1, '#ffe8a0');
      F.disc(13, 9, 1.8, '#ffffff');
      for (const [x, y, c] of [[9, 5, '#ff8a2a'], [17, 5, '#ffb02e'], [10, 13, '#ff6a1f'], [16, 13, '#ffd27a'], [6, 14, '#ff8a2a'], [18, 16, '#c8401a']]) F.px(x, y, c);
      return { inner: '#1c1c20', edge: '#141418' };
    },
    orchid(F) {
      F.each((x, y) => ramp(['#2a0f36', '#3e1650', '#521e66'], y / 31, x, y));
      F.line(10, 20, 9, 31, 1.2, '#3e7a3a');
      F.shape((x, y) => ell(x, y, 6, 27, 4.5, 1.6, -0.5) < 1, '#4e8a40');
      F.shape((x, y) => ell(x, y, 14, 25, 4.5, 1.6, 0.5) < 1, '#4e8a40');
      for (let i = 0; i < 5; i++) {
        const a = -Math.PI / 2 + (i / 5) * Math.PI * 2;
        F.shape((x, y) => ell(x, y, 10 + 4.6 * Math.cos(a), 13 + 4.6 * Math.sin(a), 4.4, 2.6, a) < 1, (x, y) => ramp(['#c2408e', '#f59ad0', '#ffd1ec'], 1 - Math.hypot(x - 10, y - 13) / 8.5, x, y));
      }
      F.disc(10, 13.5, 2.4, '#ffe066');
      for (const [x, y] of [[9, 13], [11, 14], [10, 15]]) F.px(x, y, '#c2408e');
      return { inner: '#2a0f36', edge: '#1c0a26' };
    },
    signal(F) {
      F.each((x, y) => ramp(['#05070d', '#0a0f1a', '#0f1626'], y / 31, x, y));
      for (const [rad, c] of [[5, '#5cff9d'], [9, '#45d985'], [13, '#2fae6a'], [17, '#1f7a4c']]) {
        F.shape((x, y) => Math.abs(Math.hypot(x - 10, y - 26) - rad) < 0.75 && y < 25, c);
      }
      F.line(10, 26, 10, 31, 1, '#8a8a94'); F.line(10, 31, 7, 31, 1, '#8a8a94'); F.line(10, 31, 13, 31, 1, '#8a8a94');
      F.disc(10, 25.5, 1.2, '#ff4d2e');
      return { inner: '#05070d', edge: '#030508' };
    },
    saffron(F) {
      F.each((x, y) => {
        const u = (x + y) % 8, v = (x - y + 64) % 8;
        if (u === 0 || v === 0) return '#c96a0e';
        if ((u === 4 && v === 4)) return '#8a3a08';
        return (Math.floor((x + y) / 8) + Math.floor((x - y + 64) / 8)) % 2 ? '#f2a516' : '#ffc94a';
      });
      F.each((x, y) => (y < 2 || y > 29 ? (y === 1 || y === 30 ? '#8a3a08' : '#f2a516') : null));
      return { inner: '#c96a0e', edge: '#8a3a08' };
    },
    nimbus(F) {
      F.each((x, y) => ramp(['#4f9ff0', '#7cbcff', '#b4dcff'], y / 31, x, y));
      const cloud = (cx, cy, s) => [[cx, cy, 3 * s], [cx - 3 * s, cy + 1.2 * s, 2.2 * s], [cx + 3.2 * s, cy + 1 * s, 2.4 * s], [cx + 0.5 * s, cy + 2 * s, 2.6 * s]];
      for (const [cx, cy, s] of [[6, 7, 1], [14, 15, 1.2], [5, 24, 0.9], [16, 27, 0.7]]) {
        const parts = cloud(cx, cy, s);
        F.shape((x, y) => parts.some(([px, py, pr]) => (x - px) ** 2 + (y - py) ** 2 <= pr * pr), (x, y) => (y > cy + 1.5 * s ? '#cfe0f2' : y > cy + 0.4 * s ? '#eef6ff' : '#ffffff'));
      }
      return { inner: '#4f9ff0', edge: '#3a80cc' };
    },
    quartz(F) {
      F.each((x, y) => ramp(['#1e1222', '#2a1a2e', '#36203a'], y / 31, x, y));
      for (const [cx, top, w, h] of [[10, 5, 5, 20], [5.5, 11, 4, 13], [14.5, 9, 4, 15], [8, 17, 3, 9], [13, 18, 3, 8]]) {
        const pts = [[cx - w / 2, top + 2], [cx, top], [cx + w / 2, top + 2], [cx + w / 2, top + h], [cx - w / 2, top + h]];
        F.poly(pts, (x, y) => (x + 0.5 < cx ? (y < top + 2 ? '#ffffff' : '#ffe4ef') : y < top + 2 ? '#f6b8d2' : '#d98ab0'));
        F.line(cx, top + 0.5, cx, top + h, 0.6, '#fff4f8');
      }
      F.each((x, y) => (y >= 26 ? ramp(['#3a2a3a', '#2a1e2a'], (y - 26) / 6, x, y) : null));
      return { inner: '#1e1222', edge: '#140c16' };
    },
    cinder(F, r) {
      F.each(() => ['#141012', '#1a1416', '#201819'][Math.floor(r() * 3)]);
      const walk = (x, y, steps) => {
        for (let i = 0; i < steps; i++) {
          for (const [dx, dy] of [[-1, 0], [1, 0], [0, -1], [0, 1]]) { const g = F.get(x + dx, y + dy); if (g && g[0] < 60) F.px(x + dx, y + dy, '#5a1a0c'); }
          F.px(x, y, r() < 0.3 ? '#ffd04a' : '#ff6a1f');
          x += Math.round(r() * 2 - 1); y += 1;
        }
      };
      walk(5, 2, 14); walk(14, 6, 18); walk(9, 18, 12); walk(3, 20, 10);
      for (let i = 0; i < 10; i++) F.px(Math.floor(r() * 20), Math.floor(r() * 32), '#5a5054');
      return { inner: '#141012', edge: '#0c090a' };
    },
    lagoon(F) {
      F.each((x, y) => {
        if (y >= 27) return ramp(['#d8c08a', '#f0d9a0'], (y - 27) / 4, x, y);
        const v = Math.sin(x * 1.05 + y * 0.45) + Math.sin(y * 0.9 - x * 0.55) + Math.sin((x + y) * 0.5);
        if (v > 2.05) return '#d8fff4';
        return ramp(['#0b6e7a', '#14a3a8', '#3fd1c4', '#7fe8d8'], 1 - y / 27 * 0.8 + (v > 1.5 ? 0.15 : 0), x, y);
      });
      return { inner: '#0b5e6a', edge: '#084a54' };
    },
    velvet(F) {
      F.each((x, y) => ((Math.abs(((x + 2) % 8) - 4) + Math.abs(((y + 4) % 8) - 4)) === 3 ? '#701a34' : (x + y) % 2 ? '#5a0f24' : '#540e22'));
      F.each((x, y) => ((x === 1 || x === 18) && y > 0 && y < 31) || ((y === 1 || y === 30) && x > 0 && x < 19) ? '#d4a73a' : null);
      F.poly([[10, 10], [12.5, 14], [10, 18], [7.5, 14]], '#d4a73a');
      F.px(10, 14, '#f2cf6a'); F.px(10, 8, '#d4a73a'); F.px(10, 20, '#d4a73a');
      return { inner: '#3e0a18', edge: '#a8822a' };
    },
    ridge(F) {
      F.each((x, y) => ramp(['#a8d0f0', '#cfe6f8', '#f0f6fc'], y / 16, x, y));
      const layer = (base, amp, f, ph, c, snow) => F.each((x, y) => {
        const top = base - amp * Math.abs(Math.sin(x * f + ph));
        return y >= top ? (snow && y < top + 2 && top < base - amp * 0.55 ? '#f8fbff' : c) : null;
      });
      layer(16, 8, 0.22, 0.3, '#8aa6c8', true);
      layer(22, 7, 0.3, 1.6, '#5a789e', true);
      layer(28, 5, 0.42, 0.9, '#2e4566', false);
      F.each((x, y) => (y >= 29 ? '#1c2c44' : null));
      return { inner: '#2e4566', edge: '#1c2c44' };
    },
    prism(F, r) {
      F.each((x, y) => ramp(['#0a1030', '#0d1640', '#111c4e'], y / 31, x, y));
      // Soft rainbow glints where light through the crystal lands on the cloth.
      const hues = ['#ff6b8a', '#ffb45a', '#fff07a', '#7af0a8', '#6ac8ff', '#a88cff'];
      [[3, 4], [16, 3], [2, 25], [17, 26], [5, 29], [14, 30], [1, 15], [18, 17], [9, 27], [12, 25]].forEach(([x, y], i) => {
        const c = hues[i % hues.length];
        for (const [dx, dy] of [[-1, 0], [1, 0], [0, -1], [0, 1]]) F.px(x + dx, y + dy, mix(c, '#111c4e', 0.6));
        F.px(x, y, c);
      });
      // A cut gem: table, crown and pavilion facets in icy blues.
      const T1 = [7, 7], T2 = [13, 7], C1 = [3.5, 11.5], C2 = [16.5, 11.5], M1 = [6, 10], M2 = [14, 10], G1 = [8, 11.5], G2 = [12, 11.5], B = [10, 23];
      for (const [pts, c] of [
        [[T1, T2, M2, M1], '#eaf2ff'],
        [[T1, M1, C1], '#9fb6ea'],
        [[T2, C2, M2], '#c9d7f8'],
        [[M1, G1, C1], '#7c95d6'],
        [[M1, M2, G2, G1], '#d6e1fb'],
        [[M2, C2, G2], '#b0c3f2'],
        [[C1, G1, B], '#4f68b8'],
        [[G1, G2, B], '#8da6e4'],
        [[G2, C2, B], '#6680c8'],
      ]) F.poly(pts, c);
      F.line(8, 11.5, 10, 23, 0.5, '#c6d6ff');
      F.px(8, 8, '#ffffff'); F.px(9, 8, '#ffffff'); F.px(12, 9, '#f4f8ff');
      F.px(11, 15, '#c9a8ff'); F.px(9, 17, '#9fe8ff');
      return { inner: '#0a1030', edge: '#070b22' };
    },
    harbor(F) {
      F.each((x, y) => (Math.floor(y / 3) % 2 ? '#eef0f4' : '#1c2a4a'));
      F.disc(10, 15, 6.5, '#eef0f4');
      F.disc(10, 15, 6.5, (x, y) => (Math.hypot(x + 0.5 - 10, y + 0.5 - 15) > 5.6 ? '#c8323a' : null));
      F.line(10, 10.5, 10, 19, 1.3, '#1c2a4a');
      F.line(7.5, 12, 12.5, 12, 1.1, '#1c2a4a');
      F.disc(10, 10, 1.1, '#1c2a4a');
      F.shape((x, y) => Math.abs(Math.hypot(x - 10, y - 15.5) - 3.6) < 0.7 && y > 16, '#1c2a4a');
      return { inner: '#1c2a4a', edge: '#121c32' };
    },
    founder(F) {
      F.each((x, y) => ramp(['#1c1c21', '#17171b', '#121216'], y / 31, x, y));
      F.each((x, y) => ((x === 1 || x === 18) && y > 0 && y < 31) || ((y === 1 || y === 30) && x > 0 && x < 19) ? '#d4a73a' : ((x === 2 || x === 17) && y > 1 && y < 30) || ((y === 2 || y === 29) && x > 1 && x < 18) ? '#6a5418' : null);
      F.poly([[4, 8], [16, 8], [16, 17], [10, 23], [4, 17]], '#d4a73a');
      F.poly([[5.2, 9.2], [14.8, 9.2], [14.8, 16.5], [10, 21.4], [5.2, 16.5]], '#1c1c21');
      const star = Array.from({ length: 10 }, (_, i) => { const a = -Math.PI / 2 + (i * Math.PI) / 5, rr = i % 2 ? 1.7 : 4; return [10 + rr * Math.cos(a), 14 + rr * Math.sin(a)]; });
      F.poly(star, '#f2cf6a');
      F.line(6, 26, 10, 24, 1, '#d4a73a'); F.line(10, 24, 14, 26, 1, '#d4a73a');
      return { inner: '#121216', edge: '#6a5418' };
    },
  };

  // Squad emblems on a 100-unit box centred on 0, 0.
  const EMBLEMS = {
    wolf: 'M-30-42L-13-20H13L30-42L35-6L22 14L8 40L0 46L-8 40L-22 14L-35-6Z',
    crown: 'M-38 26V-22L-19 2L0-34L19 2L38-22V26Z',
    flame: 'M0-46C12-28 30-16 30 8C30 30 16 44 0 44C-16 44-30 30-30 8C-30-8-18-14-12-30C-6-18 0-16 0-46Z',
    star: 'M0-42L11-13L42-13L17 6L27 38L0 19L-27 38L-17 6L-42-13L-11-13Z',
    bolt: 'M8-44L-26 6H-2L-10 44L26-8H2Z',
    moon: 'M10-40A40 40 0 1 0 38 18A32 32 0 1 1 10-40Z',
  };
  const WOLF_FACE = 'M-20-2L-6 4L-18 9Z M20-2L6 4L18 9Z M-6 30H6L0 38Z';

  function paintSquad(F, a, b, emblem) {
    const g = document.createElement('canvas').getContext('2d');
    const shape = new Path2D(EMBLEMS[emblem] || EMBLEMS.star), face = new Path2D(WOLF_FACE);
    const at = (x, y) => [(x - 10) / 0.17, (y - 12) / 0.17];
    F.each((x, y) => ramp([tone(a, 1.12), col(a), tone(a, 0.85)], y / 31, x, y));
    F.shape((x, y) => g.isPointInPath(shape, ...at(x, y)) && !(emblem === 'wolf' && g.isPointInPath(face, ...at(x, y))), b);
    F.each((x, y) => {
      const v = y - 22 - Math.abs(x + 0.5 - 10) * -0.45;
      return v >= 0 && v < 3 ? b : null;
    });
    F.each((x, y) => ((x === 1 || x === 18) && y > 0 && y < 31) || ((y === 1 || y === 30) && x > 0 && x < 19) ? tone(b, 0.7) : null);
    return { inner: tone(a, 0.6), edge: tone(a, 0.5) };
  }

  function capeTexture(id) {
    const key = typeof id === 'string' ? id : `squad:${id.colorA}:${id.colorB}:${id.emblem}`;
    return memo(`cape:${key}`, () => {
      const P = new Pix(128, 64);
      const [fx, fy, fw, fh] = CAPE_UV.front;
      const F = region(P, fx, fy, fw, fh);
      const r = rng(hash(key));
      const { inner, edge } = typeof id === 'string'
        ? (CAPES[id] || CAPES.founder)(F, r)
        : paintSquad(F, id.colorA, id.colorB, id.emblem);
      const n = (c) => tone(c, 0.92 + r() * 0.12);
      const [bx, by, bw, bh] = CAPE_UV.back;
      P.fill(bx, by, bw, bh, (x, y) => (y < 2 ? tone(inner, 0.8) : n(inner)));
      for (const k of ['right', 'left', 'top', 'bottom']) { const [x, y, w, h] = CAPE_UV[k]; P.fill(x, y, w, h, () => n(edge)); }
      return P.canvas();
    });
  }

  // The front face alone, for preview cards.
  function capeFront(id) {
    const key = typeof id === 'string' ? id : `squad:${id.colorA}:${id.colorB}:${id.emblem}`;
    return memo(`capefront:${key}`, () => {
      const [x, y, w, h] = CAPE_UV.front;
      const c = document.createElement('canvas');
      c.width = w; c.height = h;
      c.getContext('2d').drawImage(capeTexture(id), x, y, w, h, 0, 0, w, h);
      return c;
    });
  }

  // Wings ----------------------------------------------------------------------------
  // One wing on 32x32, its root on the left edge; the other side is a mirror.
  const WINGS = {
    moth(F) {
      const up = (x, y) => ell(x, y, 15, 11, 15.5, 9, -0.25), lo = (x, y) => ell(x, y, 11, 22.5, 10, 6.5, 0.45);
      F.shape((x, y) => up(x, y) < 1 || lo(x, y) < 1, (x, y) => {
        const e = Math.min(up(x + 0.5, y + 0.5), lo(x + 0.5, y + 0.5));
        if (e > 0.72) return '#5a4836';
        return ramp(['#8a7558', '#b8a27e', '#e2d2b4', '#f0e4c8'], x / 28 + 0.2, x, y);
      });
      for (const [x1, y1] of [[28, 6], [26, 16], [18, 27], [9, 28]]) F.line(0.5, 16, x1, y1, 0.8, '#9a8566');
      F.disc(19, 9.5, 3, '#3a2c22'); F.disc(19, 9.5, 1.7, '#f0e2c6'); F.disc(19.3, 9.3, 0.7, '#3a2c22');
      F.disc(12, 23, 1.8, '#4a3a2c');
    },
    raven(F) {
      for (let i = 0; i < 7; i++) {
        const a = -0.55 + i * 0.22, len = 26 - Math.abs(i - 2) * 2.2;
        F.shape((x, y) => ell(x, y, 2 + Math.cos(a) * len / 2, 13 + Math.sin(a) * len / 2, len / 2, 2.6, a) < 1, (x, y) => (ell(x, y, 2 + Math.cos(a) * len / 2, 13 + Math.sin(a) * len / 2, len / 2, 2.6, a) < 0.3 ? '#4a4a6e' : ell(x, y, 2 + Math.cos(a) * len / 2, 13 + Math.sin(a) * len / 2, len / 2, 2.6, a) > 0.75 ? '#0e0e14' : '#24243a'));
      }
      F.shape((x, y) => ell(x, y, 7, 10, 8, 5, -0.2) < 1, (x, y) => (y < 8 ? '#4a4a72' : '#20202c'));
    },
    glass(F, r) {
      const pts = Array.from({ length: 9 }, () => [r() * 28, 2 + r() * 26]);
      const pal = [[190, 230, 250, 210], [210, 200, 250, 210], [170, 240, 230, 210], [230, 240, 255, 220]];
      F.shape((x, y) => inPoly([[0, 10], [14, 2], [30, 3], [26, 14], [30, 22], [18, 30], [4, 24], [0, 20]], x, y), (x, y) => {
        let d1 = 1e9, d2 = 1e9, k = 0;
        pts.forEach((p, i) => { const d = Math.hypot(x + 0.5 - p[0], y + 0.5 - p[1]); if (d < d1) { d2 = d1; d1 = d; k = i; } else if (d < d2) d2 = d; });
        return d2 - d1 < 0.9 ? '#2a3440' : pal[k % 4];
      });
    },
    petal(F) {
      for (const [cx, cy, rx, ry, a] of [[13, 8, 13, 5.5, -0.5], [15, 16, 14, 5.5, 0.05], [12, 24, 11, 5, 0.6]]) {
        F.shape((x, y) => ell(x, y, cx, cy, rx, ry, a) < 1, (x, y) => {
          const e = ell(x + 0.5, y + 0.5, cx, cy, rx, ry, a);
          return e > 0.78 ? '#c2457a' : ramp(['#f07aa8', '#f8a8c8', '#ffd6e6'], 1 - e, x, y);
        });
      }
    },
    circuit(F) {
      F.poly([[0, 8], [10, 3], [30, 2], [24, 10], [30, 16], [20, 22], [24, 28], [8, 28], [0, 22]], '#1a1e30');
      for (const [x0, y0, x1, y1] of [[1, 10, 14, 10], [14, 10, 22, 4], [1, 15, 20, 15], [20, 15, 26, 11], [1, 20, 12, 20], [12, 20, 18, 25], [6, 15, 6, 25]]) F.line(x0, y0, x1, y1, 1, '#3b6cff');
      for (const [x, y] of [[22, 4], [26, 11], [18, 25], [6, 25], [14, 10], [20, 15]]) { F.px(x, y, '#9fb6ff'); F.px(x - 1, y, '#9fb6ff'); }
    },
    frost(F) {
      for (let i = 0; i < 6; i++) {
        const a = -0.8 + i * 0.32, l = 20 + (i % 2) * 8;
        const tip = [2 + Math.cos(a) * l, 15 + Math.sin(a) * l];
        F.poly([[1, 15 - 2], tip, [1, 15 + 2]], (x, y) => (Math.abs(((y - 15) - Math.tan(a) * (x - 1))) < 0.8 ? '#ffffff' : '#bcd8f0'));
      }
      F.disc(2, 15, 3, '#e6f2ff');
    },
    kite(F) {
      F.poly([[0, 14], [14, 2], [30, 13], [14, 28]], (x, y) => ((x < 14) !== (y < 14) ? '#f4f4f8' : '#e8402a'));
      F.line(0, 14, 30, 13, 1, '#1a1a1e'); F.line(14, 2, 14, 28, 1, '#1a1a1e');
      F.line(14, 28, 18, 31, 1, '#1a1a1e');
    },
    vesper(F) {
      const tips = [[30, 4], [28, 15], [22, 24], [12, 29]];
      F.shape((x, y) => inPoly([[0, 8], ...tips, [0, 26]], x, y) && !tips.slice(0, -1).some(([tx, ty], i) => { const [ux, uy] = tips[i + 1]; return Math.hypot(x - (tx + ux) / 2 + 2, y - (ty + uy) / 2 + 1) < 3.2; }), (x, y) => ramp(['#3a2670', '#5a3a9a', '#7a5ac0'], x / 30, x, y));
      for (const [x1, y1] of tips) F.line(1, 10, x1, y1, 1.2, '#20123a');
    },
  };
  function wingTexture(id) {
    return memo(`wing:${id}`, () => {
      const P = new Pix(48, 48);
      (WINGS[id] || WINGS.moth)(region(P, 0, 0, 32, 32, 1.5), rng(hash(id)));
      return P.canvas();
    });
  }

  // The README picture: a skyline at dusk,
  // 1600x900 (drawn at half size), with windows that flicker across 18 frames.
  function sunset(frame = 0) {
    return memo(`sunset:${frame % 18}`, () => {
      const c = document.createElement('canvas');
      c.width = 800; c.height = 450;
      const g = c.getContext('2d');
      const sky = g.createLinearGradient(0, 0, 0, 450);
      [[0, '#24184a'], [0.32, '#6a2c6e'], [0.58, '#e2583f'], [0.74, '#ffb25e'], [0.8, '#ffd08a']].forEach(([o, k]) => sky.addColorStop(o, k));
      g.fillStyle = sky;
      g.fillRect(0, 0, 800, 450);
      const glow = g.createRadialGradient(490, 300, 10, 490, 300, 220);
      glow.addColorStop(0, 'rgba(255,236,170,0.95)');
      glow.addColorStop(0.25, 'rgba(255,200,120,0.55)');
      glow.addColorStop(1, 'rgba(255,160,90,0)');
      g.fillStyle = glow;
      g.fillRect(0, 0, 800, 450);
      g.fillStyle = '#ffe7a8';
      g.beginPath(); g.arc(490, 300, 52, 0, Math.PI * 2); g.fill();
      let r = rng(7);
      const towers = [];
      for (let x = -10; x < 810;) {
        const w = 26 + r() * 46, h = 60 + r() * 150 * (x > 380 && x < 620 ? 1.25 : 1);
        towers.push([x, w, h]);
        x += w + 3;
      }
      g.fillStyle = '#1c1233';
      for (const [x, w, h] of towers) g.fillRect(x, 450 - h - 40, w, h + 40);
      g.fillStyle = '#140c26';
      g.fillRect(0, 418, 800, 32);
      r = rng(11);
      for (const [x, w, h] of towers) {
        for (let wy = 450 - h - 28; wy < 400; wy += 12) {
          for (let wx = x + 5; wx < x + w - 6; wx += 9) {
            const v = r(), lit = v < 0.22 || (v < 0.3 && (Math.floor(v * 997) + frame) % 6 < 3);
            if (!lit) continue;
            g.fillStyle = v < 0.12 ? '#ffd27a' : '#ff9d5c';
            g.fillRect(wx, wy, 4, 6);
          }
        }
      }
      return c;
    });
  }

  // A picture fitted to a cape's front face at 160x256 (see drip_core::fit_cover).
  function pictureCape(src, crop, key) {
    return memo(`picture:${key}:${crop.x}:${crop.y}`, () => {
      const c = document.createElement('canvas');
      c.width = 160; c.height = 256;
      const k = src.width / 1600;
      c.getContext('2d').drawImage(src, crop.x * k, crop.y * k, crop.w * k, crop.h * k, 0, 0, 160, 256);
      return c;
    });
  }

  // A player's own skin, fetched by the app. Old 64x32 skins get their right
  // arm and leg copied to the left, the way the game reads them.
  function useSkin(name, img) {
    const c = document.createElement('canvas');
    c.width = 64; c.height = 64;
    const g = c.getContext('2d');
    g.drawImage(img, 0, 0);
    if (img.height === 32) {
      g.drawImage(c, 0, 16, 16, 16, 16, 48, 16, 16);
      g.drawImage(c, 40, 16, 16, 16, 32, 48, 16, 16);
    }
    cache.set(`skin:${name}`, c);
  }

  // Shared cache ----------------------------------------------------------------------
  const cache = new Map();
  function memo(key, make) {
    if (!cache.has(key)) cache.set(key, make());
    return cache.get(key);
  }

  window.DripArt = { skinTexture, useSkin, capeTexture, capeFront, wingTexture, sunset, pictureCape, CAPE_UV, PLAYERS, boxUV, PARTS, CAPES: Object.keys(CAPES), WINGS: Object.keys(WINGS) };
})();
