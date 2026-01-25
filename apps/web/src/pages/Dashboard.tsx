import { useNatsStore } from '@/stores/natsStore';
import styles from './Dashboard.module.css';

export function Dashboard() {
  const isConnected = useNatsStore((s) => s.isConnected);
  const error = useNatsStore((s) => s.error);

  return (
    <div className={styles.dashboard}>
      <h1>Dashboard</h1>
      
      <div className={styles.grid}>
        <div className="card">
          <h3>Připojení</h3>
          <p>
            Status: {isConnected ? '✅ Připojeno' : '❌ Odpojeno'}
          </p>
          {error && <p className={styles.error}>{error}</p>}
        </div>

        <div className="card">
          <h3>Dnešní revize</h3>
          <p className={styles.bigNumber}>0</p>
          <p className={styles.subtitle}>naplánováno</p>
        </div>

        <div className="card">
          <h3>Tento týden</h3>
          <p className={styles.bigNumber}>0</p>
          <p className={styles.subtitle}>revizí</p>
        </div>

        <div className="card">
          <h3>Po termínu</h3>
          <p className={styles.bigNumber}>0</p>
          <p className={styles.subtitle}>zákazníků</p>
        </div>
      </div>

      <div className="card" style={{ marginTop: '1.5rem' }}>
        <h3>Rychlé akce</h3>
        <div className={styles.actions}>
          <button className="btn-primary">+ Nový zákazník</button>
          <button className="btn-secondary">Naplánovat den</button>
          <button className="btn-secondary">Zobrazit kalendář</button>
        </div>
      </div>
    </div>
  );
}
