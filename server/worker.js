// Drip's free server: one Cloudflare Worker, a D1 database, an R2 bucket for
// custom capes and one Durable Object class for emote rooms. It stores a
// player's id and name, what they wear and their squad. No passwords, no
// emails, no tracking. Anyone can run a mirror (see wrangler.toml).

const MAX_IDS = 100; // players per lookup
const LOOK_TTL = 300; // seconds a lookup is cached
const NONCE_TTL = 120_000; // ms to finish signing in
const TOKEN_TTL = 30 * 86_400_000; // ms a Drip session lasts
const MAX_BYTES = 512 * 1024;
const MAX_FRAMES = 32;
const REPORTS_TO_HIDE = 3;
const FOUNDER_UNTIL = Date.parse('2026-12-01T00:00:00Z'); // the first month
const CROCKFORD = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
const EMOTES = ['wave', 'dance', 'sit', 'point', 'clap', 'bow', 'facepalm', 'gg'];
const EMBLEMS = ['wolf', 'crown', 'flame', 'star', 'bolt', 'moon', 'wave', 'leaf', 'gem', 'eye', 'arrow', 'heart'];

const enc = new TextEncoder();
const json = (body, status = 200, headers = {}) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', ...headers } });
const hex = (bytes) => [...new Uint8Array(bytes)].map((b) => b.toString(16).padStart(2, '0')).join('');
const randomId = (n) => hex(crypto.getRandomValues(new Uint8Array(n)));

