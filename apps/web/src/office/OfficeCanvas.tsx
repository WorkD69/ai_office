import {
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type MouseEvent as ReactMouseEvent,
} from 'react';
import type { Agent, Quota } from '@ai-office/protocol';
import { chooseGrid, hitTest, type OfficeLayout } from './layout';
import { OfficeRenderer, type SceneLabels } from './renderer';

interface Props {
  agents: readonly Agent[];
  quota: Quota | null;
  selectedId: string | null;
  onSelect: (id: string | null) => void;
  labels: SceneLabels;
  ariaLabel: string;
  /** `fit` shows the whole office; `scroll` (phones) keeps it large and pans sideways. */
  mode: 'fit' | 'scroll';
  statusLabel: (agent: Agent) => string;
  /** Shown instead of the scene when the device cannot give us a 2D canvas. */
  unavailableText: string;
}

const FRAME_MS = 1000 / 30;

interface Size {
  width: number;
  height: number;
  dpr: number;
}

export function OfficeCanvas({
  agents,
  quota,
  selectedId,
  onSelect,
  labels,
  ariaLabel,
  mode,
  statusLabel,
  unavailableText,
}: Props) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const rendererRef = useRef<OfficeRenderer | null>(null);
  const [size, setSize] = useState<Size | null>(null);
  const [hover, setHover] = useState<{ id: string; x: number; y: number } | null>(null);
  const [failed, setFailed] = useState(false);

  // The animation loop reads the latest props through a ref so it never has to restart.
  // Updated in a layout effect (not during render) so React can safely re-run renders.
  const hoverId = hover?.id ?? null;
  const frameRef = useRef({ agents, quota, selectedId, hoverId, labels });
  useLayoutEffect(() => {
    frameRef.current = { agents, quota, selectedId, hoverId, labels };
  }, [agents, quota, selectedId, hoverId, labels]);

  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const measure = () =>
      setSize({
        width: el.clientWidth,
        height: el.clientHeight,
        dpr: window.devicePixelRatio || 1,
      });
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // Layout depends only on who sits where, not on statuses. Ids and rooms are restricted by the
  // protocol to [a-z0-9-], so "@" and "|" are safe separators for a stable memo key.
  const seatKey = agents.map((a) => `${a.id}@${a.room}`).join('|');
  const seats = useMemo(
    () =>
      seatKey === ''
        ? []
        : seatKey.split('|').map((pair) => {
            const [id = '', room = ''] = pair.split('@');
            return { id, room };
          }),
    [seatKey],
  );
  const grid = useMemo(() => {
    if (!size || size.width === 0 || size.height === 0) return null;
    return chooseGrid(seats, size, mode);
  }, [seats, size, mode]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !grid || !size || failed) return;
    if (!rendererRef.current) {
      try {
        rendererRef.current = new OfficeRenderer(canvas);
      } catch (err) {
        console.error('Office renderer unavailable', err);
        setFailed(true);
        return;
      }
    }
    rendererRef.current.configure(grid.layout, grid.scale);
    canvas.style.width = `${(grid.layout.width * grid.scale) / size.dpr}px`;
    canvas.style.height = `${(grid.layout.height * grid.scale) / size.dpr}px`;
  }, [grid, size, failed]);

  useEffect(() => {
    let raf = 0;
    let last = 0;
    const loop = (t: number) => {
      raf = requestAnimationFrame(loop);
      if (t - last < FRAME_MS) return;
      last = t;
      const f = frameRef.current;
      rendererRef.current?.draw(f, f.labels, t, new Date());
    };
    const start = () => {
      cancelAnimationFrame(raf);
      if (!document.hidden) raf = requestAnimationFrame(loop);
    };
    start();
    document.addEventListener('visibilitychange', start);
    return () => {
      cancelAnimationFrame(raf);
      document.removeEventListener('visibilitychange', start);
    };
  }, []);

  // Keep the selected desk visible when the office is wider than the screen.
  useEffect(() => {
    const wrap = wrapRef.current;
    if (!wrap || !grid || !size || !selectedId || mode !== 'scroll') return;
    const desk = grid.layout.seats.get(selectedId);
    if (!desk) return;
    const cssScale = grid.scale / size.dpr;
    const centre = (desk.x + desk.w / 2) * cssScale;
    wrap.scrollTo({ left: centre - wrap.clientWidth / 2, behavior: 'smooth' });
  }, [selectedId, grid, size, mode]);

  const toLogical = (e: ReactMouseEvent<HTMLCanvasElement>, layout: OfficeLayout) => {
    const rect = e.currentTarget.getBoundingClientRect();
    return {
      x: ((e.clientX - rect.left) / rect.width) * layout.width,
      y: ((e.clientY - rect.top) / rect.height) * layout.height,
      cssX: e.clientX - rect.left,
      cssY: e.clientY - rect.top,
    };
  };

  const hoveredAgent = hover ? agents.find((a) => a.id === hover.id) : undefined;

  if (failed) return <div className="scene__fallback">{unavailableText}</div>;

  return (
    <div ref={wrapRef} className={`office-wrap office-wrap--${mode}`}>
      <div className="office-stage">
        <canvas
          ref={canvasRef}
          className="office-canvas"
          role="img"
          aria-label={ariaLabel}
          style={{ cursor: hover ? 'pointer' : 'default' }}
          onPointerMove={(e) => {
            if (!grid || e.pointerType !== 'mouse') return;
            const p = toLogical(e, grid.layout);
            const id = hitTest(grid.layout, p.x, p.y);
            setHover(id ? { id, x: p.cssX, y: p.cssY } : null);
          }}
          onPointerLeave={() => setHover(null)}
          onClick={(e) => {
            if (!grid) return;
            const p = toLogical(e, grid.layout);
            onSelect(hitTest(grid.layout, p.x, p.y));
          }}
        />
        {hover && hoveredAgent && (
          <div
            className="office-tooltip"
            style={{ left: hover.x + 14, top: hover.y + 14 }}
            role="tooltip"
          >
            <strong>{hoveredAgent.name}</strong>
            <span>{statusLabel(hoveredAgent)}</span>
            {hoveredAgent.activity && <em>{hoveredAgent.activity}</em>}
          </div>
        )}
      </div>
    </div>
  );
}
