//! The parts of Drip that have to be exactly right: the sign-in hash the game
//! and the server agree on, squad codes, fitting a picture to a cape, upload
//! limits, the catalog and the report rule. No dependencies.

use std::collections::HashSet;
use std::fmt;
use std::hash::Hash;

// Sign-in ------------------------------------------------------------------

/// SHA-1, as the session server uses it. Small and by the book (FIPS 180-4).
pub fn sha1(data: &[u8]) -> [u8; 20] {
    let mut h: [u32; 5] = [
        0x6745_2301,
        0xEFCD_AB89,
        0x98BA_DCFE,
        0x1032_5476,
        0xC3D2_E1F0,
    ];
    let mut msg = data.to_vec();
    msg.push(0x80);
    while msg.len() % 64 != 56 {
        msg.push(0);
    }
    msg.extend_from_slice(&((data.len() as u64).wrapping_mul(8)).to_be_bytes());

    for block in msg.chunks_exact(64) {
        let mut w = [0u32; 80];
        for (i, word) in block.chunks_exact(4).enumerate() {
            w[i] = u32::from_be_bytes([word[0], word[1], word[2], word[3]]);
        }
        for i in 16..80 {
            w[i] = (w[i - 3] ^ w[i - 8] ^ w[i - 14] ^ w[i - 16]).rotate_left(1);
        }
        let [mut a, mut b, mut c, mut d, mut e] = h;
        for (i, wi) in w.iter().enumerate() {
            let (f, k) = match i {
                0..=19 => ((b & c) | (!b & d), 0x5A82_7999),
                20..=39 => (b ^ c ^ d, 0x6ED9_EBA1),
                40..=59 => ((b & c) | (b & d) | (c & d), 0x8F1B_BCDC),
                _ => (b ^ c ^ d, 0xCA62_C1D6),
            };
            let t = a
                .rotate_left(5)
                .wrapping_add(f)
                .wrapping_add(e)
                .wrapping_add(k)
                .wrapping_add(*wi);
            e = d;
            d = c;
            c = b.rotate_left(30);
            b = a;
            a = t;
        }
        for (x, y) in h.iter_mut().zip([a, b, c, d, e]) {
            *x = x.wrapping_add(y);
        }
    }

    let mut out = [0u8; 20];
    for (i, word) in h.iter().enumerate() {
        out[i * 4..i * 4 + 4].copy_from_slice(&word.to_be_bytes());
    }
    out
}

/// The `serverId` hash of Minecraft's session join: the SHA-1 digest read as a
/// signed (two's complement) big number and written in hex, with a leading
/// `-` when negative and no leading zeros.
///
/// The mod passes `server_id_hash(nonce)` to `session/minecraft/join`, and the
/// Drip server passes the same value to `hasJoined`. The login token never
/// leaves the game.
pub fn server_id_hash(input: &str) -> String {
    let mut digest = sha1(input.as_bytes());
    let negative = digest[0] & 0x80 != 0;
    if negative {
        // Two's complement: flip every bit, then add one.
        let mut carry = true;
        for byte in digest.iter_mut().rev() {
            *byte = !*byte;
            if carry {
                let (v, overflow) = byte.overflowing_add(1);
                *byte = v;
                carry = overflow;
            }
        }
    }
    let hex: String = digest.iter().map(|b| format!("{b:02x}")).collect();
    let trimmed = hex.trim_start_matches('0');
    let body = if trimmed.is_empty() { "0" } else { trimmed };
    if negative {
        format!("-{body}")
    } else {
        body.to_string()
    }
}

// Squad codes --------------------------------------------------------------

/// Crockford's base32: no I, L, O or U, so a code read aloud can't be misheard.
pub const CROCKFORD: &[u8; 32] = b"0123456789ABCDEFGHJKMNPQRSTVWXYZ";

/// The four letters in front of a squad code: the first four letters A to Z of
/// the squad's tag (its name, unless the maker typed a shorter word), padded with X.
pub fn squad_tag(name: &str) -> String {
    let mut tag: String = name
        .chars()
        .filter(|c| c.is_ascii_alphabetic())
        .map(|c| c.to_ascii_uppercase())
        .take(4)
        .collect();
    while tag.len() < 4 {
        tag.push('X');
    }
    tag
}

