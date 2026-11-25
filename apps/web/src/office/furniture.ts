/**
 * Pixel Agents furniture we use (public/pixel-agents/v1.6.0/furniture, see ASSETS.md) and its size
 * in 16 px tiles. Sizes are checked against the PNGs when they load.
 */
export const FURNITURE = {
  DESK_FRONT: { file: 'DESK/DESK_FRONT', w: 3, h: 2 },
  DESK_SIDE: { file: 'DESK/DESK_SIDE', w: 1, h: 4 },
  PC_FRONT_ON_1: { file: 'PC/PC_FRONT_ON_1', w: 1, h: 2 },
  PC_FRONT_ON_2: { file: 'PC/PC_FRONT_ON_2', w: 1, h: 2 },
  PC_FRONT_ON_3: { file: 'PC/PC_FRONT_ON_3', w: 1, h: 2 },
  PC_FRONT_OFF: { file: 'PC/PC_FRONT_OFF', w: 1, h: 2 },
  PC_SIDE: { file: 'PC/PC_SIDE', w: 1, h: 2 },
  CUSHIONED_BENCH: { file: 'CUSHIONED_BENCH/CUSHIONED_BENCH', w: 1, h: 1 },
  CLOCK: { file: 'CLOCK/CLOCK', w: 1, h: 2 },
  HANGING_PLANT: { file: 'HANGING_PLANT/HANGING_PLANT', w: 1, h: 2 },
  PLANT: { file: 'PLANT/PLANT', w: 1, h: 2 },
  PLANT_2: { file: 'PLANT_2/PLANT_2', w: 1, h: 2 },
  CACTUS: { file: 'CACTUS/CACTUS', w: 1, h: 2 },
  LARGE_PLANT: { file: 'LARGE_PLANT/LARGE_PLANT', w: 2, h: 3 },
  WHITEBOARD: { file: 'WHITEBOARD/WHITEBOARD', w: 2, h: 2 },
  LARGE_PAINTING: { file: 'LARGE_PAINTING/LARGE_PAINTING', w: 2, h: 2 },
  SMALL_PAINTING: { file: 'SMALL_PAINTING/SMALL_PAINTING', w: 1, h: 2 },
  SMALL_PAINTING_2: { file: 'SMALL_PAINTING_2/SMALL_PAINTING_2', w: 1, h: 2 },
  DOUBLE_BOOKSHELF: { file: 'DOUBLE_BOOKSHELF/DOUBLE_BOOKSHELF', w: 2, h: 2 },
  BIN: { file: 'BIN/BIN', w: 1, h: 1 },
  COFFEE: { file: 'COFFEE/COFFEE', w: 1, h: 1 },
  SMALL_TABLE_SIDE: { file: 'SMALL_TABLE/SMALL_TABLE_SIDE', w: 1, h: 3 },
} as const;

export type FurnitureId = keyof typeof FURNITURE;

export const FURNITURE_IDS = Object.keys(FURNITURE) as FurnitureId[];

/** Sprites every desk needs; the rest is decor. */
export const REQUIRED_FURNITURE: readonly FurnitureId[] = [
  'DESK_FRONT',
  'CUSHIONED_BENCH',
  'PC_FRONT_ON_1',
  'PC_FRONT_ON_2',
  'PC_FRONT_ON_3',
  'PC_FRONT_OFF',
];
