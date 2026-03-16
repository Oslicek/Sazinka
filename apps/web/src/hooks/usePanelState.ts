import { useContext } from 'react';
import { PanelStateContext } from '../contexts/PanelStateContext';
import type { PanelStateContextValue } from '../types/panelState';

export function usePanelState(): PanelStateContextValue {
  const ctx = useContext(PanelStateContext);
  if (!ctx) {
    throw new Error('usePanelState must be used within a PanelStateProvider');
  }
  return ctx;
}
