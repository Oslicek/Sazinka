import { PanelStateProvider } from '@/contexts/PanelStateContext';
import {
  RouteMapPanel,
  RouteTimelinePanel,
  CustomerDetailPanel,
  InboxListPanel,
  RouteListPanel,
} from '@/panels';

interface DetachedPanelPageProps {
  panel: 'map' | 'detail' | 'route' | 'list' | 'routeList';
  pageContext: 'inbox' | 'plan';
}

function PanelSwitch({ panel, pageContext }: DetachedPanelPageProps) {
  switch (panel) {
    case 'map':
      return <RouteMapPanel />;
    case 'route':
      return <RouteTimelinePanel />;
    case 'detail':
      return <CustomerDetailPanel mode={pageContext} />;
    case 'list':
      return <InboxListPanel />;
    case 'routeList':
      return <RouteListPanel />;
  }
}

export function DetachedPanelPage({ panel, pageContext }: DetachedPanelPageProps) {
  return (
    <PanelStateProvider enableChannel={true} activePageContext={pageContext}>
      <div style={{ width: '100vw', height: '100vh' }}>
        <PanelSwitch panel={panel} pageContext={pageContext} />
      </div>
    </PanelStateProvider>
  );
}
