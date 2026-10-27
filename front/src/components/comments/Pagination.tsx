'use client';

import { useI18n } from '@/lib/i18n';
import styles from './comments.module.css';

type Props = { page: number; totalPages: number; onChange: (page: number) => void };

function getPages(page: number, total: number): (number | '…')[] {
  if (total <= 7) return Array.from({ length: total }, (_, i) => i + 1);
  const pages = new Set([1, total, page - 1, page, page + 1].filter((p) => p >= 1 && p <= total));
  const sorted = [...pages].sort((a, b) => a - b);
  return sorted.flatMap((p, i) => (i > 0 && p - sorted[i - 1] > 1 ? ['…' as const, p] : [p]));
}

export function Pagination({ page, totalPages, onChange }: Props) {
  const { t } = useI18n();
  if (totalPages <= 1) return null;

  return (
    <nav className={styles.pagination} aria-label={t.pagination.label}>
      <button type="button" disabled={page <= 1} onClick={() => onChange(page - 1)} aria-label={t.pagination.prev}>
        ←
      </button>
      {getPages(page, totalPages).map((p, i) =>
        p === '…' ? (
          <span key={`gap-${i}`} className={styles.muted}>
            …
          </span>
        ) : (
          <button key={p} type="button" className={p === page ? styles.pageActive : ''} onClick={() => onChange(p)} aria-current={p === page}>
            {p}
          </button>
        ),
      )}
      <button type="button" disabled={page >= totalPages} onClick={() => onChange(page + 1)} aria-label={t.pagination.next}>
        →
      </button>
    </nav>
  );
}
