import { useState, useRef, useEffect, useCallback } from 'react';
import { usePanelState } from './usePanelState';
import { usePanelSignals } from './usePanelSignals';
import type { PanelSignal } from '../types/panelSignals';

type DetachablePanel = 'map' | 'list';

/** Panels detachable per page context */
const DETACHABLE_BY_PAGE: Record<'inbox' | 'plan', DetachablePanel[]> = {
  inbox: ['map', 'list'],
  plan: ['map'],
};

const WINDOW_FEATURES = 'width=900,height=700,menubar=no,toolbar=no';

export interface DetachStateReturn {
  isDetached(panel: DetachablePanel): boolean;
  detach(panel: DetachablePanel): void;
  reattach(panel: DetachablePanel): void;
  canDetach: boolean;
}

export function useDetachState(): DetachStateReturn {
  const { state } = usePanelState();
  const { activePageContext, routeContext } = state;

  const [detachedPanels, setDetachedPanels] = useState<Set<DetachablePanel>>(new Set());
  const windowRefs = useRef<Map<DetachablePanel, Window>>(new Map());
  const pollRefs = useRef<Map<DetachablePanel, ReturnType<typeof setInterval>>>(new Map());

  const stopPoll = useCallback((panel: DetachablePanel) => {
    const id = pollRefs.current.get(panel);
    if (id !== undefined) {
      clearInterval(id);
      pollRefs.current.delete(panel);
    }
  }, []);

  const markReattached = useCallback((panel: DetachablePanel) => {
    stopPoll(panel);
    windowRefs.current.delete(panel);
    setDetachedPanels(prev => {
      const next = new Set(prev);
      next.delete(panel);
      return next;
    });
  }, [stopPoll]);

  const onSignal = useCallback((signal: PanelSignal) => {
    if (signal.type === 'PANEL_DETACHED' && signal.page === activePageContext) {
      setDetachedPanels(prev => new Set([...prev, signal.panel as DetachablePanel]));
    }
    if (signal.type === 'PANEL_REATTACHED' && signal.page === activePageContext) {
      setDetachedPanels(prev => {
        const next = new Set(prev);
        next.delete(signal.panel as DetachablePanel);
        return next;
      });
    }
  }, [activePageContext]);

  const { sendSignal } = usePanelSignals({
    enabled: true,
    isSourceOfTruth: false,
    onSignal,
  });

  const sendSignalRef = useRef(sendSignal);
  sendSignalRef.current = sendSignal;

  const detach = useCallback((panel: DetachablePanel) => {
    const ctx = routeContext;
    const params = new URLSearchParams({ page: activePageContext });
    if (ctx?.date) params.set('date', ctx.date);
    if (ctx?.crewId) params.set('crewId', ctx.crewId);
    if (ctx?.depotId) params.set('depotId', ctx.depotId);

    const url = `/panel/${panel}?${params.toString()}`;
    const win = window.open(url, `sazinka-panel-${panel}`, WINDOW_FEATURES);
    if (!win) {
      console.warn(`useDetachState: popup blocked for panel "${panel}"`);
      return;
    }

    windowRefs.current.set(panel, win);
    setDetachedPanels(prev => new Set([...prev, panel]));
    sendSignalRef.current({ type: 'PANEL_DETACHED', panel, page: activePageContext });

    const id = setInterval(() => {
      if (win.closed) {
        markReattached(panel);
        sendSignalRef.current({ type: 'PANEL_REATTACHED', panel, page: activePageContext });
      }
    }, 1000);
    pollRefs.current.set(panel, id);
  }, [activePageContext, routeContext, markReattached]);

  const reattach = useCallback((panel: DetachablePanel) => {
    const win = windowRefs.current.get(panel);
    if (win && !win.closed) win.close();
    markReattached(panel);
    sendSignalRef.current({ type: 'PANEL_REATTACHED', panel, page: activePageContext });
  }, [activePageContext, markReattached]);

  // Cleanup on unmount (page navigation)
  useEffect(() => {
    return () => {
      for (const [panel, win] of windowRefs.current.entries()) {
        if (!win.closed) win.close();
        sendSignalRef.current({ type: 'PANEL_REATTACHED', panel, page: activePageContext });
      }
      for (const id of pollRefs.current.values()) clearInterval(id);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const detachable = DETACHABLE_BY_PAGE[activePageContext];
  const canDetach = detachable.some(p => !detachedPanels.has(p));

  return {
    isDetached: (panel) => detachedPanels.has(panel),
    detach,
    reattach,
    canDetach,
  };
}
