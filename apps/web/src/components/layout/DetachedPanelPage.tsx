import { PanelStateProvider } from '@/contexts/PanelStateContext';
import { RouteMapPanel } from '@/panels/RouteMapPanel';
import { InboxListPanel } from '@/panels/InboxListPanel';

export type DetachablePanelId = 'map' | 'list';

interface DetachedPanelPageProps {
  panel: DetachablePanelId;
  pageContext: 'inbox' | 'plan';
}

function PanelSwitch({ panel, pageContext }: DetachedPanelPageProps) {
  switch (panel) {
    case 'map':
      return <RouteMapPanel />;
    case 'list':
      return <InboxListPanel />;
    default:
      return null;
  }
  // pageContext will be used in G.6 for NATS bootstrap
  void pageContext;
}

export function DetachedPanelPage({ panel, pageContext }: DetachedPanelPageProps) {
  return (
    <PanelStateProvider
      enableChannel={true}
      isSourceOfTruth={false}
      activePageContext={pageContext}
    >
      <div style={{ width: '100vw', height: '100vh' }}>
        <PanelSwitch panel={panel} pageContext={pageContext} />
      </div>
    </PanelStateProvider>
  );
}
