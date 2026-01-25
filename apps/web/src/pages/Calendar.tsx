import styles from './Calendar.module.css';

export function Calendar() {
  const today = new Date();
  const monthNames = [
    'Leden', 'Únor', 'Březen', 'Duben', 'Květen', 'Červen',
    'Červenec', 'Srpen', 'Září', 'Říjen', 'Listopad', 'Prosinec'
  ];

  return (
    <div className={styles.calendar}>
      <div className={styles.header}>
        <h1>Kalendář</h1>
        <div className={styles.monthNav}>
          <button className="btn-secondary">←</button>
          <span className={styles.currentMonth}>
            {monthNames[today.getMonth()]} {today.getFullYear()}
          </span>
          <button className="btn-secondary">→</button>
        </div>
      </div>

      <div className="card">
        <div className={styles.weekDays}>
          <div>Po</div>
          <div>Út</div>
          <div>St</div>
          <div>Čt</div>
          <div>Pá</div>
          <div>So</div>
          <div>Ne</div>
        </div>

        <div className={styles.days}>
          {Array.from({ length: 35 }, (_, i) => (
            <div key={i} className={styles.day}>
              <span className={styles.dayNumber}>{((i % 31) + 1)}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
