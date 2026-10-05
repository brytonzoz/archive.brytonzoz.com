'use client';

import styles from './ComingSoonNotification.module.css';

function UpArrow() {
  return (
    <svg width="15" height="15" viewBox="0 0 20 20" fill="none" aria-hidden="true">
      <path d="M10 15.5V4.5M5.5 9 10 4.5 14.5 9" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export function ComingSoonNotification({ onSelect }: { onSelect: () => void }) {
  return (
    <button
      type="button"
      className={styles.notification}
      aria-label="View new project coming soon"
      onClick={onSelect}
    >
      <span className={styles.arrival}>
        <span className={styles.leftCap} aria-hidden="true" />
        <span className={styles.middle} aria-hidden="true" />
        <span className={styles.rightCap} aria-hidden="true" />
        <span className={styles.seedIcon} aria-hidden="true"><UpArrow /></span>
        <span className={styles.message}>
          <span>New project coming soon</span>
          <UpArrow />
        </span>
      </span>
    </button>
  );
}