/// A squad code such as `WOLF-7Q2K`: the tag, a dash, then 20 bits of `n` in
/// four Crockford characters.
pub fn squad_code(tag_source: &str, n: u32) -> String {
    let n = n & 0xF_FFFF;
    let tail: String = (0..4)
        .rev()
        .map(|i| CROCKFORD[((n >> (i * 5)) & 31) as usize] as char)
        .collect();
    format!("{}-{tail}", squad_tag(tag_source))
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum CodeError {
    /// A code has 4 letters and 4 characters after them.
    Length(usize),
    /// The first four must be letters A to Z.
    Tag,
    /// A character that isn't in a code, even after I and L become 1 and O becomes 0.
    Char(char),
}

impl fmt::Display for CodeError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            CodeError::Length(n) => write!(f, "a squad code has 8 characters, this has {n}"),
            CodeError::Tag => write!(f, "a squad code starts with 4 letters"),
            CodeError::Char(c) => write!(f, "'{c}' isn't in squad codes"),
        }
    }
}

/// Reads a code the way people type it: any case, spaces or a dash or neither,
/// and I, L or O where 1 or 0 was meant. `"wolf 7q2k"` gives `WOLF-7Q2K`.
pub fn normalize_code(input: &str) -> Result<String, CodeError> {
    let chars: Vec<char> = input
        .chars()
        .filter(|c| !c.is_whitespace() && *c != '-')
        .map(|c| c.to_ascii_uppercase())
        .collect();
    if chars.len() != 8 {
        return Err(CodeError::Length(chars.len()));
    }
    if !chars[..4].iter().all(|c| c.is_ascii_uppercase()) {
        return Err(CodeError::Tag);
    }
    let mut tail = String::with_capacity(4);
    for &c in &chars[4..] {
        let c = match c {
            'I' | 'L' => '1',
            'O' => '0',
            c => c,
        };
        if !c.is_ascii() || !CROCKFORD.contains(&(c as u8)) {
            return Err(CodeError::Char(c));
        }
        tail.push(c);
    }
    let tag: String = chars[..4].iter().collect();
    Ok(format!("{tag}-{tail}"))
}

// Your own cape --------------------------------------------------------------

/// A cape's outer face is 10 by 16. Drip draws it at 160 by 256.
pub const CAPE_W: u32 = 160;
pub const CAPE_H: u32 = 256;
/// The largest picture or GIF Drip takes.
pub const MAX_UPLOAD_BYTES: usize = 512 * 1024;
/// GIFs become animated capes of up to this many frames.
pub const MAX_FRAMES: u32 = 32;

/// A part of the source picture, in its own pixels.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct CropRect {
    pub x: u32,
    pub y: u32,
    pub w: u32,
    pub h: u32,
}

