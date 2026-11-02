# Contributing

Thanks for helping Drip.

## Reporting a bug

Open an issue with the version, the OS, your Horizon version and the exact
steps. If the problem is in an answer or an install, attach the smallest mod
list or cape file that reproduces it.

## Code

```bash
cargo fmt --all
cargo clippy --workspace -- -D warnings
cargo test --workspace
```

Keep user-facing text short and plain: one sentence per answer, no jargon.
