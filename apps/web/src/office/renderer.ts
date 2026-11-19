import type { AgentStatus, Quota } from '@ai-office/protocol';
import { renderBackground } from './background';
import {
  drawActivityBubble,
  drawChart,
  drawClock,
  drawDesk,
  drawDeskOverlay,
  drawQuota,
  drawRackLeds,
  drawRoomSign,
  drawSelection,
  type SceneAgent,
} from './dynamic';
import type { OfficeLayout } from './layout';
import { roomStyle, SCENE } from './roomStyles';

export interface SceneLabels {
  room: (roomId: string) => string;
  futureDesk: string;
  noQuota: string;
  status: (status: AgentStatus) => string;
}

export interface SceneFrame {
  agents: readonly SceneAgent[];
  quota: Quota | null;
  selectedId: string | null;
  hoverId: string | null;
}

/** Owns one canvas: caches the static background and redraws the live layer each frame. */
export class OfficeRenderer {
  private layout: OfficeLayout | null = null;
  private background: HTMLCanvasElement | null = null;
  private scale = 1;
  private readonly ctx: CanvasRenderingContext2D;

  constructor(private readonly canvas: HTMLCanvasElement) {
    const ctx = canvas.getContext('2d', { alpha: false });
    if (!ctx) throw new Error('2D canvas is not available');
    this.ctx = ctx;
  }

  configure(layout: OfficeLayout, scale: number): void {
    this.layout = layout;
    this.scale = scale;
    this.canvas.width = layout.width * scale;
    this.canvas.height = layout.height * scale;
    this.background = renderBackground(layout);
  }

  draw(frame: SceneFrame, labels: SceneLabels, t: number, now: Date): void {
    const { layout, background, ctx } = this;
    if (!layout || !background) return;
    ctx.setTransform(this.scale, 0, 0, this.scale, 0, 0);
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(background, 0, 0);

    const byId = new Map(frame.agents.map((a) => [a.id, a]));

    for (const room of layout.rooms) {
      drawRoomSign(ctx, room, labels.room(room.id));
      drawRackLeds(ctx, room, t);
      for (const item of room.wall) {
        if (item.kind === 'quota') drawQuota(ctx, item, frame.quota, t, labels.noQuota);
        else if (item.kind === 'chart') drawChart(ctx, item, t);
        else if (item.kind === 'clock') drawClock(ctx, item, now);
      }
      for (const desk of room.desks) {
        drawDesk(
          ctx,
          desk,
          desk.agentId ? byId.get(desk.agentId) : undefined,
          t,
          labels.futureDesk,
        );
      }
    }

    // Overlays go on top of every desk so bubbles are never hidden by a neighbour.
    for (const room of layout.rooms) {
      for (const desk of room.desks) {
        const agent = desk.agentId ? byId.get(desk.agentId) : undefined;
        if (agent) drawDeskOverlay(ctx, desk, agent, t);
      }
    }

    if (frame.hoverId && frame.hoverId !== frame.selectedId) {
      const desk = layout.seats.get(frame.hoverId);
      if (desk) drawSelection(ctx, desk, SCENE.white, t, false);
    }
    if (frame.selectedId) {
      const desk = layout.seats.get(frame.selectedId);
      const agent = byId.get(frame.selectedId);
      if (desk && agent) {
        drawSelection(ctx, desk, roomStyle(desk.roomId).accent, t, true);
        drawActivityBubble(
          ctx,
          layout,
          desk,
          `${agent.name}: ${agent.activity ?? labels.status(agent.status)}`,
        );
      }
    }
  }
}
