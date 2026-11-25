# Assets

The office scene uses art from **Pixel Agents** (floors, walls, furniture and character
layers), copied once from a fixed release; there is no dependency on and no sync with
upstream ([ADR 0004](docs/adr/0004-pixel-agents-art.md)). Everything else is our own.

## Pixel Agents (MIT)

- Source: <https://github.com/pixel-agents-hq/pixel-agents>, tag `v1.6.0`, commit
  `4dd14d612fd37d89ffbbc977959f572395c4eec8`.
- Licence: MIT, Copyright (c) 2026 Pablo De Lucca. The full text ships next to the files:
  [`apps/web/public/pixel-agents/v1.6.0/LICENSE`](apps/web/public/pixel-agents/v1.6.0/LICENSE).
- Characters in Pixel Agents were baked from **MetroCity** by JIK-A-4
  (<https://jik-a-4.itch.io/metrocity-free-topdown-character-pack>, CC0 1.0) and then
  redrawn. CC0 needs no credit; we credit it anyway. The CC0 licence was read from the
  itch.io page during the spike (#3), not re-checked for this change.
- Furniture, floors and walls were added upstream in their PR #117 as original pieces; who drew
  them is known only from that PR, the repository has no separate asset credits.
- Every file below is byte-identical to the upstream file at that commit (git blob hashes
  compared). Our code recolours some of them at runtime (floors, walls, clothes, hair, the red
  error screen), composes the characters from layers and derives a raised-hand frame.

All paths are under `apps/web/public/pixel-agents/v1.6.0/` (versioned so browsers can cache them for good); `Upstream` is relative to the repository
root of Pixel Agents at the commit above.

| Files here                                                                                                                                                                                                                                                                                               | Upstream                                               |
| -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------ |
| `floors/floor_0.png`, `floor_1.png`, `floor_3.png`, `floor_4.png`, `floor_5.png`, `floor_6.png`, `floor_7.png`                                                                                                                                                                                           | `webview-ui/public/assets/floors/` (same names)        |
| `walls/wall_0.png`                                                                                                                                                                                                                                                                                       | `webview-ui/public/assets/walls/wall_0.png`            |
| `furniture/DESK/DESK_FRONT.png`, `furniture/DESK/DESK_SIDE.png`                                                                                                                                                                                                                                          | `webview-ui/public/assets/furniture/DESK/`             |
| `furniture/PC/PC_FRONT_ON_1.png`, `PC_FRONT_ON_2.png`, `PC_FRONT_ON_3.png`, `PC_FRONT_OFF.png`, `PC_SIDE.png`                                                                                                                                                                                            | `webview-ui/public/assets/furniture/PC/`               |
| `furniture/CUSHIONED_BENCH/CUSHIONED_BENCH.png`, `furniture/CLOCK/CLOCK.png`, `furniture/HANGING_PLANT/HANGING_PLANT.png`, `furniture/PLANT/PLANT.png`, `furniture/PLANT_2/PLANT_2.png`, `furniture/CACTUS/CACTUS.png`, `furniture/LARGE_PLANT/LARGE_PLANT.png`, `furniture/WHITEBOARD/WHITEBOARD.png`   | `webview-ui/public/assets/furniture/` (same sub-paths) |
| `furniture/LARGE_PAINTING/LARGE_PAINTING.png`, `furniture/SMALL_PAINTING/SMALL_PAINTING.png`, `furniture/SMALL_PAINTING_2/SMALL_PAINTING_2.png`, `furniture/DOUBLE_BOOKSHELF/DOUBLE_BOOKSHELF.png`, `furniture/BIN/BIN.png`, `furniture/COFFEE/COFFEE.png`, `furniture/SMALL_TABLE/SMALL_TABLE_SIDE.png` | `webview-ui/public/assets/furniture/` (same sub-paths) |
| `characters/body/flat.png`                                                                                                                                                                                                                                                                               | `webview-ui/src/characters/art/body/flat.png`          |
| `characters/hair/short.png`, `bob.png`, `mop.png`, `spiky.png`, `slicked_back.png`, `high_ponytail.png`, `long_waves.png`, `parted.png`                                                                                                                                                                  | `webview-ui/src/characters/art/hair/` (same names)     |
| `characters/top/tshirt.png`, `long_sleeved_shirt.png`, `turtleneck.png`                                                                                                                                                                                                                                  | `webview-ui/src/characters/art/top/` (same names)      |
| `characters/jacket/blazer.png`, `vest.png`, `bomber.png`                                                                                                                                                                                                                                                 | `webview-ui/src/characters/art/jacket/` (same names)   |
| `characters/pants/jeans.png`, `skirt.png`                                                                                                                                                                                                                                                                | `webview-ui/src/characters/art/pants/` (same names)    |
| `characters/hat/badge_cap.png`                                                                                                                                                                                                                                                                           | `webview-ui/src/characters/art/hat/badge_cap.png`      |
| `LICENSE`                                                                                                                                                                                                                                                                                                | `LICENSE`                                              |

Also taken from Pixel Agents as data, not files: the skin-tone colour swaps of the `flat` body
(`webview-ui/src/characters/art/wardrobe.json`) in `apps/web/src/office/characters.ts`, and the
colorize formula (`webview-ui/src/office/colorize.ts`) rewritten in `apps/web/src/office/pixels.ts`.

## Our own (MIT, this repository's [licence](LICENSE))

| Asset                                                         | Where                               |
| ------------------------------------------------------------- | ----------------------------------- |
| Status badges in the scene (bubbles «!», hourglass, «×», dot) | `apps/web/src/office/badges.ts`     |
| Raised-hand arm (drawn in each character's own colours)       | `apps/web/src/office/characters.ts` |
| Favicon                                                       | `apps/web/public/favicon.svg`       |

Packs that forbid redistribution (for example LimeZu Modern Interiors / Modern Office) must
not be committed. Any new third-party file must be listed here with its source URL and licence.
