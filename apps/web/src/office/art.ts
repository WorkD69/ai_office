/**
 * Loads the Pixel Agents PNGs (public/pixel-agents, see ASSETS.md) once and prepares every
 * sprite the scene needs as an offscreen canvas at 1 art pixel per pixel: recoloured floors
 * and walls, furniture, the red error monitor, characters composed from wardrobe layers and
 * our own status badges.
 */
import { bubblePixels, dotPixels, type BubbleKind } from './badges';
import { allLookFiles, composeCharacter, LOOKS } from './characters';
import { FURNITURE, FURNITURE_IDS, type FurnitureId } from './furniture';
import { colorize, redScreen, type Hsbc, type Pixels } from './pixels';
import { FLOOR_TILES, type FloorTile } from './rooms';

const BASE = '/pixel-agents/';
/** Dark walls between rooms: Pixel Agents' wall pieces recoloured. */
export const WALL_COLOUR: Hsbc = { h: 214, s: 30, b: -100, c: -55 };

export interface CharacterSprites {
  seated: HTMLCanvasElement;
  raised: readonly [HTMLCanvasElement, HTMLCanvasElement];
  headTop: number;
}

export interface SceneArt {
  furniture: Readonly<Record<FurnitureId, HTMLCanvasElement>>;
  /** Lit monitor with a red screen (error). */
  monitorError: HTMLCanvasElement;
  /** 64x128 sheet of 16 wall pieces, already dark. */
  wall: HTMLCanvasElement;
  floor: (tile: FloorTile, colour: Hsbc) => HTMLCanvasElement;
  /** Indexed like `LOOKS`. */
  characters: readonly CharacterSprites[];
  bubbles: Readonly<Record<BubbleKind, HTMLCanvasElement>>;
  dot: HTMLCanvasElement;
}

function loadImage(path: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error(`cannot load ${path}`));
    img.src = BASE + path;
  });
}

function context(canvas: HTMLCanvasElement): CanvasRenderingContext2D {
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) throw new Error('2D canvas is not available');
  return ctx;
}

async function loadPixels(path: string): Promise<Pixels> {
  const img = await loadImage(path);
  const canvas = document.createElement('canvas');
  canvas.width = img.naturalWidth;
  canvas.height = img.naturalHeight;
  const ctx = context(canvas);
  ctx.drawImage(img, 0, 0);
  const { data, width, height } = ctx.getImageData(0, 0, canvas.width, canvas.height);
  return { data, width, height };
}

export function toCanvas(p: Pixels): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  canvas.width = p.width;
  canvas.height = p.height;
  const image = context(canvas).createImageData(p.width, p.height);
  image.data.set(p.data);
  context(canvas).putImageData(image, 0, 0);
  return canvas;
}

let pending: Promise<SceneArt> | null = null;

/** Loads and prepares the art once per page; a failed load can be retried. */
export function loadSceneArt(): Promise<SceneArt> {
  pending ??= buildArt().catch((err: unknown) => {
    pending = null;
    throw err;
  });
  return pending;
}

async function buildArt(): Promise<SceneArt> {
  const lookFiles = allLookFiles();
  const [furniturePixels, floorPixels, wallPixels, layerPixels] = await Promise.all([
    Promise.all(FURNITURE_IDS.map((id) => loadPixels(`furniture/${FURNITURE[id].file}.png`))),
    Promise.all(FLOOR_TILES.map((tile) => loadPixels(`floors/floor_${tile}.png`))),
    loadPixels('walls/wall_0.png'),
    Promise.all(lookFiles.map((file) => loadPixels(`characters/${file}`))),
  ]);

  const furniture = {} as Record<FurnitureId, HTMLCanvasElement>;
  FURNITURE_IDS.forEach((id, i) => {
    const px = furniturePixels[i] as Pixels;
    const want = FURNITURE[id];
    if (px.width !== want.w * 16 || px.height !== want.h * 16) {
      throw new Error(
        `furniture ${id} is ${px.width}x${px.height}, want ${want.w * 16}x${want.h * 16}`,
      );
    }
    furniture[id] = toCanvas(px);
  });
  const monitorIndex = FURNITURE_IDS.indexOf('PC_FRONT_ON_1');
  const monitorError = toCanvas(redScreen(furniturePixels[monitorIndex] as Pixels));

  const floorSource = new Map<FloorTile, Pixels>();
  FLOOR_TILES.forEach((tile, i) => floorSource.set(tile, floorPixels[i] as Pixels));
  const floorCache = new Map<string, HTMLCanvasElement>();
  const floor = (tile: FloorTile, colour: Hsbc) => {
    const key = `${tile}:${colour.h}:${colour.s}:${colour.b}:${colour.c}`;
    let canvas = floorCache.get(key);
    if (!canvas) {
      const src = floorSource.get(tile);
      if (!src) throw new Error(`floor tile ${tile} is not loaded`);
      canvas = toCanvas(colorize(src, colour));
      floorCache.set(key, canvas);
    }
    return canvas;
  };

  const sheets = new Map<string, Pixels>();
  lookFiles.forEach((file, i) => sheets.set(file, layerPixels[i] as Pixels));
  const characters = LOOKS.map((look) => {
    const frames = composeCharacter(look, sheets);
    return {
      seated: toCanvas(frames.seated),
      raised: [toCanvas(frames.raised[0]), toCanvas(frames.raised[1])] as const,
      headTop: frames.headTop,
    };
  });

  return {
    furniture,
    monitorError,
    wall: toCanvas(colorize(wallPixels, WALL_COLOUR)),
    floor,
    characters,
    bubbles: {
      bang: toCanvas(bubblePixels('bang')),
      hourglass: toCanvas(bubblePixels('hourglass')),
      cross: toCanvas(bubblePixels('cross')),
    },
    dot: toCanvas(dotPixels()),
  };
}
