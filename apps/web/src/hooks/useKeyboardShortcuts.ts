import { useEffect, useCallback, useRef } from 'react';
import i18n from '@/i18n';

export interface KeyboardShortcut {
  key: string;
  ctrl?: boolean;
  shift?: boolean;
  alt?: boolean;
  action: () => void;
  description: string;
  /** Only trigger when no input is focused */
  global?: boolean;
}

interface UseKeyboardShortcutsOptions {
  enabled?: boolean;
  /** Element to attach listener to (default: document) */
  target?: HTMLElement | null;
}

/**
 * Hook for managing keyboard shortcuts in the planner
 */
export function useKeyboardShortcuts(
  shortcuts: KeyboardShortcut[],
  options: UseKeyboardShortcutsOptions = {}
) {
  const { enabled = true, target = null } = options;
  const shortcutsRef = useRef(shortcuts);
  shortcutsRef.current = shortcuts;

  const handleKeyDown = useCallback(
    (event: KeyboardEvent) => {
      if (!enabled) return;

      // Check if we're in an input field
      const targetEl = event.target as HTMLElement;
      const isInputFocused =
        targetEl.tagName === 'INPUT' ||
        targetEl.tagName === 'TEXTAREA' ||
        targetEl.tagName === 'SELECT' ||
        targetEl.isContentEditable;

      for (const shortcut of shortcutsRef.current) {
        // Skip non-global shortcuts when input is focused
        if (isInputFocused && !shortcut.global) continue;

        const keyMatch = event.key.toLowerCase() === shortcut.key.toLowerCase();
        const ctrlMatch = !!shortcut.ctrl === (event.ctrlKey || event.metaKey);
        const shiftMatch = !!shortcut.shift === event.shiftKey;
        const altMatch = !!shortcut.alt === event.altKey;

        if (keyMatch && ctrlMatch && shiftMatch && altMatch) {
          event.preventDefault();
          shortcut.action();
          return;
        }
      }
    },
    [enabled]
  );

  useEffect(() => {
    const element = target || document;
    element.addEventListener('keydown', handleKeyDown as EventListener);
    return () => {
      element.removeEventListener('keydown', handleKeyDown as EventListener);
    };
  }, [target, handleKeyDown]);
}

/**
 * Predefined shortcuts for the planning inbox
 */
export function usePlannerShortcuts({
  onSearch,
  onGoToInbox,
  onGoToCustomers,
  onGoToDayPlan,
  onMoveUp,
  onMoveDown,
  onSelectSlot,
  onSchedule,
  onSnooze,
  onFixAddress,
  onSave,
  onEscape,
  enabled = true,
}: {
  onSearch?: () => void;
  onGoToInbox?: () => void;
  onGoToCustomers?: () => void;
  onGoToDayPlan?: () => void;
  onMoveUp?: () => void;
  onMoveDown?: () => void;
  onSelectSlot?: (index: number) => void;
  onSchedule?: () => void;
  onSnooze?: () => void;
  onFixAddress?: () => void;
  onSave?: () => void;
  onEscape?: () => void;
  enabled?: boolean;
}) {
  const shortcuts: KeyboardShortcut[] = [];

  // Global shortcuts (work even in inputs)
  if (onEscape) {
    shortcuts.push({
      key: 'Escape',
      action: onEscape,
      description: i18n.t('planner:shortcut_escape'),
      global: true,
    });
  }

  // Navigation shortcuts
  if (onSearch) {
    shortcuts.push({
      key: '/',
      action: onSearch,
      description: i18n.t('planner:shortcut_search'),
    });
  }

  // g + key shortcuts (go to...)
  // Note: For multi-key shortcuts, you'd need to track state
  // For simplicity, using single keys here

  // Arrow navigation
  if (onMoveUp) {
    shortcuts.push({
      key: 'ArrowUp',
      action: onMoveUp,
      description: i18n.t('planner:shortcut_prev'),
    });
  }

  if (onMoveDown) {
    shortcuts.push({
      key: 'ArrowDown',
      action: onMoveDown,
      description: i18n.t('planner:shortcut_next'),
    });
  }

  // Slot selection (1-5)
  if (onSelectSlot) {
    for (let i = 1; i <= 5; i++) {
      shortcuts.push({
        key: String(i),
        action: () => onSelectSlot(i - 1),
        description: i18n.t('planner:shortcut_select_slot', { index: i }),
      });
    }
  }

  // Action shortcuts
  if (onSchedule) {
    shortcuts.push({
      key: 'd',
      action: onSchedule,
      description: i18n.t('planner:shortcut_schedule'),
    });
  }

  if (onSnooze) {
    shortcuts.push({
      key: 'o',
      action: onSnooze,
      description: i18n.t('planner:shortcut_snooze'),
    });
  }

  if (onFixAddress) {
    shortcuts.push({
      key: 'e',
      action: onFixAddress,
      description: i18n.t('planner:shortcut_fix_address'),
    });
  }

  // Save shortcut (Ctrl+S)
  if (onSave) {
    shortcuts.push({
      key: 's',
      ctrl: true,
      action: onSave,
      description: i18n.t('planner:shortcut_save'),
      global: true,
    });
  }

  useKeyboardShortcuts(shortcuts, { enabled });

  // Return list of shortcuts for displaying in UI
  return shortcuts;
}

/**
 * Component to display available keyboard shortcuts
 */
export function getShortcutLabel(shortcut: KeyboardShortcut): string {
  const parts: string[] = [];
  
  if (shortcut.ctrl) parts.push('Ctrl');
  if (shortcut.shift) parts.push('Shift');
  if (shortcut.alt) parts.push('Alt');
  
  // Format special keys
  let key = shortcut.key;
  if (key === 'ArrowUp') key = '↑';
  else if (key === 'ArrowDown') key = '↓';
  else if (key === 'ArrowLeft') key = '←';
  else if (key === 'ArrowRight') key = '→';
  else if (key === 'Escape') key = 'Esc';
  else if (key === 'Enter') key = '↵';
  else key = key.toUpperCase();
  
  parts.push(key);
  
  return parts.join('+');
}
