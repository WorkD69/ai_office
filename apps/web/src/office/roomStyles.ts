import { hash32 } from './hash';

export interface RoomStyle {
  wall: string;
  wallDark: string;
  floor: string;
  floorAlt: string;
  /** Team colour: name plates, sign plate, selection. */
  accent: string;
}

const STYLES: Readonly<Record<string, RoomStyle>> = {
  hq: {
    wall: '#a34f3f',
    wallDark: '#7c392e',
    floor: '#dcc8a2',
    floorAlt: '#d0bb93',
    accent: '#f2b84b',
  },
  opportunities: {
    wall: '#4d7a58',
    wallDark: '#385b41',
    floor: '#a9cf9f',
    floorAlt: '#9cc392',
    accent: '#86df7c',
  },
  trading: {
    wall: '#3e5d86',
    wallDark: '#2d4566',
    floor: '#9ab0d0',
    floorAlt: '#8da4c5',
    accent: '#79bcff',
  },
  community: {
    wall: '#7f5591',
    wallDark: '#5e3e6c',
    floor: '#cdb0da',
    floorAlt: '#c1a3cf',
    accent: '#dba5f5',
  },
  server: {
    wall: '#3a4050',
    wallDark: '#2a2f3c',
    floor: '#757e91',
    floorAlt: '#6a7386',
    accent: '#7ee0ff',
  },
  dev: {
    wall: '#2e6c67',
    wallDark: '#21504c',
    floor: '#a4d6cb',
    floorAlt: '#97cabf',
    accent: '#5fe3c9',
  },
  content: {
    wall: '#93763a',
    wallDark: '#6f582a',
    floor: '#e8d7aa',
    floorAlt: '#ddcb9d',
    accent: '#ffd27a',
  },
  lounge: {
    wall: '#8a4f6a',
    wallDark: '#683a4f',
    floor: '#dcb7a8',
    floorAlt: '#d1ab9b',
    accent: '#ff9fb2',
  },
};

const FALLBACK: readonly RoomStyle[] = [
  {
    wall: '#6a5a8a',
    wallDark: '#4f4368',
    floor: '#c9c0dc',
    floorAlt: '#bdb3d1',
    accent: '#b9a6ff',
  },
  {
    wall: '#8a6a4a',
    wallDark: '#684f37',
    floor: '#dccbb5',
    floorAlt: '#d1bfa8',
    accent: '#ffc38a',
  },
  {
    wall: '#4a7a8a',
    wallDark: '#375b68',
    floor: '#b5d3dc',
    floorAlt: '#a8c7d1',
    accent: '#8ae0ff',
  },
];

export function roomStyle(roomId: string): RoomStyle {
  return STYLES[roomId] ?? (FALLBACK[hash32(roomId) % FALLBACK.length] as RoomStyle);
}

/** Shared scene colours. */
export const SCENE = {
  outside: '#16131f',
  building: '#2b2135',
  hallway: '#7b5a41',
  hallwayLine: '#6a4c36',
  outline: '#2b2135',
  plate: '#231d2e',
  plateMuted: '#4a4458',
  textMuted: '#9b93ab',
  glow: '#7ee0ff',
  warn: '#ffd24a',
  danger: '#ff5a5f',
  white: '#f4f1ea',
} as const;
