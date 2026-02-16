import { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import styles from './ArrivalBufferBar.module.css';

interface ArrivalBufferBarProps {
  percent: number;
  fixedMinutes: number;
  onChange: (percent: number, fixedMinutes: number) => void;
}

export function ArrivalBufferBar({ percent, fixedMinutes, onChange }: ArrivalBufferBarProps) {
  const { t } = useTranslation('planner');
  const [expanded, setExpanded] = useState(false);
  const [editPct, setEditPct] = useState(percent);
  const [editFixed, setEditFixed] = useState(fixedMinutes);

  const handleSave = () => {
    onChange(editPct, editFixed);
    setExpanded(false);
  };

  const handleCancel = () => {
    setEditPct(percent);
    setEditFixed(fixedMinutes);
    setExpanded(false);
  };

  useEffect(() => {
    if (!expanded) {
      setEditPct(percent);
      setEditFixed(fixedMinutes);
    }
  }, [percent, fixedMinutes, expanded]);

  if (!expanded) {
    return (
      <div
        className={styles.bufferBar}
        onClick={() => setExpanded(true)}
        role="button"
        tabIndex={0}
        onKeyDown={(e) => e.key === 'Enter' && setExpanded(true)}
      >
        <span className={styles.bufferLabel}>
          {t('buffer_info', { percent, fixed: fixedMinutes })}
        </span>
      </div>
    );
  }

  return (
    <div className={styles.bufferBarExpanded}>
      <div className={styles.bufferEditRow}>
        <label>{t('buffer_percent_label')}</label>
        <input
          type="number"
          value={editPct}
          onChange={(e) => setEditPct(parseFloat(e.target.value) || 0)}
          min={0}
          max={100}
          step={1}
        />
        <span>%</span>
      </div>
      <div className={styles.bufferEditRow}>
        <label>{t('buffer_fixed_label')}</label>
        <input
          type="number"
          value={editFixed}
          onChange={(e) => setEditFixed(parseFloat(e.target.value) || 0)}
          min={0}
          max={120}
          step={1}
        />
        <span>min</span>
      </div>
      <div className={styles.bufferEditActions}>
        <button type="button" onClick={handleSave}>{t('buffer_save')}</button>
        <button type="button" onClick={handleCancel}>{t('buffer_cancel')}</button>
      </div>
    </div>
  );
}
