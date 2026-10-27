'use client';

import { createContext, useCallback, useContext, useEffect, useState } from 'react';
import { useI18n } from '@/lib/i18n';
import styles from './lightbox.module.css';

export type LightboxItem = { type: 'IMAGE' | 'TEXT' | 'VIDEO'; url: string; title: string; poster?: string };

type LightboxContextValue = { open: (item: LightboxItem) => void };

const LightboxContext = createContext<LightboxContextValue | null>(null);

export function useLightbox() {
  const context = useContext(LightboxContext);
  if (!context) throw new Error('useLightbox must be used within LightboxProvider');
  return context;
}

// Просмотр вложений в духе lightbox2: затемнение, zoom-in контента, закрытие по Esc/клику вне
export function LightboxProvider({ children }: { children: React.ReactNode }) {
  const { t } = useI18n();
  const [item, setItem] = useState<LightboxItem | null>(null);
  const [closing, setClosing] = useState(false);
  const [text, setText] = useState<string | null>(null);
  // флаг, а не готовая строка: текст ошибки переводится при смене языка
  const [textFailed, setTextFailed] = useState(false);
  const [loaded, setLoaded] = useState(false);

  const open = useCallback((next: LightboxItem) => {
    setClosing(false);
    setLoaded(false);
    setText(null);
    setTextFailed(false);
    setItem(next);
  }, []);

  const close = useCallback(() => {
    setClosing(true);
    setTimeout(() => setItem(null), 200);
  }, []);

  useEffect(() => {
    if (!item) return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && close();
    document.addEventListener('keydown', onKey);
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = '';
    };
  }, [item, close]);

  useEffect(() => {
    if (item?.type !== 'TEXT') return;
    let cancelled = false;
    fetch(item.url)
      .then((r) => (r.ok ? r.text() : Promise.reject()))
      .then((value) => !cancelled && setText(value))
      .catch(() => !cancelled && setTextFailed(true))
      .finally(() => !cancelled && setLoaded(true));
    return () => {
      cancelled = true;
    };
  }, [item]);

  return (
    <LightboxContext.Provider value={{ open }}>
      {children}
      {item && (
        <div className={`${styles.overlay} ${closing ? styles.closing : ''}`} onClick={close} role="dialog" aria-modal="true">
          <div className={styles.frame} onClick={(e) => e.stopPropagation()}>
            {!loaded && <div className={styles.spinner} aria-label={t.lightbox.loading} />}
            {item.type === 'VIDEO' ? (
              // playsInline: на iPhone без него видео сразу уходит в полноэкранный плеер
              <video
                src={item.url}
                poster={item.poster}
                controls
                autoPlay
                playsInline
                preload="metadata"
                className={`${styles.video} ${loaded ? styles.visible : ''}`}
                onLoadedMetadata={() => setLoaded(true)}
                onError={() => setLoaded(true)}
              />
            ) : item.type === 'IMAGE' ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={item.url}
                alt={item.title}
                className={`${styles.image} ${loaded ? styles.visible : ''}`}
                onLoad={() => setLoaded(true)}
              />
            ) : (
              loaded && <pre className={`${styles.text} ${styles.visible}`}>{textFailed ? t.lightbox.loadFailed : text}</pre>
            )}
            <div className={styles.caption}>
              <span>{item.title}</span>
              <button type="button" className={styles.close} onClick={close} aria-label={t.lightbox.close}>
                ×
              </button>
            </div>
          </div>
        </div>
      )}
    </LightboxContext.Provider>
  );
}
