//! What Drip players wear, drawn on top of their models. It all happens on your
//! screen: the Minecraft server never sees a cosmetic, so it works on any
//! 26.3 server and gives nobody an advantage. Players without Drip see normal skins.
//!
//! Game calls marked `// verify` aren't in Horizon's named hook catalog;
//! check them against the pinned revision.

use std::collections::HashMap;
use std::sync::{Mutex, OnceLock};
use std::time::{Duration, Instant};

use sha1::{Digest, Sha1};

/// One lookup asks for up to 100 players, and an answer is kept for 5 minutes,
/// so a whole evening on a busy server costs the Drip server a few requests.
const BATCH: usize = 100;
const KEEP: Duration = Duration::from_secs(300);

#[derive(Clone, Default)]
pub struct Look {
    pub cape: Option<String>,   // catalog id, or "u/<id>" for a custom cape
    pub wings: Option<String>,
    pub hat: Option<String>,
    pub pet: Option<String>,
    pub squad: Option<String>,  // shown under the name tag
}

#[derive(Default)]
struct State {
    servers: Vec<String>,
    token: Option<String>,
    signing_in: bool,
    looks: HashMap<String, (Look, Instant)>,
    wanted: Vec<String>,
    asking: bool,
    hide_all: bool,
    custom_from: CustomFrom,
}

/// "Show custom capes from", set in the app.
#[derive(Default, Clone, Copy, PartialEq)]
enum CustomFrom {
    #[default]
    Everyone,
    FriendsAndSquad,
    Nobody,
}

fn state() -> &'static Mutex<State> {
    static S: OnceLock<Mutex<State>> = OnceLock::new();
    S.get_or_init(|| Mutex::new(read_config()))
}

/// `config/drip.toml`, written by the Drip app. Anyone can run a mirror, so the
/// servers are a list; the first one that answers is used.
fn read_config() -> State {
    let path = crate::game::Game::native_config_dir().join("drip.toml");
    let text = std::fs::read_to_string(path).unwrap_or_default();
    let mut s = State { servers: vec!["https://drip.SparrowPortray.workers.dev".into()], ..State::default() };
    for line in text.lines().map(str::trim) {
        if let Some(list) = line.strip_prefix("servers = [") {
            s.servers = list.trim_end_matches(']').split(',').map(|v| v.trim().trim_matches('"').to_string()).filter(|v| !v.is_empty()).collect();
        } else if line == "hide_all = true" {
            s.hide_all = true;
        } else if line == "custom_capes = \"friends\"" {
            s.custom_from = CustomFrom::FriendsAndSquad;
        } else if line == "custom_capes = \"nobody\"" {
            s.custom_from = CustomFrom::Nobody;
        }
    }
    s
}

/// The `serverId` of Minecraft's session join, the same function as
/// `drip_core::server_id_hash` (tested there).
fn server_id_hash(input: &str) -> String {
    let mut d: [u8; 20] = Sha1::digest(input.as_bytes()).into();
    let negative = d[0] & 0x80 != 0;
    if negative {
        let mut carry = true;
        for b in d.iter_mut().rev() {
            *b = !*b;
            if carry {
                (*b, carry) = b.overflowing_add(1);
            }
        }
    }
    let hex: String = d.iter().map(|b| format!("{b:02x}")).collect();
    let body = match hex.trim_start_matches('0') { "" => "0", h => h };
    if negative { format!("-{body}") } else { body.to_string() }
}

/// HTTPS through the game's own client, the one that fetches skins.
fn fetch(method: &str, url: &str, body: &str, token: Option<&str>) -> Option<serde_json::Value> {
    let text = crate::net::https_request(method, url, body, token).ok()?; // verify
    serde_json::from_str(&text).ok()
}

