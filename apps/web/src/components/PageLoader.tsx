import styles from './PageLoader.module.css';

export function PageLoader() {
  return (
    <div className={styles.container}>
      <div className={styles.spinner} />
    </div>
  );
}
