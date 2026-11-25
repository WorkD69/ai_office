# ADR 0002 — Canvas 2D with code-defined sprites

- Status: accepted; the code-defined sprites part is superseded by
  [ADR 0004](0004-pixel-agents-art.md) (landed with ticket #14)
- Date: 2026-11-19

## Context

The office has ~10 characters and static furniture. It must run smoothly inside the
Telegram WebView on budget Android phones. The repository is public, so every asset must
be redistributable.

## Options considered

- **PixiJS / Phaser** — great for games, but +0.5–1 MB of JavaScript and features we do not
  need (physics, scene graphs, loaders).
- **Third-party tilesets** — the most attractive packs (e.g. LimeZu Modern Interiors/Office)
  forbid redistribution, so they cannot live in a public repo. CC0 packs (Kenney, JIK-A-4)
  are fine but stylistically mixed.
- **Canvas 2D + sprites defined in code** — palette-indexed pixel arrays rendered once into
  offscreen canvases and scaled with nearest-neighbour.

## Decision

Canvas 2D with our own code-defined sprites (MIT, same licence as the code). The render
loop is capped at ~30 fps and paused when the page is hidden.

## Consequences

- Zero asset licensing risk; see [`ASSETS.md`](../../ASSETS.md).
- Small bundle and predictable performance in WebViews.
- Art is limited by what we draw ourselves; a CC0 tileset can be added later behind the same
  sprite interface if needed.
