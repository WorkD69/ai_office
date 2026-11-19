import { useEffect, useReducer } from 'react';
import { FEED_LIMIT, type FeedEvent, type OfficeState } from '@ai-office/protocol';
import { getTelegram } from '../telegram';
import { createDemoOffice, DEMO_TICK_MS } from './demo';
import { connectLive, type Connection } from './live';

export type Mode = 'demo' | 'live';

export interface OfficeView {
  mode: Mode;
  connection: Connection;
  state: OfficeState | null;
}

type Action =
  | { type: 'state'; state: OfficeState }
  | { type: 'event'; event: FeedEvent }
  | { type: 'connection'; connection: Connection };

export function reducer(view: OfficeView, action: Action): OfficeView {
  switch (action.type) {
    case 'state':
      return { ...view, state: action.state };
    case 'connection':
      return { ...view, connection: action.connection };
    case 'event': {
      // The worker sends full `state` messages; single events are handled defensively.
      if (!view.state || view.state.feed.some((e) => e.id === action.event.id)) return view;
      const feed = [action.event, ...view.state.feed].slice(0, FEED_LIMIT);
      return { ...view, state: { ...view.state, feed } };
    }
  }
}

export type ModeChoice = { mode: 'demo' } | { mode: 'live'; initData: string };

/** Live only inside Telegram (non-empty initData) and only when `?demo` is not forced. */
export function detectMode(search: string, initData: string | null): ModeChoice {
  if (new URLSearchParams(search).has('demo') || !initData) return { mode: 'demo' };
  return { mode: 'live', initData };
}

/** Single source of office data for the UI: live WebSocket inside Telegram, demo elsewhere. */
export function useOffice(): OfficeView {
  const choice = detectMode(window.location.search, getTelegram()?.initData ?? null);
  const initData = choice.mode === 'live' ? choice.initData : null;
  const [view, dispatch] = useReducer(reducer, {
    mode: choice.mode,
    connection: choice.mode === 'demo' ? 'demo' : 'connecting',
    state: null,
  });

  useEffect(() => {
    if (initData === null) {
      const params = new URLSearchParams(window.location.search);
      // The wall clock only sets the demo's start time; everything else is seeded.
      const demo = createDemoOffice(Date.now(), {
        showcase: params.has('showcase'),
        stale: params.has('stale'),
      });
      dispatch({ type: 'state', state: demo.tick(Date.now()) });
      const id = setInterval(
        () => dispatch({ type: 'state', state: demo.tick(Date.now()) }),
        DEMO_TICK_MS,
      );
      return () => clearInterval(id);
    }
    return connectLive(initData, {
      onState: (state) => dispatch({ type: 'state', state }),
      onEvent: (event) => dispatch({ type: 'event', event }),
      onConnection: (connection) => dispatch({ type: 'connection', connection }),
    });
  }, [initData]);

  return view;
}
