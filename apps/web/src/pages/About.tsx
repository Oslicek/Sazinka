import styles from './About.module.css';

export function About() {
  return (
    <div className={styles.container}>
      <div className={styles.card}>
        <h1 className={styles.title}>O službě Ariadline</h1>
        
        <section className={styles.section}>
          <h2>Co je Ariadline?</h2>
          <p>
            Ariadline je CRM systém pro revizní techniky a další řemeslníky, 
            kteří pravidelně navštěvují své zákazníky. Pomáhá s plánováním 
            revizí, optimalizací tras a komunikací se zákazníky.
          </p>
        </section>

        <section className={styles.section}>
          <h2>Hlavní funkce</h2>
          <ul className={styles.featureList}>
            <li>Evidence zákazníků a zařízení k revizi</li>
            <li>Automatické plánování revizí podle intervalů</li>
            <li>Optimalizace denních tras s ohledem na časová okna</li>
            <li>Kalendář a fronta čekajících revizí</li>
            <li>Import a export dat (CSV)</li>
            <li>Správa posádek a pracovníků</li>
            <li>Role-based přístup (Admin, Zákazník, Pracovník)</li>
          </ul>
        </section>

        <section className={styles.section}>
          <h2>Verze</h2>
          <p className={styles.version}>v0.16.0 (2026-02-07)</p>
        </section>
      </div>
    </div>
  );
}