async function sign(env, text) {
  const key = await crypto.subtle.importKey('raw', enc.encode(env.SESSION_KEY), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return hex(await crypto.subtle.sign('HMAC', key, enc.encode(text))).slice(0, 32);
}

// Minecraft's serverId hash: SHA-1 read as a signed number, in hex. Same as
// drip_core::server_id_hash, which has the test vectors.
async function serverIdHash(text) {
  const d = new Uint8Array(await crypto.subtle.digest('SHA-1', enc.encode(text)));
  const negative = d[0] & 0x80;
  if (negative) {
    let carry = 1;
    for (let i = d.length - 1; i >= 0; i--) {
      const v = (~d[i] & 0xff) + carry;
      d[i] = v & 0xff;
      carry = v >> 8;
    }
  }
  const h = hex(d).replace(/^0+/, '') || '0';
  return negative ? `-${h}` : h;
}

// 1. The game asks for a nonce. It's signed, so nothing is stored.
async function hello(env) {
  const body = `${Date.now()}.${randomId(8)}`;
  return json({ nonce: `${body}.${await sign(env, body)}` });
}

// 2. The game joined the session server with serverIdHash(nonce). We ask the
//    session server whether it did, exactly as a Minecraft server would.
async function verify(req, env) {
  const { name, nonce } = await req.json();
  const [ts, rand, sig] = String(nonce).split('.');
  if (!/^\w{3,16}$/.test(name) || sig !== (await sign(env, `${ts}.${rand}`)) || Date.now() - +ts > NONCE_TTL) {
    return json({ error: 'sign-in expired, try again' }, 400);
  }
  const q = new URLSearchParams({ username: name, serverId: await serverIdHash(nonce) });
  const res = await fetch(`https://sessionserver.mojang.com/session/minecraft/hasJoined?${q}`);
  if (res.status !== 200) return json({ error: 'the session server did not confirm you' }, 401);
  const profile = await res.json();
  const now = Date.now();
  await env.DB.prepare(
    `INSERT INTO players (id, name, founder, first_seen) VALUES (?1, ?2, ?3, ?4)
     ON CONFLICT (id) DO UPDATE SET name = excluded.name`,
  ).bind(profile.id, profile.name, now < FOUNDER_UNTIL ? 1 : 0, now).run();
  const body = `${profile.id}.${now + TOKEN_TTL}`;
  return json({ token: `${body}.${await sign(env, body)}`, id: profile.id, name: profile.name });
}

async function who(req, env) {
  const auth = req.headers.get('authorization') || '';
  const token = auth.startsWith('Bearer ') ? auth.slice(7) : new URL(req.url).searchParams.get('token');
  const [id, exp, sig] = String(token).split('.');
  if (!id || Date.now() > +exp || sig !== (await sign(env, `${id}.${exp}`))) return null;
  return { id };
}

// What up to 100 players wear, in one cached request.
async function look(url, env, ctx) {
  const ids = [...new Set((url.searchParams.get('ids') || '').split(','))].filter((id) => /^[0-9a-f]{32}$/.test(id));
  if (!ids.length || ids.length > MAX_IDS) return json({ error: `ask for 1 to ${MAX_IDS} players` }, 400);
  const cache = caches.default;
  const hit = await cache.match(url.toString());
  if (hit) return hit;
  const { results } = await env.DB.prepare(
    `SELECT p.id, w.cape, w.wings, w.hat, w.pet, s.name AS squad, c.hidden
       FROM players p
       LEFT JOIN wearing w ON w.player_id = p.id
       LEFT JOIN squads s ON s.code = p.squad
       LEFT JOIN capes c ON w.cape = 'u/' || c.id
      WHERE p.id IN (${ids.map(() => '?').join(',')})`,
  ).bind(...ids).all();
  const out = {};
  for (const r of results) {
    out[r.id] = { cape: r.hidden ? null : r.cape, wings: r.wings, hat: r.hat, pet: r.pet, squad: r.squad };
  }
  const res = json(out, 200, { 'cache-control': `public, max-age=${LOOK_TTL}` });
  ctx.waitUntil(cache.put(url.toString(), res.clone()));
  return res;
}

async function wear(req, env, me) {
  const b = await req.json();
  const pick = (v) => (typeof v === 'string' && /^[a-z0-9/-]{1,40}$/i.test(v) ? v : null);
  await env.DB.prepare(
    `INSERT INTO wearing (player_id, cape, wings, hat, pet, updated_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6)
     ON CONFLICT (player_id) DO UPDATE SET cape = ?2, wings = ?3, hat = ?4, pet = ?5, updated_at = ?6`,
  ).bind(me.id, pick(b.cape), pick(b.wings), pick(b.hat), pick(b.pet), Date.now()).run();
  return json({ ok: true });
}

// Squad codes, as drip_core makes and reads them: WOLF-7Q2K.
const tag = (s) => (String(s).toUpperCase().replace(/[^A-Z]/g, '').slice(0, 4) + 'XXXX').slice(0, 4);
function normalizeCode(input) {
  const c = String(input).toUpperCase().replace(/[\s-]/g, '');
  if (c.length !== 8 || !/^[A-Z]{4}$/.test(c.slice(0, 4))) return null;
  const tail = c.slice(4).replace(/[IL]/g, '1').replace(/O/g, '0');
  return [...tail].every((ch) => CROCKFORD.includes(ch)) ? `${c.slice(0, 4)}-${tail}` : null;
}

async function makeSquad(req, env, me) {
  const b = await req.json();
  const name = String(b.name || '').trim().slice(0, 24);
  const colour = /^#[0-9a-f]{6}$/i;
  if (!name || !EMBLEMS.includes(b.emblem) || !colour.test(b.colorA) || !colour.test(b.colorB)) {
    return json({ error: 'a squad needs a name, an emblem and two colours' }, 400);
  }
  const n = crypto.getRandomValues(new Uint32Array(1))[0];
  const code = `${tag(b.tag || name)}-${[15, 10, 5, 0].map((s) => CROCKFORD[(n >> s) & 31]).join('')}`;
  await env.DB.batch([
    env.DB.prepare('INSERT INTO squads (code, name, emblem, color_a, color_b, owner, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)')
      .bind(code, name, b.emblem, b.colorA, b.colorB, me.id, Date.now()),
    env.DB.prepare('UPDATE players SET squad = ? WHERE id = ?').bind(code, me.id),
  ]);
  return json({ code });
}

async function joinSquad(req, env, me) {
  const code = normalizeCode((await req.json()).code);
  const squad = code && (await env.DB.prepare('SELECT name FROM squads WHERE code = ?').bind(code).first());
  if (!squad) return json({ error: 'no squad has that code' }, 404);
  await env.DB.prepare('UPDATE players SET squad = ? WHERE id = ?').bind(code, me.id).run();
  return json({ code, name: squad.name });
}

// GIF frames, counted by walking the blocks (drip_core::gif_frames).
function gifFrames(b) {
  let i = 13 + (b[10] & 0x80 ? 3 << ((b[10] & 7) + 1) : 0);
  let frames = 0;
  const skip = (j) => { while (j < b.length && b[j]) j += b[j] + 1; return j + 1; };
  while (i < b.length) {
    if (b[i] === 0x3b) return frames;
    if (b[i] === 0x21) i = skip(i + 2);
    else if (b[i] === 0x2c) {
      const local = b[i + 9];
      i = skip(i + 10 + (local & 0x80 ? 3 << ((local & 7) + 1) : 0) + 1);
      frames++;
    } else return -1;
  }
  return -1;
}

async function upload(req, env, me) {
  const b = new Uint8Array(await req.arrayBuffer());
  if (b.length > MAX_BYTES) return json({ error: 'capes take up to 512 KB' }, 413);
  const format = b[0] === 0x89 && b[1] === 0x50 ? 'png' : b[0] === 0xff && b[1] === 0xd8 ? 'jpeg' : b[0] === 0x47 && b[1] === 0x49 ? 'gif' : null;
  if (!format) return json({ error: 'send a PNG, JPG or GIF' }, 415);
  const frames = format === 'gif' ? gifFrames(b) : 1;
  if (frames < 1 || frames > MAX_FRAMES) return json({ error: `GIF capes take 1 to ${MAX_FRAMES} frames` }, 400);
  const id = randomId(6);
  await env.CAPES.put(`capes/${id}`, b, { httpMetadata: { contentType: `image/${format}` } });
  await env.DB.batch([
    env.DB.prepare('INSERT INTO capes (id, owner, format, frames, bytes, created_at) VALUES (?, ?, ?, ?, ?, ?)')
      .bind(id, me.id, format, frames, b.length, Date.now()),
    env.DB.prepare(`INSERT INTO wearing (player_id, cape, updated_at) VALUES (?1, ?2, ?3)
                    ON CONFLICT (player_id) DO UPDATE SET cape = ?2, updated_at = ?3`).bind(me.id, `u/${id}`, Date.now()),
  ]);
  return json({ id, frames });
}

async function capeImage(id, env) {
  const row = await env.DB.prepare('SELECT hidden FROM capes WHERE id = ?').bind(id).first();
  const obj = row && !row.hidden && (await env.CAPES.get(`capes/${id}`));
  if (!obj) return json({ error: 'not found' }, 404);
  return new Response(obj.body, { headers: { 'content-type': obj.httpMetadata.contentType, 'cache-control': 'public, max-age=86400' } });
}

// Every catalog cape in one atlas (catalog/capes.png), fetched once by each game.
async function catalogCapes(env) {
  const obj = await env.CAPES.get('catalog/capes.png');
  if (!obj) return json({ error: 'not found' }, 404);
  return new Response(obj.body, { headers: { 'content-type': 'image/png', 'cache-control': 'public, max-age=86400' } });
}

// Three different players hide a custom cape for everyone until a volunteer looks at it.
async function report(env, me, id) {
  await env.DB.prepare('INSERT OR IGNORE INTO reports (cape_id, reporter, created_at) VALUES (?, ?, ?)').bind(id, me.id, Date.now()).run();
  const { n } = await env.DB.prepare('SELECT COUNT(DISTINCT reporter) AS n FROM reports WHERE cape_id = ?').bind(id).first();
  if (n >= REPORTS_TO_HIDE) await env.DB.prepare('UPDATE capes SET hidden = 1 WHERE id = ?').bind(id).run();
  return json({ hidden: n >= REPORTS_TO_HIDE });
}

export default {
  async fetch(req, env, ctx) {
    const url = new URL(req.url);
    const route = `${req.method} ${url.pathname}`;
    if (route === 'POST /v1/hello') return hello(env);
    if (route === 'POST /v1/verify') return verify(req, env);
    if (route === 'GET /v1/look') return look(url, env, ctx);
    if (route === 'GET /v1/catalog/capes.png') return catalogCapes(env);
    const cape = url.pathname.match(/^\/v1\/capes\/([0-9a-f]{12})(\/report)?$/);
    if (cape && !cape[2] && req.method === 'GET') return capeImage(cape[1], env);

    const me = await who(req, env);
    if (!me) return json({ error: 'open Horizon with the Drip mod once to sign in' }, 401);
    const room = url.pathname.match(/^\/v1\/room\/([0-9a-f]{16})$/);
    if (room && req.headers.get('upgrade') === 'websocket') {
      const fwd = new URL(req.url);
      fwd.searchParams.set('player', me.id);
      return env.ROOMS.get(env.ROOMS.idFromName(room[1])).fetch(new Request(fwd, req));
    }
    if (route === 'PUT /v1/wear') return wear(req, env, me);
    if (route === 'POST /v1/squads') return makeSquad(req, env, me);
    if (route === 'POST /v1/squads/join') return joinSquad(req, env, me);
    if (route === 'POST /v1/capes') return upload(req, env, me);
    if (cape && cape[2] && req.method === 'POST') return report(env, me, cape[1]);
    return json({ error: 'not found' }, 404);
  },
};

// One room per server address (by hash). An emote goes to everyone else in
// the room as "<player id> <emote>". Hibernation keeps idle rooms free.
export class EmoteRoom {
  constructor(ctx) {
    this.ctx = ctx;
  }

  async fetch(req) {
    const [client, server] = Object.values(new WebSocketPair());
    this.ctx.acceptWebSocket(server);
    server.serializeAttachment({ id: new URL(req.url).searchParams.get('player') });
    return new Response(null, { status: 101, webSocket: client });
  }

  webSocketMessage(ws, msg) {
    if (!EMOTES.includes(String(msg))) return;
    const { id } = ws.deserializeAttachment();
    for (const other of this.ctx.getWebSockets()) if (other !== ws) other.send(`${id} ${msg}`);
  }

  webSocketClose(ws, code) {
    ws.close(code);
  }
}
