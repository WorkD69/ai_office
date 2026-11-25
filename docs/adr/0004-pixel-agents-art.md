# ADR 0004 — Art from Pixel Agents, our own renderer

- Status: accepted
- Date: 2026-11-25
- Supersedes: the "code-defined sprites" part of [ADR 0002](0002-canvas-sprites.md)
  (Canvas 2D, the ~30 fps cap and pausing on hidden pages stay)

## Context

The owner wants the office to look like Pixel Agents: wooden and tiled floors, dark walls,
shelves, plants and 16×32 characters in a top-down 3/4 view. Our code-drawn rooms (one bright
colour per room, ~14×17 characters) do not give that look.

A one-evening spike (ticket #3) read Pixel Agents
(https://github.com/pixel-agents-hq/pixel-agents, tag `v1.6.0`, commit `4dd14d6`):

- The renderer is not a library: ~4k lines inside their monorepo, coupled to their editor,
  Claude Code tool names and a free tile map with zoom and pan. Porting it: 3–5 evenings plus
  maintaining a fork. Our renderer (~1.7k lines) already fits the office to 390 and 1440 px.
- Art: the whole repository is MIT (© 2026 Pablo De Lucca); there is no separate asset
  licence. Characters were baked from JIK-A-4 MetroCity (CC0 1.0) and redrawn. Furniture,
  floors, walls and carpets were added in their PR #117 as "original" pieces. The font
  (FS Pixel Sans Unicode) is OFL; its Bold variant is "All Rights Reserved".

## Decision

- Take the art, not the engine: floors, walls, furniture and character sheets (PNG) from
  `v1.6.0`, copied once into this repository. No dependency and no sync with upstream.
- Our renderer switches to a 16 px tile and 16×32 characters (ticket #14).
- Take characters and furniture together: mixing their furniture with our characters gives
  two scales and two styles.
- Not taken: their font, pets, the layout editor, their code. Ideas only (no code): the
  "waiting" bubble, the switched-off monitor for an offline agent, 3-frame monitor animation.

## Consequences

- `ASSETS.md` lists every copied file with its source URL, tag and licence; the Pixel Agents
  MIT text with its copyright ships next to the files; MetroCity (JIK-A-4) is credited although
  CC0 does not require it. The "no third-party images" sentence goes away.
- Risk: who drew the furniture and floors is known only from the upstream author's word in
  PR #117. If that turns out wrong, the files are replaced, the layout does not change.
- Bundle grows by the copied PNGs (the whole `public/assets` of upstream is ~200 KB; we copy a
  subset).
- Room colour no longer comes from the floor: rooms differ by floor and furniture, the accent
  colour stays on the room sign (see `docs/design.md`).
