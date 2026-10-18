// The Drip window: the wardrobe, your squad and your own cape. The Rust core
// signs you in through the game and talks to the Drip server; this file turns
// that state into screens. window.drip drives it for screenshots.
(function () {
  const F = window.DripFigure;
  const A = window.DripArt;
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const $ = (sel) => document.querySelector(sel);
  const $$ = (sel) => [...document.querySelectorAll(sel)];

  const svg = (d) => `<svg class="i" viewBox="0 0 24 24"><path d="${d}"/></svg>`;
  const icon = {
    min: '<svg viewBox="0 0 10 10"><path d="M0 5.5h10"/></svg>',
    max: '<svg viewBox="0 0 10 10"><rect x="0.5" y="0.5" width="9" height="9"/></svg>',
    close: '<svg viewBox="0 0 10 10"><path d="M0 0l10 10M10 0L0 10"/></svg>',
    check: svg('M5 12.5l4.5 4.5L19 7.5'),
    copy: svg('M9 9h10v10H9z M15 9V5H5v10h4'),
    invite: svg('M12 15V3 M7.5 7.5L12 3l4.5 4.5 M5 12v7.5h14V12'),
    upload: svg('M12 15V4 M7.5 8.5L12 4l4.5 4.5 M4 15v4.5h16V15'),
    drag: svg('M3.5 12h17 M7.5 8l-4 4 4 4 M16.5 8l4 4-4 4'),
  };
  // Emotes, clockwise from the top of the wheel.
  const EMOTE_ICON = {
    wave: 'M8 13V7.5a1.5 1.5 0 0 1 3 0V11 M11 11V5.5a1.5 1.5 0 0 1 3 0V11 M14 11V6.5a1.5 1.5 0 0 1 3 0V13 M17 11a1.5 1.5 0 0 1 3 0v3a6.5 6.5 0 0 1-6.5 6.5h-.8a6 6 0 0 1-5-2.7L5 14.5a1.5 1.5 0 0 1 2.6-1.5L8 13.5 M3 7c.5-1.5 1.5-2.6 3-3.2',
    dance: 'M9 18V5.5l11-2.5v12.5 M3 18a3 3 0 1 0 6 0 3 3 0 1 0-6 0 M14 15.5a3 3 0 1 0 6 0 3 3 0 1 0-6 0',
    sit: 'M7 3v10h9.5l1 8 M7 13v8 M7 9h8.5',
    point: 'M3.5 12h15 M13.5 7l5 5-5 5',
    clap: 'M8 21l3.5-11 M16 21l-3.5-11 M12 3v2.5 M6.5 5.5l1.5 1.8 M17.5 5.5L16 7.3',
    bow: 'M18 7a2 2 0 1 0-.01 0 M15.5 10H7 M7 10v11 M7 10l2.5 11 M12 10l.5 5',
    facepalm: 'M4.5 13a7.5 7.5 0 1 0 15 0 7.5 7.5 0 1 0-15 0 M8.5 4v6 M11 3v7 M13.5 3.5V10 M16 5v5 M8.5 10H16 M9 16.5h6',
    gg: 'M9.3 9.2A3.6 3.6 0 1 0 10.6 12H7.6 M18.9 9.2A3.6 3.6 0 1 0 20.2 12h-3',
  };
  // The mark: a cape with rounded drips at the hem.
  const CAPE_PATH = 'M24 12H27.6Q32 18.2 36.4 12H40Q43 12 43.6 15L50 42.5Q50.6 45.5 47.5 45.5V48A2.5 2.5 0 0 1 42.5 48V46Q39 44.8 36 45.2V50A3 3 0 0 1 30 50V45.4Q26 44.6 22 45.4V53A3 3 0 0 1 16 53V45.5Q13.4 45.5 14 42.5L20.4 15Q21 12 24 12Z';
  const mark = `<svg viewBox="10 9 44 48"><path d="${CAPE_PATH}" fill="#f5f5f7"/><path d="M25.5 17.5L22.5 31" stroke="#3b6cff" stroke-width="2.6" stroke-linecap="round" fill="none"/></svg>`;

  // The catalog, in the order of catalog/cosmetics.toml.
  const CATALOG = {
    cape: { label: 'Capes', side: 'back', items: A.CAPES },
    wings: { label: 'Wings', side: 'back', items: A.WINGS },
    hat: { label: 'Hats', side: 'front', items: ['beanie', 'bucket', 'visor', 'crown', 'beret', 'headset', 'antlers', 'hood', 'topper', 'bandana', 'halo', 'sprout'] },
    pet: { label: 'Pets', side: 'front', items: ['fox', 'owl', 'frog', 'crow', 'snail', 'hedgehog'] },
    emote: { label: 'Emotes', side: 'front', items: Object.keys(EMOTE_ICON) },
  };
  const NEW = new Set(['aurora', 'glass', 'headset']);
  const title = (id) => (id === 'gg' ? 'GG' : id[0].toUpperCase() + id.slice(1));

  const SQUAD = {
    name: 'Wolves', code: 'WOLF-7Q2K',
    cape: { colorA: '#1c2340', colorB: '#e9eef6', emblem: 'wolf' },
    members: ['nightowl_07', 'mossy', 'kai_builds', 'Lumen', 'ripley_r'],
  };
  const SOURCE = { name: 'sunset.gif', w: 1600, h: 900, frames: 18, kb: 286 };

  const S = {
    tab: 'wardrobe',
    connected: true,
    me: 'nightowl_07',
    cat: 'cape',
    wearing: { cape: 'tide', wings: 'moth', hat: null, pet: 'fox' },
    pick: { cape: 'tide', wings: 'moth', hat: null, pet: 'fox' },
    hover: null, // a card under the pointer, tried on until the pointer leaves
    emote: 'wave',
    side: 'back',
    drag: 0,
    dropped: false,
    focus: 0.6,
    frame: 0,
    still: null, // { yaw, t } freezes the turntable for screenshots
  };

  // Same as drip_core::fit_cover.
  function fitCover(sw, sh, dw, dh, fx, fy) {
    let w = sw, h = sh;
    if (sw * dh > sh * dw) w = Math.min(sw, Math.round((sh * dw) / dh));
    else h = Math.min(sh, Math.round((sw * dh) / dw));
    const place = (size, crop, f) => Math.min(size - crop, Math.max(0, Math.round(Math.min(1, Math.max(0, f)) * size - crop / 2)));
    return { x: place(sw, w, fx), y: place(sh, h, fy), w, h };
  }

  // Your own skin. After you connect, the app asks Mojang's public profile API
  // for it, by name, with no login; those stand in until then.
  async function loadOwnSkin(name) {
    const get = window.__TAURI__?.http?.fetch || window.fetch;
    const json = async (url) => { const r = await get(url); if (!r.ok) throw new Error(`${r.status}`); return r.json(); };
    const { id } = await json(`https://api.mojang.com/users/profiles/minecraft/${encodeURIComponent(name)}`);
    const profile = await json(`https://sessionserver.mojang.com/session/minecraft/profile/${id}`);
    const textures = JSON.parse(atob(profile.properties.find((p) => p.name === 'textures').value));
    const url = textures.textures.SKIN && textures.textures.SKIN.url;
    if (!url) return;
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.src = url.replace('http://', 'https://');
    await img.decode();
    A.useSkin(name, img);
  }

  // Screens ------------------------------------------------------------------------
  function shell(view) {
    const tabs = [['wardrobe', 'Wardrobe'], ['squad', 'Squad'], ['custom', 'Make your own']];
    return `
    <div class="win">
      <header class="titlebar">
        <div class="brand">${mark}<span class="wordmark">Drip</span></div>
        <nav class="tabs">${tabs.map(([k, t]) => `<button data-tab="${k}" class="${S.tab === k ? 'on' : ''}">${t}</button>`).join('')}</nav>
        <div class="right">
          <button class="me" id="me">${S.connected ? `<span class="dot"></span>${S.me}` : '<span class="dot off"></span>Not connected'}</button>
          <div class="winctl"><span>${icon.min}</span><span>${icon.max}</span><span>${icon.close}</span></div>
        </div>
      </header>
      <main class="view" id="view">${view}</main>
      <div class="toast" id="toast"><span class="tick">${icon.check}</span><span id="toast-text"></span></div>
    </div>`;
  }

  function stage(kicker, name, sticker = '', turn = true) {
    return `
      <div class="stage" id="stage">
        <div class="kicker">${kicker}</div>
        ${turn ? `<div class="turn"><button data-side="front" class="${S.side === 'front' ? 'on' : ''}">Front</button><button data-side="back" class="${S.side === 'back' ? 'on' : ''}">Back</button></div>` : ''}
        <div class="dropname"><span class="nm"><h2 id="name">${name}</h2></span></div>
        <canvas id="fig"></canvas>
        <div class="dropname over" aria-hidden="true"><span class="nm"><h2 id="name2">${name}</h2>${sticker}</span></div>
      </div>`;
  }

  const current = () => (S.cat === 'emote' ? S.emote : S.pick[S.cat]) || CATALOG[S.cat].items[0];
  const shown = () => S.hover || current();

  function wardrobeView() {
    const cat = CATALOG[S.cat];
    const cur = current();
    const n = String(cat.items.indexOf(shown()) + 1).padStart(2, '0');
    const wearing = S.cat !== 'emote' && S.wearing[S.cat] === cur;
    return `
    <section class="split wardrobe">
      ${stage(`<b id="kind">${cat.label.replace(/s$/, '') === 'Wing' ? 'Wings' : cat.label.replace(/s$/, '')}</b><span id="count">${n} / ${cat.items.length}</span>`, title(shown()), '<i class="sticker">FREE</i>')}
      <aside class="panel">
        <h1>Free drip. <em>Every piece.</em></h1>
        <div class="chips">${Object.entries(CATALOG).map(([k, c]) => `<button data-cat="${k}" class="${S.cat === k ? 'on' : ''}">${c.label}</button>`).join('')}</div>
        <div class="grid" id="grid">${cat.items.map((id) => `
          <button class="card ${id === cur ? 'on' : ''}" data-id="${id}">
            <canvas></canvas><span>${title(id)}</span>${NEW.has(id) ? '<i class="sticker">NEW</i>' : ''}
          </button>`).join('')}
        </div>
        <div class="foot">
          <p class="line">Everyone with Drip sees it, on any server.</p>
          ${wearButton(wearing, S.cat === 'emote' ? 'Try it' : 'Wear it')}
        </div>
      </aside>
    </section>`;
  }
  const wearButton = (done, label = 'Wear it') =>
    `<button class="primary${done ? ' done' : ''}" id="wear">${done ? `${icon.check}Wearing` : label}</button>`;

  function squadView() {
    return `
    <section class="split squad">
      ${stage(`<b>Squad cape</b><span>${SQUAD.members.length} wearing</span>`, SQUAD.name, '', false)}
      <aside class="panel">
        <h1>Your crew. <em>One cape.</em></h1>
        <div class="members">${SQUAD.members.map((m, i) => `<div class="member${i === 0 ? ' you' : ''}"><canvas data-face="${m}"></canvas><span>${m}</span></div>`).join('')}</div>
        <div class="code">
          <div class="chip">${SQUAD.code}<button class="copy" id="copy" aria-label="Copy the code">${icon.copy}</button></div>
          <span class="copied" id="copied">Copied</span>
        </div>
        <p class="line">Everyone in ${SQUAD.name} wears this cape.</p>
        <div class="actions"><button class="primary" id="invite">${icon.invite}Invite</button><button class="quiet">Join another squad</button></div>
      </aside>
    </section>`;
  }

  function customView() {
    if (!S.dropped) {
      return `
      <section class="custom-empty">
        <div class="dropzone" id="dropzone">
          <div class="glyph">${icon.upload}</div>
          <h1>Drop a picture or a GIF</h1>
          <p>PNG, JPG or GIF, up to 512 KB. A GIF becomes an animated cape.</p>
          <button class="quiet">Choose a file</button>
        </div>
      </section>`;
    }
    return `
    <section class="split custom">
      ${stage(`<b>${SOURCE.name}</b><span>${SOURCE.frames} frames</span>`, 'Yours', '<i class="sticker">FREE</i>')}
      <aside class="panel">
        <h1>Your picture. <em>Your cape.</em></h1>
        <div class="cropper" id="cropper"><canvas id="src"></canvas><div class="window" id="crop"><span class="handle">${icon.drag}</span></div></div>
        <div class="file"><span>${SOURCE.name} · ${SOURCE.w}×${SOURCE.h} · ${SOURCE.kb} KB</span><span>Drag to move</span></div>
        <div class="foot">
          <p class="line">Everyone can see it. Anyone can hide or report it.</p>
          ${wearButton(false)}
        </div>
      </aside>
    </section>`;
  }

  function firstView() {
    return `
    <section class="first">
      <div class="mark">${mark}</div>
      <h1>Add Drip to Horizon, then open the game once</h1>
      ${S.connected
        ? `<div class="status"><span class="dot"></span>Connected as ${S.me}</div>`
        : `<button class="primary" id="add">Add to Horizon</button>
           <p class="small">Horizon asks you to trust the mod the first time. Its first build can take a while.</p>`}
    </section>`;
  }

  function detailsSheet() {
    return `
    <div class="sheet" id="sheet">
      <div class="row"><span>Hide all cosmetics</span><span class="switch"></span></div>
      <div class="row col"><span>Show custom capes from</span>
        <div class="seg" style="margin-top:10px"><button class="on">Everyone</button><button>Friends and squad</button><button>Nobody</button></div></div>
      <div class="row"><span>Server</span><span class="mono">drip.SparrowPortray.workers.dev</span></div>
    </div>`;
  }

  // Previews -------------------------------------------------------------------------
  // Every card is a picture of the piece: capes flat, front face, in their own
  // pixels; wings as a pair; hats on a head; pets on their own; emotes as a pose.
  function paintCard(c, cat, id) {
    const { g, w, h } = F.fit(c);
    g.imageSmoothingEnabled = false;
    if (cat === 'cape') {
      const img = A.capeFront(id);
      const k = Math.floor(Math.min((w - 16) / img.width, (h - 6) / img.height));
      const x = Math.round((w - img.width * k) / 2), y = Math.round((h - img.height * k) / 2);
      g.fillStyle = 'rgba(0,0,0,0.35)';
      g.fillRect(x + 3, y + 4, img.width * k, img.height * k);
      g.drawImage(img, x, y, img.width * k, img.height * k);
      return;
    }
    if (cat === 'wings') {
      const img = A.wingTexture(id), s = 46;
      g.drawImage(img, w / 2 + 1, (h - s) / 2, s, s);
      g.save(); g.scale(-1, 1); g.drawImage(img, -w / 2 + 1, (h - s) / 2, s, s); g.restore();
      return;
    }
    if (cat === 'hat') {
      F.render(g, [{ faces: F.player({ skin: S.me, hat: id }), yaw: 28 }], { dist: 70, pitch: 12, ppu: 6.4, cx: w / 2, cy: h * 0.62, target: 29 });
      return;
    }
    if (cat === 'pet') {
      F.render(g, [{ faces: F.pet(id), yaw: 32 }], { dist: 60, pitch: 14, ppu: 15, cx: w / 2, cy: h * 0.62, target: 2.6 });
      return;
    }
    F.render(g, [{ faces: F.player({ skin: S.me }, { emote: id, t: 0.25 }), yaw: 24 }], { dist: 90, pitch: 6, ppu: 2.9, cx: w / 2, cy: h * 0.5, target: 16 });
  }

  // A round avatar: the face and its overlay, in the skin's own pixels.
  function paintFace(c, name) {
    const { g, w } = F.fit(c);
    const skin = A.skinTexture(name);
    g.imageSmoothingEnabled = false;
    g.drawImage(skin, 8, 8, 8, 8, 0, 0, w, w);
    g.drawImage(skin, 40, 8, 8, 8, 0, 0, w, w);
  }

  // Mounting -----------------------------------------------------------------------------
  const app = document.getElementById('app');
  function mount() {
    let view;
    if (S.tab === 'first') view = firstView();
    else if (S.tab === 'squad') view = squadView();
    else if (S.tab === 'custom') view = customView();
    else view = wardrobeView();
    app.innerHTML = shell(view);
    $$('.card canvas').forEach((c) => paintCard(c, S.cat, c.parentElement.dataset.id));
    $$('[data-face]').forEach((c) => paintFace(c, c.dataset.face));
    paintSource();
    fitName();
    bind();
  }

  // The big name is as large as the stage allows.
  function fitName() {
    const stageEl = $('#stage');
    if (!stageEl) return;
    const max = stageEl.clientWidth - 72;
    for (const h of [$('#name'), $('#name2')]) {
      h.style.fontSize = '120px';
      const w = h.scrollWidth;
      if (w > max) h.style.fontSize = `${Math.floor((120 * max) / w)}px`;
    }
  }

  // Shows a piece on the big model without re-mounting the grid.
  function showOnStage() {
    const id = shown();
    const name = $('#name');
    if (!name) return;
    name.textContent = title(id);
    $('#name2').textContent = title(id);
    fitName();
    const count = $('#count');
    if (count) count.textContent = `${String(CATALOG[S.cat].items.indexOf(id) + 1).padStart(2, '0')} / ${CATALOG[S.cat].items.length}`;
  }

  function crop() {
    return fitCover(SOURCE.w, SOURCE.h, 160, 256, S.focus, 0.5);
  }
  function paintSource() {
    const c = $('#src');
    if (!c) return;
    const { g, w, h } = F.fit(c);
    g.drawImage(A.sunset(S.frame), 0, 0, w, h);
    const r = crop(), win = $('#crop');
    const x0 = (r.x / SOURCE.w) * w, x1 = ((r.x + r.w) / SOURCE.w) * w;
    g.fillStyle = 'rgba(10,10,11,0.62)';
    g.fillRect(0, 0, x0, h);
    g.fillRect(x1, 0, w - x1, h);
    win.style.left = `${(r.x / SOURCE.w) * 100}%`;
    win.style.width = `${(r.w / SOURCE.w) * 100}%`;
  }

  function bind() {
    $$('[data-tab]').forEach((b) => (b.onclick = () => window.drip.tab(b.dataset.tab)));
    $$('[data-cat]').forEach((b) => (b.onclick = () => window.drip.wardrobe(b.dataset.cat)));
    $$('[data-side]').forEach((b) => (b.onclick = () => window.drip.side(b.dataset.side)));
    $$('.card').forEach((b) => {
      b.onmouseenter = () => window.drip.hover(b.dataset.id);
      b.onclick = () => window.drip.pick(b.dataset.id);
    });
    const grid = $('#grid');
    if (grid) grid.onmouseleave = () => window.drip.hover(null);
    const wear = $('#wear');
    if (wear) wear.onclick = () => window.drip.wear();
    const copy = $('#copy');
    if (copy) copy.onclick = () => { navigator.clipboard?.writeText(SQUAD.code); $('#copied').classList.add('on'); };
    const me = $('#me');
    if (me) me.onclick = () => window.drip.details();
    // Drag the model to turn it.
    const fig = $('#fig');
    if (fig) {
      fig.onpointerdown = (e) => {
        const x0 = e.clientX, d0 = S.drag;
        fig.setPointerCapture(e.pointerId);
        fig.onpointermove = (m) => { S.drag = d0 + (m.clientX - x0) * 0.6; };
        fig.onpointerup = () => { fig.onpointermove = null; };
      };
    }
  }

  // The stage ------------------------------------------------------------------------------
  function look() {
    if (S.tab === 'custom') {
      const picture = A.pictureCape(A.sunset(S.frame), crop(), `sunset${S.frame}`);
      return { skin: S.me, cape: { picture }, pet: 'fox' };
    }
    const l = { skin: S.me, ...S.pick };
    if (S.hover && S.cat !== 'emote') l[S.cat] = S.hover;
    return l;
  }

  function drawStage(t) {
    const c = $('#fig');
    if (!c) return;
    const { g, w, h } = F.fit(c);
    const time = S.still ? S.still.t : t;
    const base = S.side === 'front' ? 24 : 204;
    const yaw = (S.still ? S.still.yaw : base + 22 * Math.sin(t * 0.45)) + S.drag;
    if (S.tab === 'squad') {
      const cam = { dist: 120, pitch: 8, ppu: 7.8, cx: w / 2, cy: h * 0.45, target: 16 };
      const crew = [['mossy', [-21, 0, -9], yaw - 18], ['kai_builds', [21, 0, -11], yaw + 16], [S.me, [0, 0, 6], yaw]];
      F.shadow(g, cam, [0, -1.6, 0], 36);
      const items = [{ faces: F.turntable(30, 1.6) }];
      for (const [skin, pos, y] of crew) items.push({ faces: F.player({ skin, cape: SQUAD.cape }, {}, time + pos[0]), pos, yaw: y });
      F.render(g, items, cam);
      for (const [skin, pos] of crew) F.nameTag(g, cam, pos, skin, SQUAD.name, 11, 36);
      return;
    }
    const cam = { dist: 96, pitch: 7, ppu: 10.4, cx: w / 2, cy: h * 0.45, target: 16 };
    const emote = S.tab === 'wardrobe' && S.cat === 'emote' ? { emote: S.hover || S.emote, t: time } : {};
    F.shadow(g, cam, [0, -1.6, 0], 19);
    F.render(g, [{ faces: F.turntable() }, { faces: F.player(look(), emote, time), yaw }], cam);
  }

  const start = performance.now();
  (function loop(now) {
    const t = (now - start) / 1000;
    if (S.tab === 'custom' && S.dropped) {
      const frame = Math.floor(t / 0.09) % SOURCE.frames;
      if (frame !== S.frame) { S.frame = frame; paintSource(); }
    }
    drawStage(t);
    requestAnimationFrame(loop);
  })(start);

  // Driver --------------------------------------------------------------------------------
  window.drip = {
    tab(name) {
      S.tab = name;
      S.hover = null;
      S.drag = 0;
      mount();
      if (name === 'squad' || name === 'custom') S.side = 'back';
    },
    first(connected = false) {
      S.connected = connected;
      S.tab = 'first';
      mount();
      if (connected && window.__TAURI__) loadOwnSkin(S.me).catch(() => {});
    },
    wardrobe(cat = 'cape') {
      S.tab = 'wardrobe';
      S.cat = cat;
      S.hover = null;
      S.side = CATALOG[cat].side;
      if (cat !== 'emote' && !S.pick[cat]) S.pick = { ...S.pick, [cat]: CATALOG[cat].items[0] };
      mount();
    },
    // Pointing at a card tries it on at once; null puts the pick back.
    hover(id) {
      S.hover = id;
      $$('.card').forEach((c) => c.classList.toggle('hover', c.dataset.id === id));
      showOnStage();
    },
    pick(id) {
      if (S.cat === 'emote') S.emote = id;
      else S.pick = { ...S.pick, [S.cat]: id };
      $$('.card').forEach((c) => c.classList.toggle('on', c.dataset.id === id));
      const wear = $('#wear');
      if (wear) wear.outerHTML = wearButton(S.cat !== 'emote' && S.wearing[S.cat] === id, S.cat === 'emote' ? 'Try it' : 'Wear it');
      $('#wear').onclick = () => window.drip.wear();
      showOnStage();
    },
    async wear() {
      const b = $('#wear');
      b.classList.add('pressed');
      await sleep(160);
      if (S.cat !== 'emote') S.wearing = { ...S.pick };
      const grid = $('#grid'), top = grid ? grid.scrollTop : 0;
      mount();
      if ($('#grid')) $('#grid').scrollTop = top;
      this.toast(S.tab === 'custom' ? 'Wearing your cape. Everyone with Drip sees it.' : `Wearing ${title(current())}. Everyone with Drip sees it.`);
    },
    side(name) {
      S.side = name;
      S.drag = 0;
      $$('[data-side]').forEach((b) => b.classList.toggle('on', b.dataset.side === name));
    },
    press(sel) {
      const b = $(sel);
      b.classList.add('pressed');
      return sleep(160).then(() => b.classList.remove('pressed'));
    },
    toast(text) {
      $('#toast-text').textContent = text;
      $('#toast').classList.add('on');
    },
    hideToast() {
      $('#toast').classList.remove('on');
    },
    // Make your own: the drop zone lights up, then the picture lands on the cape.
    drop(hover = false) {
      S.tab = 'custom';
      S.side = 'back';
      S.dropped = !hover;
      mount();
      if (hover) $('#dropzone').classList.add('over');
    },
    empty() {
      S.tab = 'custom';
      S.dropped = false;
      mount();
    },
    focus(x) {
      S.focus = x;
      paintSource();
    },
    details(open = true) {
      const s = $('#sheet');
      if (s) s.remove();
      if (open && !s) $('.win').insertAdjacentHTML('beforeend', detailsSheet());
    },
    // Freezes the turntable at an angle (degrees) and moment, for stills.
    still(yaw, t = 0) {
      S.still = yaw == null ? null : { yaw, t };
    },
    // Turns a frozen turntable to another angle, easing in and out.
    spin(to, ms = 700) {
      const from = S.still ? S.still.yaw : 204, t0 = performance.now();
      return new Promise((done) => {
        (function step(now) {
          const k = Math.min(1, (now - t0) / ms), e = k < 0.5 ? 2 * k * k : 1 - Math.pow(-2 * k + 2, 2) / 2;
          S.still = { ...(S.still || { t: 0 }), yaw: from + (to - from) * e };
          if (k < 1) requestAnimationFrame(step); else done();
        })(t0);
      });
    },
    scroll(y) {
      const grid = $('#grid');
      if (grid) grid.scrollTop = y;
    },
    set(state) {
      Object.assign(S, state);
      mount();
    },
    icons: EMOTE_ICON,
    mark,
    CAPE_PATH,
    SQUAD,
  };

  mount();
})();
