import { useBreakpoint } from '@/hooks/useBreakpoint';
import styles from './MobileTabBar.module.css';

export interface MobileTab {
  id: string;
  label: string;
  /** Optional badge count — shown as a small pill when > 0 */
  badge?: number;
}

interface MobileTabBarProps {
  tabs: MobileTab[];
  activeTab: string;
  onTabChange: (tabId: string) => void;
}

/**
 * Horizontal tab bar for switching between panels on mobile/tablet.
 * Renders inline (not fixed) — each page places it in its own layout.
 * Returns null on desktop (≥ 1024px).
 */
export function MobileTabBar({ tabs, activeTab, onTabChange }: MobileTabBarProps) {
  const { isMobileUi } = useBreakpoint();
  if (!isMobileUi) return null;

  return (
    <div className={styles.tabBar} role="tablist">
      {tabs.map((tab) => (
        <button
          key={tab.id}
          role="tab"
          aria-selected={tab.id === activeTab}
          className={`${styles.tab} ${tab.id === activeTab ? styles.tabActive : ''}`}
          onClick={() => onTabChange(tab.id)}
        >
          <span className={styles.tabLabel}>{tab.label}</span>
          {tab.badge != null && tab.badge > 0 && (
            <span className={styles.badge}>{tab.badge}</span>
          )}
        </button>
      ))}
    </div>
  );
}
