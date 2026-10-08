//! Emotes. Hold B for the wheel and release on one. Your game tells the Drip
//! server, which passes it to the other Drip players on the same server
//! address. Nothing goes to the Minecraft server. If the Drip server is down,
//! capes still show from cache and emotes just don't reach anyone.

use std::collections::HashMap;
use std::sync::{Mutex, OnceLock};
use std::time::{Duration, Instant};

use sha1::{Digest, Sha1};

/// Clockwise from the top, as the wheel draws them.
pub const EMOTES: [&str; 8] = ["wave", "dance", "sit", "point", "clap", "bow", "facepalm", "gg"];
const PLAY_FOR: Duration = Duration::from_millis(2600);
const DEAD_ZONE: f32 = 24.0;

/// Arm angles in degrees (x, y, z) for the model layer.
pub struct Pose {
    pub left: [f32; 3],
    pub right: [f32; 3],
}

#[derive(Default)]
struct Emotes {
    open: bool,
    pick: Option<usize>,
    room: Option<String>,
    playing: HashMap<String, (usize, Instant)>,
}

fn emotes() -> &'static Mutex<Emotes> {
    static E: OnceLock<Mutex<Emotes>> = OnceLock::new();
    E.get_or_init(Default::default)
}

/// Players meet in a room named by a hash of the server address, so the Drip
/// server never learns where anyone plays.
fn room_for(address: &str) -> String {
    let d = Sha1::digest(address.trim().to_ascii_lowercase().as_bytes());
    d.iter().take(8).map(|b| format!("{b:02x}")).collect()
}

/// The slice under the pointer: 0 at the top, counting clockwise.
fn sector(dx: f32, dy: f32) -> Option<usize> {
    if dx * dx + dy * dy < DEAD_ZONE * DEAD_ZONE {
        return None;
    }
    let turn = dx.atan2(-dy).to_degrees().rem_euclid(360.0);
    Some(((turn + 22.5) / 45.0) as usize % 8)
}

/// HUD hook: the wheel while B is held, the emote on release.
pub fn drip_wheel(game: &mut crate::game::Game<'_>) {
    let mut e = emotes().lock().unwrap();
    let address = game.native_server_address(); // verify: None in single player
    let room = address.as_deref().map(room_for);
    if e.room != room {
        e.room = room.clone();
        if let Some(r) = room {
            listen(r);
        }
    }

    if game.native_key_down(crate::input::Key::B) { // verify
        e.open = true;
        let (dx, dy) = game.native_pointer_from_centre(); // verify
        e.pick = sector(dx, dy).or(e.pick);
        draw_wheel(game, e.pick);
    } else if e.open {
        e.open = false;
        if let (Some(i), Some(me)) = (e.pick.take(), game.native_player()) {
            e.playing.insert(me.uuid.simple().to_string(), (i, Instant::now()));
            if let Some(r) = e.room.clone() {
                crate::net::websocket_send(&format!("/v1/room/{r}"), EMOTES[i]); // verify
            }
        }
    }
}

/// Other players' emotes, as the Drip server passes them on: "<player id> <emote>".
fn listen(room: String) {
    std::thread::spawn(move || {
        let _ = crate::net::websocket_listen(&format!("/v1/room/{room}"), |msg: &str| { // verify
            let Some((id, name)) = msg.split_once(' ') else { return };
            if let Some(i) = EMOTES.iter().position(|e| *e == name) {
                emotes().lock().unwrap().playing.insert(id.to_string(), (i, Instant::now()));
            }
        });
    });
}

fn draw_wheel(game: &mut crate::game::Game<'_>, pick: Option<usize>) {
    let (cx, cy) = game.native_gui_centre(); // verify
    for (i, name) in EMOTES.iter().enumerate() {
        let a = (i as f32 * 45.0).to_radians();
        let (x, y) = (cx + 74.0 * a.sin(), cy - 74.0 * a.cos());
        let fill = if pick == Some(i) { 0xE63B6CFF } else { 0xC8141416 };
        game.native_fill_round(x - 30.0, y - 14.0, 60.0, 28.0, 14.0, fill); // verify
        game.native_text(&label(name), x, y - 4.0, 0xFFF5F5F7, true); // verify: centred
    }
}

fn label(name: &str) -> String {
    match name {
        "gg" => "GG".into(),
        n => n[..1].to_uppercase() + &n[1..],
    }
}

/// The arm pose of an emote someone is playing, for the model layer.
pub fn pose(player: &str) -> Option<Pose> {
    let mut e = emotes().lock().unwrap();
    let (i, at) = *e.playing.get(player)?;
    let t = at.elapsed();
    if t > PLAY_FOR {
        e.playing.remove(player);
        return None;
    }
    let s = (t.as_secs_f32() * 9.0).sin();
    let rest = [0.0, 0.0, 0.0];
    Some(match EMOTES[i] {
        "wave" => Pose { left: rest, right: [0.0, 0.0, 150.0 + 18.0 * s] },
        "dance" => Pose { left: [40.0 * s, 0.0, -30.0], right: [-40.0 * s, 0.0, 30.0] },
        "sit" => Pose { left: [-20.0, 0.0, 0.0], right: [-20.0, 0.0, 0.0] },
        "point" => Pose { left: rest, right: [-90.0, 0.0, 0.0] },
        "clap" => Pose { left: [-70.0, 20.0 + 14.0 * s, 0.0], right: [-70.0, -20.0 - 14.0 * s, 0.0] },
        "bow" => Pose { left: [-30.0, 0.0, 0.0], right: [-30.0, 0.0, 0.0] },
        "facepalm" => Pose { left: rest, right: [-150.0, 30.0, 0.0] },
        _ => Pose { left: [0.0, 0.0, -160.0 - 10.0 * s], right: [0.0, 0.0, 160.0 + 10.0 * s] },
    })
}

/// A slow wing beat, the same for everyone.
pub fn flap() -> f32 {
    static START: OnceLock<Instant> = OnceLock::new();
    let t = START.get_or_init(Instant::now).elapsed().as_secs_f32();
    12.0 + 8.0 * (t * 1.6).sin()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn wheel_slices() {
        assert_eq!(sector(0.0, -80.0), Some(0)); // up: wave
        assert_eq!(sector(80.0, 0.0), Some(2)); // right: sit
        assert_eq!(sector(0.0, 80.0), Some(4)); // down: clap
        assert_eq!(sector(-60.0, -60.0), Some(7)); // up-left: GG
        assert_eq!(sector(5.0, 5.0), None);
    }
}
