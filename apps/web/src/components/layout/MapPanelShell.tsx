/**
 * Shared map panel wrapper used by both PlanningInbox and Plan.
 *
 * Renders an optional DetachButton in a controls div that is offset left of
 * the MapLibre NavigationControl column (top-right), so the two button stacks
 * never overlap.
 *
 * Pass `onDetach` + `canDetach` to override the default hook-based detach
 * (useful for testing; production callers omit them and get hook behaviour).
 */
import { useDetachState } from '@/hooks/useDetachState';
import { DetachButton } from './DetachButton';
import styles from './MapPanelShell.module.css';

interface MapPanelShellProps {
  panelName: string;
  children: React.ReactNode;
  /** Optional detach override — when provided, replaces the useDetachState hook call. */
  onDetach?: () => void;
  /** When provided together with onDetach, controls whether the detach button is shown. */
  canDetach?: boolean;
}

export function MapPanelShell({ panelName, children, onDetach, canDetach: canDetachProp }: MapPanelShellProps) {
  const hookState = useDetachState();
  const canDetach = canDetachProp !== undefined ? canDetachProp : hookState.canDetach;
  const handleDetach = onDetach ?? (() => hookState.detach(panelName as Parameters<typeof hookState.detach>[0]));

  return (
    <div data-testid="map-panel-shell" className={styles.shell}>
      {canDetach && (
        <div data-testid="map-panel-shell-controls" className={styles.controls}>
          <DetachButton
            data-testid={`detach-${panelName}-btn`}
            onDetach={handleDetach}
          />
        </div>
      )}
      <div data-testid="map-panel-shell-content" className={styles.content}>
        {children}
      </div>
    </div>
  );
}
