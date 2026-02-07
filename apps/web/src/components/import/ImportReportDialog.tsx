/**
 * Dialog for displaying structured import reports
 * Shows summary, error/warning breakdown, and detailed issue list
 */
import { useState, useMemo } from 'react';
import type { ImportReport, ImportIssue, ImportIssueCode, ImportIssueSummary } from '@shared/import';
import styles from './ImportReportDialog.module.css';

interface ImportReportDialogProps {
  report: ImportReport;
  onClose: () => void;
}

// Human-readable labels for issue codes
const ISSUE_CODE_LABELS: Record<ImportIssueCode, string> = {
  CUSTOMER_NOT_FOUND: 'Zákazník nenalezen',
  DEVICE_NOT_FOUND: 'Zařízení nenalezeno',
  DUPLICATE_RECORD: 'Duplicitní záznam',
  MISSING_FIELD: 'Chybějící pole',
  INVALID_DATE: 'Neplatné datum',
  INVALID_VALUE: 'Neplatná hodnota',
  INVALID_STATUS: 'Neplatný stav',
  INVALID_RESULT: 'Neplatný výsledek',
  DB_ERROR: 'Chyba databáze',
  PARSE_ERROR: 'Chyba parsování',
  UNKNOWN: 'Neznámá chyba',
};

// Job type labels
const JOB_TYPE_LABELS: Record<string, string> = {
  'import.customer': 'Import zákazníků',
  'import.device': 'Import zařízení',
  'import.revision': 'Import revizí',
  'import.communication': 'Import komunikace',
  'import.visit': 'Import návštěv',
  'import.zip': 'Import ZIP',
};

function getJobTypeLabel(jobType: string): string {
  return JOB_TYPE_LABELS[jobType] || jobType;
}

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
    return d.toLocaleString('cs-CZ');
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
  const statusText = hasErrors ? 'Dokončeno s chybami' : hasWarnings ? 'Dokončeno s varováními' : 'Úspěšně dokončeno';

  return (
    <div className={styles.overlay} onClick={onClose}>
      <div className={styles.dialog} onClick={e => e.stopPropagation()}>
        {/* Header */}
        <div className={styles.header}>
          <div>
            <h2 className={styles.title}>Import Report</h2>
            <p className={styles.subtitle}>
              {getJobTypeLabel(report.jobType)} &mdash; {report.filename}
            </p>
          </div>
          <button className={styles.closeButton} onClick={onClose} aria-label="Zavřít">
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
            <div className={styles.statLabel}>Celkem řádků</div>
          </div>
          <div className={`${styles.statCard} ${styles.statSuccess}`}>
            <div className={styles.statValue}>{report.importedCount}</div>
            <div className={styles.statLabel}>Importováno</div>
          </div>
          {report.updatedCount > 0 && (
            <div className={`${styles.statCard} ${styles.statInfo}`}>
              <div className={styles.statValue}>{report.updatedCount}</div>
              <div className={styles.statLabel}>Aktualizováno</div>
            </div>
          )}
          {report.skippedCount > 0 && (
            <div className={`${styles.statCard} ${styles.statWarning}`}>
              <div className={styles.statValue}>{report.skippedCount}</div>
              <div className={styles.statLabel}>Přeskočeno</div>
            </div>
          )}
          {errorCount > 0 && (
            <div className={`${styles.statCard} ${styles.statError}`}>
              <div className={styles.statValue}>{errorCount}</div>
              <div className={styles.statLabel}>Chyby</div>
            </div>
          )}
          {warningCount > 0 && (
            <div className={`${styles.statCard} ${styles.statWarning}`}>
              <div className={styles.statValue}>{warningCount}</div>
              <div className={styles.statLabel}>Varování</div>
            </div>
          )}
        </div>

        {/* Meta info */}
        <div className={styles.metaRow}>
          <span>Datum: {formatDate(report.importedAt)}</span>
          <span>Trvání: {formatDuration(report.durationMs)}</span>
        </div>

        {/* Issue summary (aggregated by code) */}
        {summary.length > 0 && (
          <div className={styles.section}>
            <h3 className={styles.sectionTitle}>Přehled problémů</h3>
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
                    {ISSUE_CODE_LABELS[s.code] || s.code}
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
              {showDetails ? '▼' : '▶'} Detail chyb ({filteredIssues.length}
              {filterCode ? ` — ${ISSUE_CODE_LABELS[filterCode]}` : ''})
              {filterCode && (
                <span
                  className={styles.clearFilter}
                  onClick={(e) => { e.stopPropagation(); setFilterCode(null); }}
                >
                  ✕ zrušit filtr
                </span>
              )}
            </button>
            {showDetails && (
              <div className={styles.issueList}>
                <table className={styles.issueTable}>
                  <thead>
                    <tr>
                      <th>Řádek</th>
                      <th>Typ</th>
                      <th>Kód</th>
                      <th>Pole</th>
                      <th>Zpráva</th>
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
                            {issue.level === 'error' ? 'Chyba' :
                             issue.level === 'warning' ? 'Varování' : 'Info'}
                          </span>
                        </td>
                        <td className={styles.cellCode}>{ISSUE_CODE_LABELS[issue.code] || issue.code}</td>
                        <td className={styles.cellField}>{issue.field || '—'}</td>
                        <td className={styles.cellMessage}>
                          {issue.message}
                          {issue.originalValue && (
                            <span className={styles.originalValue}>
                              Původní hodnota: &quot;{issue.originalValue}&quot;
                            </span>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                {filteredIssues.length > 200 && (
                  <p className={styles.truncated}>
                    Zobrazeno 200 z {filteredIssues.length} záznamů
                  </p>
                )}
              </div>
            )}
          </div>
        )}

        {/* Footer */}
        <div className={styles.footer}>
          <button className={styles.closeButtonFooter} onClick={onClose}>
            Zavřít
          </button>
        </div>
      </div>
    </div>
  );
}

export default ImportReportDialog;
