/**
 * What the scene shows for an agent at a moment: pose, monitor frame and status badge
 * (docs/design.md, "Статусы на сцене" and "Движение"). Pure, so status mapping is tested.
 */
import type { AgentStatus } from '@ai-office/protocol';

export type Pose = 'seated' | 'hand-up' | 'hand-up-sway' | 'absent';
export type Monitor = 'on-1' | 'on-2' | 'on-3' | 'off' | 'error';
export type Badge = 'dot' | 'bang' | 'hourglass' | 'cross' | null;

export interface AgentView {
  pose: Pose;
  monitor: Monitor;
  badge: Badge;
  /** Vertical lift of the badge in art pixels (the "!" bubble hops by 1 px). */
  lift: 0 | 1;
}

export const MONITOR_FRAME_MS = 400;
export const HAND_SWAY_MS = 600;
export const BUBBLE_HOP_MS = 800;

const MONITOR_FRAMES: readonly Monitor[] = ['on-1', 'on-2', 'on-3'];

/** `still` = prefers-reduced-motion: monitor and hand stay on their first frame. */
export function agentView(status: AgentStatus, t: number, still: boolean): AgentView {
  const phase = (period: number, frames: number) =>
    still ? 0 : Math.floor(Math.max(0, t) / period) % frames;
  switch (status) {
    case 'working':
      return {
        pose: 'seated',
        monitor: MONITOR_FRAMES[phase(MONITOR_FRAME_MS, 3)] ?? 'on-1',
        badge: 'dot',
        lift: 0,
      };
    case 'waiting_you':
      return {
        pose: phase(HAND_SWAY_MS, 2) === 1 ? 'hand-up-sway' : 'hand-up',
        monitor: 'on-1',
        badge: 'bang',
        lift: phase(BUBBLE_HOP_MS, 2) === 1 ? 1 : 0,
      };
    case 'waiting_external':
      return { pose: 'seated', monitor: 'on-1', badge: 'hourglass', lift: 0 };
    case 'error':
      return { pose: 'seated', monitor: 'error', badge: 'cross', lift: 0 };
    case 'idle':
      return { pose: 'seated', monitor: 'on-1', badge: null, lift: 0 };
    case 'offline':
      return { pose: 'absent', monitor: 'off', badge: null, lift: 0 };
  }
}

/** Blink of the name plate of an agent waiting for you, and of the selection frame. */
export const PLATE_BLINK_MS = 400;
export const SELECTION_BLINK_MS = 350;

/**
 * Everything time-based the scene shows, as a string: the canvas is redrawn only when it
 * changes (or the data does). With reduced motion it never changes.
 */
export function animationKey(
  statuses: readonly AgentStatus[],
  selected: boolean,
  t: number,
  still: boolean,
): string {
  if (still) return 'still';
  const tick = (period: number, frames: number) => Math.floor(Math.max(0, t) / period) % frames;
  const working = statuses.includes('working');
  const waiting = statuses.includes('waiting_you');
  return [
    working ? tick(MONITOR_FRAME_MS, 3) : '-',
    waiting ? tick(HAND_SWAY_MS, 2) : '-',
    waiting ? tick(BUBBLE_HOP_MS, 2) : '-',
    waiting ? tick(PLATE_BLINK_MS, 2) : '-',
    selected ? tick(SELECTION_BLINK_MS, 2) : '-',
  ].join('');
}
