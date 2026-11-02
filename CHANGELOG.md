# Changelog


## 1.1.2 — 3 November 2026

A maintenance release.

### Fixes

- The cape list loads faster and no longer flickers while scrolling.

## 1.1.1 · 2026-11-01

- Custom PNG capes load on first try again.
- Squad capes sync without a restart.
- Emote wheel opens faster and no longer flickers.
- Cape preview shows the correct frame for animated GIFs.

## 1.0.2 · 2026-10-09

- Emotes on the B wheel, seen by every Drip player on the same server.
- Custom capes: three reports from different players hide one until it is reviewed.

## 1.1.0 · 2026-10-30

- The wardrobe: 24 capes, 8 wings, 12 hats, 6 pets and 8 emotes, all original pixel art and all free. Every piece has a preview card; point at one to try it on a turning player, drag to turn, or flip Front and Back.
- Capes in Minecraft's cape layout at 2x (`catalog/capes.png`).
- Your own skin on the model, fetched by name from Mojang's public profile API after you connect.
- Squad capes: an emblem and two colours for the whole crew, joined with a code like `WOLF-7Q2K`. The squad name shows under your name tag.
- Your own cape from a PNG, JPG or GIF up to 512 KB. GIFs become animated capes of up to 32 frames.
- Emotes: hold B in game for the wheel and release on one. Other Drip players on the same server see it.
- The Horizon mod (`mod/`), added to Horizon in one click. No login: it signs in through the game's own session join.
- The free server (`server/`): one Cloudflare Worker with D1, R2 and a Durable Object for emote rooms. Anyone can run a mirror.
- Hide all cosmetics with one switch, and choose whose custom capes you see. Three reports from different players hide a custom cape until it's reviewed.
- The Founder cape for everyone who connects in the first month.
- Portable builds for Windows (`.exe`) and Linux (AppImage).
