/**
 * Dialog for displaying structured import reports
 * Shows summary, error/warning breakdown, and detailed issue list
 */
import { useState, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import type { ImportReport, ImportIssue, ImportIssueCode, ImportIssueSummary } from '@shared/import';
import styles from './ImportReportDialog.module.css';

interface ImportReportDialogProps {
  report: ImportReport;
  onClose: () => void;
}

// i18n keys for issue codes
const ISSUE_CODE_KEYS: Record<ImportIssueCode, string> = {
  CUSTOMER_NOT_FOUND: 'report_code_customer_not_found',
  DEVICE_NOT_FOUND: 'report_code_device_not_found',
  DUPLICATE_RECORD: 'report_code_duplicate_record',
  MISSING_FIELD: 'report_code_missing_field',
  INVALID_DATE: 'report_code_invalid_date',
  INVALID_VALUE: 'report_code_invalid_value',
  INVALID_STATUS: 'report_code_invalid_status',
  INVALID_RESULT: 'report_code_invalid_result',
  DB_ERROR: 'report_code_db_error',
  PARSE_ERROR: 'report_code_parse_error',
  UNKNOWN: 'report_code_unknown',
};

// i18n keys for job types
const JOB_TYPE_KEYS: Record<string, string> = {
  'import.customer': 'report_job_customer',
  'import.device': 'report_job_device',
  'import.revision': 'report_job_revision',
  'import.communication': 'report_job_communication',
  'import.visit': 'report_job_visit',
  'import.zip': 'report_job_zip',
};

function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms} ms`;
  const seconds = Math.round(ms / 1000);
  if (seconds < 60) return `${seconds} s`;
  const minutes = Math.floor(seconds / 60);
  const secs = seconds % 60;
  return `${minutes} min ${secs} s`;
}

function formatDate(isoString: string): string {
  try {
    const d = new Date(isoString);
    return d.toLocaleString(undefined);
  } catch {
    return isoString;
  }
}

/** Aggregate issues by code for summary display */
function summarizeIssues(issues: ImportIssue[]): ImportIssueSummary[] {
  const map = new Map<string, ImportIssueSummary>();
  for (const issue of issues) {
    const key = `${issue.code}:${issue.level}`;
    const existing = map.get(key);
    if (existing) {
      existing.count++;
    } else {
      map.set(key, {
        code: issue.code,
        level: issue.level,
        count: 1,
        exampleMessage: issue.message,
      });
    }
  }
  // Sort: errors first, then warnings, then info
  const levelOrder = { error: 0, warning: 1, info: 2 };
  return Array.from(map.values()).sort((a, b) => {
    const la = levelOrder[a.level] ?? 3;
    const lb = levelOrder[b.level] ?? 3;
    if (la !== lb) return la - lb;
    return b.count - a.count;
  });
}

export function ImportReportDialog({ report, onClose }: ImportReportDialogProps) {
  const { t } = useTranslation('import');
  const [showDetails, setShowDetails] = useState(false);
  const [filterCode, setFilterCode] = useState<ImportIssueCode | null>(null);

  const summary = useMemo(() => summarizeIssues(report.issues), [report.issues]);

  const errorCount = report.issues.filter(i => i.level === 'error').length;
  const warningCount = report.issues.filter(i => i.level === 'warning').length;

  const filteredIssues = useMemo(() => {
    if (!filterCode) return report.issues;
    return report.issues.filter(i => i.code === filterCode);
  }, [report.issues, filterCode]);

  // Determine overall status
  const hasErrors = errorCount > 0;
  const hasWarnings = warningCount > 0;
  const statusClass = hasErrors ? styles.statusError : hasWarnings ? styles.statusWarning : styles.statusSuccess;
  const statusText = hasErrors ? t('report_status_errors') : hasWarnings ? t('report_status_warnings') : t('report_status_success');

  return (
    <div className={styles.overlay} onClick={onClose}>
      <div className={styles.dialog} onClick={e => e.stopPropagation()}>
        {/* Header */}
        <div className={styles.header}>
          <div>
            <h2 className={styles.title}>{t('report_title')}</h2>
            <p className={styles.subtitle}>
              {t(JOB_TYPE_KEYS[report.jobType] || report.jobType)} &mdash; {report.filename}
            </p>
          </div>
          <button className={styles.closeButton} onClick={onClose} aria-label={t('report_close')}>
            &times;
          </button>
        </div>

        {/* Status bar */}
        <div className={`${styles.statusBar} ${statusClass}`}>
          {statusText}
        </div>

        {/* Summary stats */}
        <div className={styles.statsGrid}>
          <div className={styles.statCard}>
            <div className={styles.statValue}>{report.totalRows}</div>
            <div className={styles.statLabel}>{t('report_total_rows')}</div>
          </div>
          <div className={`${styles.statCard} ${styles.statSuccess}`}>
            <div className={styles.statValue}>{report.importedCount}</div>
            <div className={styles.statLabel}>{t('report_imported')}</div>
          </div>
          {report.updatedCount > 0 && (
            <div className={`${styles.statCard} ${styles.statInfo}`}>
              <div className={styles.statValue}>{report.updatedCount}</div>
              <div className={styles.statLabel}>{t('report_updated')}</div>
            </div>
          )}
          {report.skippedCount > 0 && (
            <div className={`${styles.statCard} ${styles.statWarning}`}>
              <div className={styles.statValue}>{report.skippedCount}</div>
              <div className={styles.statLabel}>{t('report_skipped')}</div>
            </div>
          )}
          {errorCount > 0 && (
            <div className={`${styles.statCard} ${styles.statError}`}>
              <div className={styles.statValue}>{errorCount}</div>
              <div className={styles.statLabel}>{t('report_errors')}</div>
            </div>
          )}
          {warningCount > 0 && (
            <div className={`${styles.statCard} ${styles.statWarning}`}>
              <div className={styles.statValue}>{warningCount}</div>
              <div className={styles.statLabel}>{t('report_warnings')}</div>
            </div>
          )}
        </div>

        {/* Meta info */}
        <div className={styles.metaRow}>
          <span>{t('report_date')} {formatDate(report.importedAt)}</span>
          <span>{t('report_duration')} {formatDuration(report.durationMs)}</span>
        </div>

        {/* Issue summary (aggregated by code) */}
        {summary.length > 0 && (
          <div className={styles.section}>
            <h3 className={styles.sectionTitle}>{t('report_issues_title')}</h3>
            <div className={styles.issueSummaryList}>
              {summary.map((s, i) => (
                <button
                  key={i}
                  className={`${styles.issueSummaryItem} ${
                    s.level === 'error' ? styles.issueError : 
                    s.level === 'warning' ? styles.issueWarning : styles.issueInfo
                  } ${filterCode === s.code ? styles.issueSummaryActive : ''}`}
                  onClick={() => {
                    setFilterCode(filterCode === s.code ? null : s.code);
                    setShowDetails(true);
                  }}
                >
                  <span className={styles.issueSummaryCode}>
                    {t(ISSUE_CODE_KEYS[s.code]) || s.code}
                  </span>
                  <span className={styles.issueSummaryCount}>{s.count}x</span>
                </button>
              ))}
            </div>
          </div>
        )}

        {/* Detailed issue list (collapsible) */}
        {report.issues.length > 0 && (
          <div className={styles.section}>
            <button
              className={styles.detailsToggle}
              onClick={() => setShowDetails(!showDetails)}
            >
              {showDetails ? '▼' : '▶'} {t('report_details_toggle')} ({filteredIssues.length}
              {filterCode ? ` — ${t(ISSUE_CODE_KEYS[filterCode])}` : ''})
              {filterCode && (
                <span
                  className={styles.clearFilter}
                  onClick={(e) => { e.stopPropagation(); setFilterCode(null); }}
                >
                  {t('report_clear_filter')}
                </span>
              )}
            </button>
            {showDetails && (
              <div className={styles.issueList}>
                <table className={styles.issueTable}>
                  <thead>
                    <tr>
                      <th>{t('report_col_row')}</th>
                      <th>{t('report_col_type')}</th>
                      <th>{t('report_col_code')}</th>
                      <th>{t('report_col_field')}</th>
                      <th>{t('report_col_message')}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filteredIssues.slice(0, 200).map((issue, i) => (
                      <tr key={i} className={
                        issue.level === 'error' ? styles.rowError :
                        issue.level === 'warning' ? styles.rowWarning : styles.rowInfo
                      }>
                        <td className={styles.cellRow}>{issue.rowNumber}</td>
                        <td>
                          <span className={`${styles.levelBadge} ${
                            issue.level === 'error' ? styles.badgeError :
                            issue.level === 'warning' ? styles.badgeWarning : styles.badgeInfo
                          }`}>
                            {issue.level === 'error' ? t('report_level_error') :
                             issue.level === 'warning' ? t('report_level_warning') : t('report_level_info')}
                          </span>
                        </td>
                        <td className={styles.cellCode}>{t(ISSUE_CODE_KEYS[issue.code]) || issue.code}</td>
                        <td className={styles.cellField}>{issue.field || '—'}</td>
                        <td className={styles.cellMessage}>
                          {issue.message}
                          {issue.originalValue && (
                            <span className={styles.originalValue}>
                              {t('report_original_value')} &quot;{issue.originalValue}&quot;
                            </span>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                {filteredIssues.length > 200 && (
                  <p className={styles.truncated}>
                    {t('report_truncated', { count: filteredIssues.length })}
                  </p>
                )}
              </div>
            )}
          </div>
        )}

        {/* Footer */}
        <div className={styles.footer}>
          <button className={styles.closeButtonFooter} onClick={onClose}>
            {t('report_close')}
          </button>
        </div>
      </div>
    </div>
  );
}

export default ImportReportDialog;
