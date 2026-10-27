'use client';

import { useEffect, useRef, useState } from 'react';
import { type Messages, useI18n } from '@/lib/i18n';
import type { SortBy, SortOrder } from '@/types/comment';
import styles from './comments.module.css';

type Option = { sortBy: SortBy; sortOrder: SortOrder; label: string };

const options = (t: Messages['sort']): Option[] => [
  { sortBy: 'createdAt', sortOrder: 'DESC', label: t.newest },
  { sortBy: 'createdAt', sortOrder: 'ASC', label: t.oldest },
  { sortBy: 'rating', sortOrder: 'DESC', label: t.popular },
  { sortBy: 'userName', sortOrder: 'ASC', label: 'User Name: A → Z' },
  { sortBy: 'userName', sortOrder: 'DESC', label: 'User Name: Z → A' },
  { sortBy: 'email', sortOrder: 'ASC', label: 'E-mail: A → Z' },
  { sortBy: 'email', sortOrder: 'DESC', label: 'E-mail: Z → A' },
];

type Props = { sortBy: SortBy; sortOrder: SortOrder; onChange: (sortBy: SortBy, sortOrder: SortOrder) => void };

export function SortMenu({ sortBy, sortOrder, onChange }: Props) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const { t } = useI18n();
  const OPTIONS = options(t.sort);
  const current = OPTIONS.find((o) => o.sortBy === sortBy && o.sortOrder === sortOrder) ?? OPTIONS[0];

  useEffect(() => {
    if (!open) return;
    const onClick = (e: MouseEvent) => !rootRef.current?.contains(e.target as Node) && setOpen(false);
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false);
    document.addEventListener('mousedown', onClick);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onClick);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  return (
    <div className={styles.sortMenu} ref={rootRef}>
      <button type="button" className={styles.sortTrigger} onClick={() => setOpen((v) => !v)} aria-haspopup="listbox" aria-expanded={open}>
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden>
          <path d="M3 6h18M6 12h12M10 18h4" />
        </svg>
        <span className={styles.sortTriggerLabel}>{current.label}</span>
        <svg className={open ? styles.chevronOpen : ''} width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" aria-hidden>
          <path d="m6 9 6 6 6-6" />
        </svg>
      </button>

      {open && (
        <ul className={styles.sortList} role="listbox" aria-label={t.sort.label}>
          {OPTIONS.map((option) => {
            const active = option === current;
            return (
              <li key={option.label}>
                <button
                  type="button"
                  role="option"
                  aria-selected={active}
                  className={`${styles.sortOption} ${active ? styles.sortOptionActive : ''}`}
                  onClick={() => {
                    setOpen(false);
                    if (!active) onChange(option.sortBy, option.sortOrder);
                  }}
                >
                  {option.label}
                  {active && (
                    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" aria-hidden>
                      <path d="m5 12 5 5 9-10" />
                    </svg>
                  )}
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