/// No password: the game proves who you are the way it does to any server.
/// It joins the session server with a hash of our nonce, and the Drip server
/// asks the session server whether you did. Your login token never leaves the game.
fn sign_in(servers: Vec<String>, name: String) {
    let token = servers.iter().find_map(|server| {
        let nonce = fetch("POST", &format!("{server}/v1/hello"), "", None)?["nonce"].as_str()?.to_string();
        crate::auth::join_session(&server_id_hash(&nonce)).ok()?; // verify: auth.rs, the online-mode join
        let body = serde_json::json!({ "name": name, "nonce": nonce }).to_string();
        Some(fetch("POST", &format!("{server}/v1/verify"), &body, None)?["token"].as_str()?.to_string())
    });
    let mut s = state().lock().unwrap();
    s.signing_in = false;
    s.token = token;
}

fn look_up(servers: Vec<String>, ids: Vec<String>) {
    let found = servers.iter().find_map(|server| fetch("GET", &format!("{server}/v1/look?ids={}", ids.join(",")), "", None));
    let mut s = state().lock().unwrap();
    s.asking = false;
    let now = Instant::now();
    for id in ids {
        let v = found.as_ref().and_then(|f| f.get(&id));
        let pick = |k: &str| v.and_then(|v| v[k].as_str()).map(String::from);
        let look = Look { cape: pick("cape"), wings: pick("wings"), hat: pick("hat"), pet: pick("pet"), squad: pick("squad") };
        s.looks.insert(id, (look, now));
    }
}

/// Frame hook: sign in once, then send the players we've met in one batch.
pub fn drip_frame(game: &mut crate::game::Game<'_>) {
    let mut s = state().lock().unwrap();
    if s.token.is_none() && !s.signing_in {
        if let Some(me) = game.native_player() {
            s.signing_in = true;
            let (servers, name) = (s.servers.clone(), me.name.clone());
            std::thread::spawn(move || sign_in(servers, name));
        }
    }
    if !s.asking && !s.wanted.is_empty() {
        s.asking = true;
        let ids: Vec<String> = s.wanted.drain(..s.wanted.len().min(BATCH)).collect();
        let servers = s.servers.clone();
        std::thread::spawn(move || look_up(servers, ids));
    }
}

/// Layer hook, after a player's model: cape, wings, hat, pet and emote pose.
pub fn drip_layers(player: &crate::render::entity::player::PlayerRenderState, draw: &mut crate::render::entity::ModelDraw<'_>) {
    let mut s = state().lock().unwrap();
    if s.hide_all {
        return;
    }
    let id = player.uuid.simple().to_string(); // verify: 32 hex digits, as the session server writes it
    let fresh = s.looks.get(&id).filter(|(_, at)| at.elapsed() < KEEP).map(|(l, _)| l.clone());
    let Some(look) = fresh else {
        if !s.wanted.contains(&id) {
            s.wanted.push(id);
        }
        return;
    };
    let custom_ok = match s.custom_from {
        CustomFrom::Everyone => true,
        CustomFrom::FriendsAndSquad => player.is_friend || look.squad.is_some(), // verify
        CustomFrom::Nobody => false,
    };
    drop(s);

    // Catalog capes come from one atlas (catalog/capes.png, Minecraft's cape
    // layout at 2x), fetched from the Drip server once and kept in config/drip/.
    if let Some(cape) = look.cape.as_deref().filter(|c| custom_ok || !c.starts_with("u/")) {
        // 10 x 16 x 1 on the back, swinging back as the player walks.
        let swing = 6.0 + 24.0 * player.walk_speed.min(1.0); // verify
        draw.textured_box("drip", &format!("capes/{cape}"), [-5.0, 8.0, -3.0], [10.0, 16.0, 1.0], swing); // verify
    }
    if let Some(wings) = &look.wings {
        // emotes.rs is compiled in beside this helper.
        draw.wings("drip", &format!("wings/{wings}"), crate::emotes::flap()); // verify
    }
    if let Some(hat) = &look.hat {
        draw.on_head("drip", &format!("hats/{hat}")); // verify
    }
    if let Some(pet) = &look.pet {
        draw.on_shoulder("drip", &format!("pets/{pet}"), -1); // verify: left shoulder
    }
    if let Some(pose) = crate::emotes::pose(&id) {
        draw.pose_arms(pose.left, pose.right); // verify
    }
    if let Some(squad) = &look.squad {
        draw.name_tag_line(squad); // verify: the line under the name tag
    }
}
