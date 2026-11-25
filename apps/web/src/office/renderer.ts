import type { AgentStatus } from '@ai-office/protocol';
import type { SceneArt } from './art';
import { renderBackground } from './background';
import { animationKey } from './agentView';
import { assignLooks } from './characters';
import {
  drawActivityBubble,
  drawBadge,
  drawDesk,
  drawPlate,
  drawRoomSign,
  drawSelection,
  INK,
  type SceneAgent,
} from './dynamic';
import type { OfficeLayout } from './layout';
import { roomTheme } from './rooms';

export interface SceneLabels {
  room: (roomId: string) => string;
  status: (status: AgentStatus) => string;
}

export interface SceneFrame {
  agents: readonly SceneAgent[];
  selectedId: string | null;
  hoverId: string | null;
}

/** Owns one canvas: caches the static background and redraws the live layer each frame. */
export class OfficeRenderer {
  private layout: OfficeLayout | null = null;
  private background: HTMLCanvasElement | null = null;
  private art: SceneArt | null = null;
  private looks = new Map<string, number>();
  private scale = 1;
  /** One CSS pixel in art pixels. */
  private u = 1;
  private readonly ctx: CanvasRenderingContext2D;
  /** What the canvas shows now; a frame with the same inputs is skipped. */
  private shown: { frame: SceneFrame | null; labels: SceneLabels | null; anim: string } = {
    frame: null,
    labels: null,
    anim: '',
  };

  constructor(private readonly canvas: HTMLCanvasElement) {
    const ctx = canvas.getContext('2d', { alpha: false });
    if (!ctx) throw new Error('2D canvas is not available');
    this.ctx = ctx;
  }

  /** `scale`: device pixels per art pixel; `cssPerArt`: CSS pixels per art pixel on screen. */
  configure(layout: OfficeLayout, scale: number, art: SceneArt, cssPerArt: number): void {
    this.layout = layout;
    this.scale = scale;
    this.u = 1 / cssPerArt;
    this.art = art;
    this.looks = assignLooks([...layout.seats.keys()]);
    this.canvas.width = layout.width * scale;
    this.canvas.height = layout.height * scale;
    this.background = renderBackground(layout, art);
    this.shown = { frame: null, labels: null, anim: '' };
  }

  /**
   * Redraws only when the inputs (data, selection, hover, labels) or a visible animation
   * frame changed. `still` = prefers-reduced-motion: no blinking, swaying or hopping.
   * Returns whether it drew.
   */
  draw(frame: SceneFrame, labels: SceneLabels, t: number, still: boolean): boolean {
    const { layout, background, art, ctx } = this;
    if (!layout || !background || !art) return false;
    const anim = animationKey(
      frame.agents.map((a) => a.status),
      frame.selectedId !== null,
      t,
      still,
    );
    const prev = this.shown.frame;
    const same =
      prev !== null &&
      prev.agents === frame.agents &&
      prev.selectedId === frame.selectedId &&
      prev.hoverId === frame.hoverId &&
      this.shown.labels === labels &&
      this.shown.anim === anim;
    if (same) return false;
    this.shown = { frame, labels, anim };
    ctx.setTransform(this.scale, 0, 0, this.scale, 0, 0);
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(background, 0, 0);

    const byId = new Map(frame.agents.map((a) => [a.id, a]));
    const seated = layout.rooms.flatMap((room) =>
      room.desks.flatMap((desk) => {
        const agent = byId.get(desk.agentId);
        return agent ? [{ desk, agent, look: this.looks.get(agent.id) ?? 0 }] : [];
      }),
    );

    for (const { desk, agent, look } of seated) drawDesk(ctx, desk, agent, look, art, t, still);
    for (const { desk, agent } of seated) drawPlate(ctx, desk, agent, t, still, this.u);
    // Badges go on top of every desk so a neighbour never hides them.
    for (const { desk, agent, look } of seated) drawBadge(ctx, desk, agent, look, art, t, still);
    for (const room of layout.rooms) drawRoomSign(ctx, room, labels.room(room.id), this.u);

    if (frame.hoverId && frame.hoverId !== frame.selectedId) {
      const desk = layout.seats.get(frame.hoverId);
      if (desk) drawSelection(ctx, desk, INK.bubble, t, false);
    }
    if (frame.selectedId) {
      const desk = layout.seats.get(frame.selectedId);
      const agent = byId.get(frame.selectedId);
      if (desk && agent) {
        drawSelection(ctx, desk, roomTheme(desk.roomId).accent, still ? 0 : t, true);
        drawActivityBubble(
          ctx,
          layout,
          desk,
          `${agent.name}: ${agent.activity ?? labels.status(agent.status)}`,
          this.u,
        );
      }
    }
    return true;
  }
}
