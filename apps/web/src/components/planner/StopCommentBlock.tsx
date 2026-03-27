import { useTranslation } from 'react-i18next';
import { AlertTriangle } from 'lucide-react';
import { formatDate } from '@/i18n/formatters';
import type { LastVisitCommentData } from '@/hooks/useLastVisitComment';
import styles from './StopCommentBlock.module.css';

interface StopCommentBlockProps {
  comment: LastVisitCommentData;
}

export function StopCommentBlock({ comment }: StopCommentBlockProps) {
  const { t } = useTranslation('planner');

  if (!comment.notes) return null;

  return (
    <div className={styles.stopComment} data-testid="stop-comment">
      <div className={styles.stopCommentHeader}>
        <span className={styles.stopCommentLabel}>{t('timeline_stop_comment_label')}</span>
        {comment.visit && (
          <span className={styles.stopCommentDate}>{formatDate(comment.visit.scheduledDate)}</span>
        )}
      </div>
      <p
        className={styles.stopCommentText}
        title={comment.notes}
      >
        {comment.notes}
      </p>
      {comment.visit?.requiresFollowUp && comment.visit.followUpReason && (
        <div className={styles.stopCommentFollowUp}>
          <AlertTriangle size={12} />
          <span>{comment.visit.followUpReason}</span>
        </div>
      )}
    </div>
  );
}