/// Fills a `dst_w` by `dst_h` face with the picture, cropping what doesn't fit.
/// `focus` is the point of the picture to keep in the middle (0 to 1 on each
/// axis); dragging the crop moves it. The crop never leaves the picture.
/// An empty picture or face gives an empty rectangle.
pub fn fit_cover(src_w: u32, src_h: u32, dst_w: u32, dst_h: u32, focus: (f32, f32)) -> CropRect {
    if src_w == 0 || src_h == 0 || dst_w == 0 || dst_h == 0 {
        return CropRect {
            x: 0,
            y: 0,
            w: 0,
            h: 0,
        };
    }
    let (sw, sh, dw, dh) = (src_w as f64, src_h as f64, dst_w as f64, dst_h as f64);
    let (w, h) = if sw * dh > sh * dw {
        (((sh * dw / dh).round() as u32).clamp(1, src_w), src_h)
    } else {
        (src_w, ((sw * dh / dw).round() as u32).clamp(1, src_h))
    };
    let place = |size: u32, crop: u32, f: f32| -> u32 {
        let centre = f.clamp(0.0, 1.0) as f64 * size as f64;
        (centre - crop as f64 / 2.0)
            .round()
            .clamp(0.0, (size - crop) as f64) as u32
    };
    CropRect {
        x: place(src_w, w, focus.0),
        y: place(src_h, h, focus.1),
        w,
        h,
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ImageKind {
    Png,
    Jpeg,
    Gif,
}

/// What a file is, from its first bytes rather than its name.
pub fn sniff(bytes: &[u8]) -> Option<ImageKind> {
    if bytes.starts_with(b"\x89PNG\r\n\x1a\n") {
        Some(ImageKind::Png)
    } else if bytes.starts_with(&[0xFF, 0xD8, 0xFF]) {
        Some(ImageKind::Jpeg)
    } else if bytes.starts_with(b"GIF87a") || bytes.starts_with(b"GIF89a") {
        Some(ImageKind::Gif)
    } else {
        None
    }
}

/// Counts the frames of a GIF by walking its blocks. `None` if it's cut short.
pub fn gif_frames(bytes: &[u8]) -> Option<u32> {
    let byte = |i: usize| bytes.get(i).copied();
    // Skips data sub-blocks starting at `i`, returning the index after the terminator.
    let skip_blocks = |mut i: usize| -> Option<usize> {
        loop {
            let len = byte(i)? as usize;
            i += 1 + len;
            if len == 0 {
                return Some(i);
            }
        }
    };
    let flags = byte(10)?;
    let mut i = 13;
    if flags & 0x80 != 0 {
        i += 3 << ((flags & 7) + 1);
    }
    let mut frames = 0;
    loop {
        match byte(i)? {
            0x2C => {
                let local = byte(i + 9)?;
                i += 10;
                if local & 0x80 != 0 {
                    i += 3 << ((local & 7) + 1);
                }
                i = skip_blocks(i + 1)?; // after the LZW code size
                frames += 1;
            }
            0x21 => i = skip_blocks(i + 2)?,
            0x3B => return Some(frames),
            _ => return None,
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum UploadError {
    TooBig { bytes: usize },
    NotAPicture,
    BrokenGif,
    TooManyFrames { frames: u32 },
}

impl fmt::Display for UploadError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            UploadError::TooBig { bytes } => write!(
                f,
                "{} KB is too big. Capes take up to 512 KB.",
                bytes.div_ceil(1024)
            ),
            UploadError::NotAPicture => write!(f, "That isn't a PNG, JPG or GIF."),
            UploadError::BrokenGif => write!(f, "That GIF can't be read."),
            UploadError::TooManyFrames { frames } => {
                write!(f, "That GIF has {frames} frames. Capes take up to 32.")
            }
        }
    }
}

/// The checks the app runs before an upload, and the server runs again after.
pub fn check_upload(bytes: &[u8]) -> Result<ImageKind, UploadError> {
    if bytes.len() > MAX_UPLOAD_BYTES {
        return Err(UploadError::TooBig { bytes: bytes.len() });
    }
    let kind = sniff(bytes).ok_or(UploadError::NotAPicture)?;
    if kind == ImageKind::Gif {
        let frames = gif_frames(bytes).ok_or(UploadError::BrokenGif)?;
        if frames == 0 {
            return Err(UploadError::BrokenGif);
        }
        if frames > MAX_FRAMES {
            return Err(UploadError::TooManyFrames { frames });
        }
    }
    Ok(kind)
}

// Reports ----------------------------------------------------------------------

/// Reports from this many different players hide a custom cape for everyone
/// until a volunteer looks at it.
pub const REPORTS_TO_HIDE: usize = 3;

/// True once enough different players reported a cape. One player reporting
/// twice counts once.
pub fn hidden_by_reports<T: Eq + Hash>(reporters: impl IntoIterator<Item = T>) -> bool {
    reporters.into_iter().collect::<HashSet<T>>().len() >= REPORTS_TO_HIDE
}

// The catalog ----------------------------------------------------------------

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub enum Kind {
    Cape,
    Wings,
    Hat,
    Pet,
    Emote,
}

impl Kind {
    pub fn parse(s: &str) -> Option<Kind> {
        Some(match s {
            "cape" => Kind::Cape,
            "wings" => Kind::Wings,
            "hat" => Kind::Hat,
            "pet" => Kind::Pet,
            "emote" => Kind::Emote,
            _ => return None,
        })
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Item {
    pub id: String,
    pub name: String,
    pub kind: Kind,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct CatalogError {
    pub line: usize,
    pub message: String,
}

impl fmt::Display for CatalogError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(f, "cosmetics.toml line {}: {}", self.line, self.message)
    }
}

#[derive(Debug, Clone, Default)]
pub struct Catalog {
    pub items: Vec<Item>,
}

impl Catalog {
    /// Reads `catalog/cosmetics.toml`: `[[item]]` tables with `id`, `name` and
    /// `kind`. Other keys (`new = true`) are for the app and are skipped here.
    pub fn parse(text: &str) -> Result<Catalog, CatalogError> {
        let mut items = Vec::new();
        let mut seen = HashSet::new();
        let mut open: Option<(usize, [Option<String>; 3])> = None;

        let mut close = |open: Option<(usize, [Option<String>; 3])>| -> Result<(), CatalogError> {
            let Some((line, [id, name, kind])) = open else {
                return Ok(());
            };
            let err = |m: &str| CatalogError {
                line,
                message: m.to_string(),
            };
            let id = id.ok_or_else(|| err("item has no id"))?;
            let name = name.ok_or_else(|| err("item has no name"))?;
            let kind_s = kind.ok_or_else(|| err("item has no kind"))?;
            let kind =
                Kind::parse(&kind_s).ok_or_else(|| err(&format!("unknown kind \"{kind_s}\"")))?;
            if !seen.insert(id.clone()) {
                return Err(err(&format!("id \"{id}\" is used twice")));
            }
            items.push(Item { id, name, kind });
            Ok(())
        };

        for (n, raw) in text.lines().enumerate() {
            let line_no = n + 1;
            let line = raw.trim();
            if line.is_empty() || line.starts_with('#') {
                continue;
            }
            if line == "[[item]]" {
                close(open.take())?;
                open = Some((line_no, [None, None, None]));
                continue;
            }
            let err = |m: &str| CatalogError {
                line: line_no,
                message: m.to_string(),
            };
            let (key, value) = line
                .split_once('=')
                .ok_or_else(|| err("expected key = value"))?;
            let Some((_, fields)) = open.as_mut() else {
                return Err(err("key outside an [[item]]"));
            };
            let slot = match key.trim() {
                "id" => 0,
                "name" => 1,
                "kind" => 2,
                _ => continue,
            };
            let value = value.trim();
            let text = value
                .strip_prefix('"')
                .and_then(|v| v.split_once('"'))
                .map(|(s, _)| s.to_string())
                .ok_or_else(|| err("expected a quoted string"))?;
            fields[slot] = Some(text);
        }
        close(open.take())?;
        Ok(Catalog { items })
    }

    pub fn of(&self, kind: Kind) -> impl Iterator<Item = &Item> {
        self.items.iter().filter(move |i| i.kind == kind)
    }

    pub fn count(&self, kind: Kind) -> usize {
        self.of(kind).count()
    }

    pub fn get(&self, id: &str) -> Option<&Item> {
        self.items.iter().find(|i| i.id == id)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn sha1_known_answers() {
        let hex = |d: [u8; 20]| d.iter().map(|b| format!("{b:02x}")).collect::<String>();
        assert_eq!(
            hex(sha1(b"abc")),
            "a9993e364706816aba3e25717850c26c9cd0d89d"
        );
        assert_eq!(hex(sha1(b"")), "da39a3ee5e6b4b0d3255bfef95601890afd80709");
        let long = b"abcdbcdecdefdefgefghfghighijhijkijkljklmklmnlmnomnopnopq";
        assert_eq!(hex(sha1(long)), "84983e441c3bd26ebaae4aa1f95129e5e54670f1");
    }

    #[test]
    fn server_id_hash_matches_minecraft() {
        assert_eq!(
            server_id_hash("Notch"),
            "4ed1f46bbe04bc756bcb17c0c7ce3e4632f06a48"
        );
        assert_eq!(
            server_id_hash("jeb_"),
            "-7c9d5b0044c130109a5d7b5fb5c317c02b4e28c1"
        );
        assert_eq!(
            server_id_hash("simon"),
            "88e16a1019277b15d58faf0541e11910eb756f6"
        );
    }

    #[test]
    fn squad_codes() {
        assert_eq!(squad_tag("Wolf"), "WOLF");
        assert_eq!(squad_tag("Wolves"), "WOLV");
        assert_eq!(squad_tag("Ox"), "OXXX");
        assert_eq!(squad_tag("Kai's 2 builders"), "KAIS");
        assert_eq!(squad_tag("42"), "XXXX");
        assert_eq!(squad_code("Wolf", 253_011), "WOLF-7Q2K");
        assert_eq!(squad_code("Wolf", 0), "WOLF-0000");
        assert_eq!(squad_code("Wolf", u32::MAX), "WOLF-ZZZZ");
    }

    #[test]
    fn codes_are_read_the_way_people_type_them() {
        assert_eq!(normalize_code("wolf 7q2k").as_deref(), Ok("WOLF-7Q2K"));
        assert_eq!(normalize_code(" WOLF-7Q2K ").as_deref(), Ok("WOLF-7Q2K"));
        assert_eq!(normalize_code("wolf7q2k").as_deref(), Ok("WOLF-7Q2K"));
        assert_eq!(normalize_code("wolf-io2l").as_deref(), Ok("WOLF-1021"));
        assert_eq!(normalize_code("wolf-7q2"), Err(CodeError::Length(7)));
        assert_eq!(normalize_code("w0lf-7q2k"), Err(CodeError::Tag));
        assert_eq!(normalize_code("wolf-7u2k"), Err(CodeError::Char('U')));
        assert_eq!(normalize_code("wolf-7q2é"), Err(CodeError::Char('é')));
        for n in [0, 1, 31, 32, 253_011, 0xF_FFFF] {
            let code = squad_code("Wolf", n);
            assert_eq!(normalize_code(&code.to_lowercase()), Ok(code));
        }
    }

    #[test]
    fn fitting_a_picture_to_a_cape() {
        // A wide sunset: keep the full height, take a 10:16 slice.
        let c = fit_cover(1600, 900, CAPE_W, CAPE_H, (0.5, 0.5));
        assert_eq!(
            c,
            CropRect {
                x: 519,
                y: 0,
                w: 563,
                h: 900
            }
        );
        assert_eq!(fit_cover(1600, 900, CAPE_W, CAPE_H, (0.0, 0.5)).x, 0);
        assert_eq!(fit_cover(1600, 900, CAPE_W, CAPE_H, (1.0, 0.5)).x, 1037);
        assert_eq!(fit_cover(1600, 900, CAPE_W, CAPE_H, (7.0, -3.0)).x, 1037);
        // A tall picture: keep the full width.
        assert_eq!(
            fit_cover(400, 1000, CAPE_W, CAPE_H, (0.5, 0.5)),
            CropRect {
                x: 0,
                y: 180,
                w: 400,
                h: 640
            }
        );
        // Already the right shape: nothing is cut.
        assert_eq!(
            fit_cover(160, 256, CAPE_W, CAPE_H, (0.2, 0.9)),
            CropRect {
                x: 0,
                y: 0,
                w: 160,
                h: 256
            }
        );
        assert_eq!(fit_cover(0, 256, CAPE_W, CAPE_H, (0.5, 0.5)).w, 0);
    }

    /// A GIF with no colour table and `n` one-pixel frames, each behind a
    /// graphic control extension, the way animated GIFs are written.
    fn gif(n: usize) -> Vec<u8> {
        let mut b = b"GIF89a".to_vec();
        b.extend_from_slice(&[1, 0, 1, 0, 0x00, 0, 0]);
        b.extend_from_slice(&[0x21, 0xFF, 11]);
        b.extend_from_slice(b"NETSCAPE2.0");
        b.extend_from_slice(&[3, 1, 0, 0, 0]);
        for _ in 0..n {
            b.extend_from_slice(&[0x21, 0xF9, 4, 0, 10, 0, 0, 0]);
            b.extend_from_slice(&[0x2C, 0, 0, 0, 0, 1, 0, 1, 0, 0x00]);
            b.extend_from_slice(&[2, 2, 0x4C, 0x01, 0]);
        }
        b.push(0x3B);
        b
    }

    #[test]
    fn upload_checks() {
        assert_eq!(gif_frames(&gif(1)), Some(1));
        assert_eq!(gif_frames(&gif(18)), Some(18));
        assert_eq!(check_upload(&gif(32)), Ok(ImageKind::Gif));
        assert_eq!(
            check_upload(&gif(33)),
            Err(UploadError::TooManyFrames { frames: 33 })
        );
        assert_eq!(check_upload(&gif(0)), Err(UploadError::BrokenGif));
        let cut = gif(4);
        assert_eq!(
            check_upload(&cut[..cut.len() - 6]),
            Err(UploadError::BrokenGif)
        );

        let mut png = b"\x89PNG\r\n\x1a\n".to_vec();
        png.resize(2000, 0);
        assert_eq!(check_upload(&png), Ok(ImageKind::Png));
        assert_eq!(sniff(&[0xFF, 0xD8, 0xFF, 0xE0]), Some(ImageKind::Jpeg));
        assert_eq!(check_upload(b"<svg></svg>"), Err(UploadError::NotAPicture));
        png.resize(MAX_UPLOAD_BYTES, 0);
        assert!(check_upload(&png).is_ok());
        png.push(0);
        assert_eq!(
            check_upload(&png),
            Err(UploadError::TooBig {
                bytes: MAX_UPLOAD_BYTES + 1
            })
        );
    }

    #[test]
    fn three_different_reporters_hide_a_cape() {
        assert!(!hidden_by_reports(["mossy", "mossy", "mossy"]));
        assert!(!hidden_by_reports(["mossy", "Lumen"]));
        assert!(hidden_by_reports(["mossy", "Lumen", "mossy", "ripley_r"]));
        assert!(!hidden_by_reports(Vec::<u64>::new()));
    }

    #[test]
    fn the_shipped_catalog() {
        let c = Catalog::parse(include_str!("../../../catalog/cosmetics.toml")).unwrap();
        assert_eq!(c.count(Kind::Cape), 24);
        assert_eq!(c.count(Kind::Wings), 8);
        assert_eq!(c.count(Kind::Hat), 12);
        assert_eq!(c.count(Kind::Pet), 6);
        assert_eq!(c.count(Kind::Emote), 8);
        assert_eq!(
            c.get("ember").map(|i| (i.name.as_str(), i.kind)),
            Some(("Ember", Kind::Cape))
        );
        assert_eq!(c.get("moth").map(|i| i.kind), Some(Kind::Wings));
        assert_eq!(c.get("fox").map(|i| i.kind), Some(Kind::Pet));
        assert_eq!(c.get("gg").map(|i| i.name.as_str()), Some("GG"));
    }

    #[test]
    fn catalog_errors_name_the_line() {
        let dup = "[[item]]\nid = \"a\"\nname = \"A\"\nkind = \"cape\"\n\n[[item]]\nid = \"a\"\nname = \"B\"\nkind = \"hat\"\n";
        assert_eq!(Catalog::parse(dup).unwrap_err().line, 6);
        let kind = "[[item]]\nid = \"a\"\nname = \"A\"\nkind = \"boots\"\n";
        assert!(Catalog::parse(kind).unwrap_err().message.contains("boots"));
        assert_eq!(Catalog::parse("id = \"a\"\n").unwrap_err().line, 1);
        assert_eq!(
            Catalog::parse("[[item]]\nname = \"A\"\nkind = \"pet\"\n")
                .unwrap_err()
                .message,
            "item has no id"
        );
        let ok = "[[item]]\nid = \"a\"  # note\nname = \"A\"\nkind = \"pet\"\nnew = true\n";
        assert_eq!(Catalog::parse(ok).unwrap().items[0].id, "a");
    }
}
