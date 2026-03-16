import { useState } from 'react';
import { RouteListPanel as RouteListPanelUI } from '@/components/planner';
import { usePanelState } from '@/hooks/usePanelState';
import type { SavedRoute } from '@/services/routeService';

interface RouteListPanelProps {
  onDeleteRoute?: (routeId: string) => void;
  /** Override internal routes — used by tests and in A.7 will be removed in favour of NATS loading */
  routes?: SavedRoute[];
  /** Override internal loading state */
  isLoading?: boolean;
}

export function RouteListPanel({
  onDeleteRoute: _onDeleteRoute,
  routes: routesProp,
  isLoading: isLoadingProp,
}: RouteListPanelProps) {
  const { state, actions } = usePanelState();

  // LOCAL state — stubs until A.7 migrates NATS loading here
  const [routes] = useState<SavedRoute[]>([]);
  const [isLoadingRoutes] = useState(false);

  const resolvedRoutes = routesProp ?? routes;
  const resolvedIsLoading = isLoadingProp ?? isLoadingRoutes;

  return (
    <RouteListPanelUI
      routes={resolvedRoutes}
      selectedRouteId={state.selectedRouteId}
      onSelectRoute={(id) => {
        actions.selectRoute(id);
      }}
      isLoading={resolvedIsLoading}
    />
  );
}
