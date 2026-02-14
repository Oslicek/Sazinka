import { useCallback, useRef, forwardRef } from 'react';
import { useTranslation } from 'react-i18next';
import { Virtuoso, type VirtuosoHandle } from 'react-virtuoso';
import { CandidateRow, type CandidateRowData } from './CandidateRow';
import styles from './VirtualizedInboxList.module.css';

interface VirtualizedInboxListProps {
  candidates: CandidateRowData[];
  selectedCandidateId: string | null;
  onCandidateSelect: (id: string) => void;
  onLoadMore?: () => void;
  hasMore?: boolean;
  isLoading?: boolean;
  emptyMessage?: string;
  className?: string;
  /** Enable checkboxes for batch selection */
  selectable?: boolean;
  /** Currently checked candidate IDs */
  selectedIds?: Set<string>;
  /** Called when a checkbox is toggled */
  onSelectionChange?: (id: string, selected: boolean) => void;
  /** Candidate IDs already added to the route */
  inRouteIds?: Set<string>;
}

export interface VirtualizedInboxListRef {
  scrollToIndex: (index: number) => void;
  scrollToTop: () => void;
}

export const VirtualizedInboxList = forwardRef<VirtualizedInboxListRef, VirtualizedInboxListProps>(
  function VirtualizedInboxList(
    {
      candidates,
      selectedCandidateId,
      onCandidateSelect,
      onLoadMore,
      hasMore,
      isLoading,
      emptyMessage,
      className,
      selectable = false,
      selectedIds,
      onSelectionChange,
      inRouteIds,
    },
    ref
  ) {
    const { t } = useTranslation('planner');
    const virtuosoRef = useRef<VirtuosoHandle>(null);

    // Expose scroll methods via ref
    if (ref && typeof ref === 'object') {
      ref.current = {
        scrollToIndex: (index: number) => {
          virtuosoRef.current?.scrollToIndex({
            index,
            align: 'center',
            behavior: 'smooth',
          });
        },
        scrollToTop: () => {
          virtuosoRef.current?.scrollToIndex({
            index: 0,
            behavior: 'smooth',
          });
        },
      };
    }

    // Handle keyboard navigation
    const handleKeyDown = useCallback(
      (e: React.KeyboardEvent, index: number) => {
        if (e.key === 'ArrowDown' && index < candidates.length - 1) {
          e.preventDefault();
          const nextId = candidates[index + 1].id;
          onCandidateSelect(nextId);
          virtuosoRef.current?.scrollToIndex({
            index: index + 1,
            align: 'center',
            behavior: 'smooth',
          });
        } else if (e.key === 'ArrowUp' && index > 0) {
          e.preventDefault();
          const prevId = candidates[index - 1].id;
          onCandidateSelect(prevId);
          virtuosoRef.current?.scrollToIndex({
            index: index - 1,
            align: 'center',
            behavior: 'smooth',
          });
        } else if (e.key === 'Enter') {
          // Enter could trigger primary action (e.g., schedule)
          e.preventDefault();
        }
      },
      [candidates, onCandidateSelect]
    );

    // Render item
    const itemContent = useCallback(
      (index: number, candidate: CandidateRowData) => (
        <div className={styles.itemWrapper}>
          <CandidateRow
            candidate={candidate}
            isSelected={selectedCandidateId === candidate.id}
            onClick={() => onCandidateSelect(candidate.id)}
            onKeyDown={(e) => handleKeyDown(e, index)}
            selectable={selectable}
            checked={selectedIds?.has(candidate.id) ?? false}
            onCheckChange={onSelectionChange ? (checked) => onSelectionChange(candidate.id, checked) : undefined}
            isInRoute={inRouteIds?.has(candidate.id) ?? false}
          />
        </div>
      ),
      [selectedCandidateId, onCandidateSelect, handleKeyDown, selectable, selectedIds, onSelectionChange, inRouteIds]
    );

    // Footer component (loading / load more)
    const Footer = useCallback(() => {
      if (isLoading) {
        return (
          <div className={styles.footer}>
            <div className={styles.spinner} />
            <span>{t('inbox_loading')}</span>
          </div>
        );
      }
      if (hasMore && onLoadMore) {
        return (
          <div className={styles.footer}>
            <button
              type="button"
              className={styles.loadMoreButton}
              onClick={onLoadMore}
            >
              {t('inbox_load_more')}
            </button>
          </div>
        );
      }
      return null;
    }, [isLoading, hasMore, onLoadMore, t]);

    // Empty state
    if (candidates.length === 0 && !isLoading) {
      return (
        <div className={`${styles.container} ${className ?? ''}`}>
          <div className={styles.empty}>
            <span className={styles.emptyIcon}>📭</span>
            <p>{emptyMessage ?? t('inbox_empty')}</p>
          </div>
        </div>
      );
    }

    return (
      <div className={`${styles.container} ${className ?? ''}`}>
        <Virtuoso
          ref={virtuosoRef}
          data={candidates}
          itemContent={itemContent}
          components={{
            Footer,
          }}
          overscan={200}
          increaseViewportBy={{ top: 100, bottom: 100 }}
          className={styles.list}
        />
      </div>
    );
  }
);
