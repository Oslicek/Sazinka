import { useState } from 'react';
import styles from './Customers.module.css';

export function Customers() {
  const [search, setSearch] = useState('');

  return (
    <div className={styles.customers}>
      <div className={styles.header}>
        <h1>Zákazníci</h1>
        <button className="btn-primary">+ Nový zákazník</button>
      </div>

      <div className={styles.toolbar}>
        <input
          type="text"
          placeholder="Hledat zákazníky..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className={styles.search}
        />
      </div>

      <div className="card">
        <p className={styles.empty}>
          Zatím nemáte žádné zákazníky.
          <br />
          <button className="btn-primary" style={{ marginTop: '1rem' }}>
            + Přidat prvního zákazníka
          </button>
        </p>
      </div>
    </div>
  );
}
