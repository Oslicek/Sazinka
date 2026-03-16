import { useEffect, useRef, useState } from 'react';
import { PanelStateProvider } from '@/contexts/PanelStateContext';
import { RouteMapPanel } from '@/panels/RouteMapPanel';
import { InboxListPanel } from '@/panels/InboxListPanel';
import { usePanelSignals } from '@/hooks/usePanelSignals';
import type { PanelSignal } from '@/types/panelSignals';
import type { RouteContext } from '@/types/panelState';

export type DetachablePanelId = 'map' | 'list';

interface UrlSeed {
  date: string;
  crewId: string;
  depotId: string;
}

interface DetachedPanelPageProps {
  panel: DetachablePanelId;
  pageContext: 'inbox' | 'plan';
  /** URL-seeded context for immediate load (parsed from query params) */
  urlSeed?: UrlSeed;
  /** How long to wait for CONTEXT_SNAPSHOT before falling back to URL seed (ms) */
  snapshotTimeoutMs?: number;
}

const DEFAULT_SNAPSHOT_TIMEOUT = 2000;

function PanelSwitch({ panel }: { panel: DetachablePanelId }) {
  switch (panel) {
    case 'map':
      return <RouteMapPanel />;
    case 'list':
      return <InboxListPanel />;
    default:
      return null;
  }
}

/**
 * Wrapper for panels opened in detached windows.
 * - Parses URL-seeded context for immediate load
 * - Requests CONTEXT_SNAPSHOT from main window on mount
 * - Overrides URL seed if snapshot arrives within timeout
 * - Sends PANEL_REATTACHED on window beforeunload
 */
export function DetachedPanelPage({
  panel,
  pageContext,
  urlSeed,
  snapshotTimeoutMs = DEFAULT_SNAPSHOT_TIMEOUT,
}: DetachedPanelPageProps) {
  const [routeContext, setRouteContext] = useState<RouteContext | null>(() => {
    if (!urlSeed) return null;
    return {
      date: urlSeed.date,
      crewId: urlSeed.crewId,
      depotId: urlSeed.depotId,
      crewName: '',
      depotName: '',
    };
  });

  const snapshotReceivedRef = useRef(false);
  const [snapshotTimedOut, setSnapshotTimedOut] = useState(false);

  const onSignal = (signal: PanelSignal) => {
    if (signal.type === 'CONTEXT_SNAPSHOT' && !snapshotReceivedRef.current) {
      snapshotReceivedRef.current = true;
      if (signal.routeContext) {
        setRouteContext({
          date: signal.routeContext.date,
          crewId: signal.routeContext.crewId,
          depotId: signal.routeContext.depotId,
          crewName: '',
          depotName: '',
        });
      }
    }
  };

  const { sendSignal } = usePanelSignals({
    enabled: true,
    isSourceOfTruth: false,
    onSignal,
  });

  const sendSignalRef = useRef(sendSignal);
  sendSignalRef.current = sendSignal;

  // Request snapshot on mount
  useEffect(() => {
    sendSignalRef.current({ type: 'REQUEST_CONTEXT_SNAPSHOT' });

    // Snapshot timeout — after this, URL seed persists
    const timer = setTimeout(() => {
      setSnapshotTimedOut(true);
    }, snapshotTimeoutMs);

    return () => clearTimeout(timer);
  }, [snapshotTimeoutMs]);

  // Send PANEL_REATTACHED on window close
  useEffect(() => {
    const handleBeforeUnload = () => {
      sendSignalRef.current({ type: 'PANEL_REATTACHED', panel, page: pageContext });
    };
    window.addEventListener('beforeunload', handleBeforeUnload);
    return () => window.removeEventListener('beforeunload', handleBeforeUnload);
  }, [panel, pageContext]);

  const isValidPanel = panel === 'map' || panel === 'list';

  return (
    <PanelStateProvider
      enableChannel={true}
      isSourceOfTruth={false}
      activePageContext={pageContext}
      initialRouteContext={routeContext}
    >
      <div
        data-testid="detached-panel-chrome"
        style={{ width: '100vw', height: '100vh', display: 'flex', flexDirection: 'column' }}
      >
        <div style={{ padding: '4px 8px', fontSize: '12px', background: '#f0f0f0', flexShrink: 0 }}>
          {panel === 'map' ? 'Map' : 'List'} — detached
          {!snapshotTimedOut && !snapshotReceivedRef.current && ' (syncing…)'}
        </div>
        <div style={{ flex: 1, overflow: 'hidden' }}>
          {isValidPanel ? <PanelSwitch panel={panel} /> : null}
        </div>
      </div>
    </PanelStateProvider>
  );
}
