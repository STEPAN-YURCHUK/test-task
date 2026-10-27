'use client';

import { useEffect } from 'react';
import { LOCALES, useI18n } from '@/lib/i18n';
import { applyTheme, getTheme, type Theme, THEMES, useTheme } from '@/lib/theme';
import styles from './preferences.module.css';

const THEME_ICONS: Record<Theme, React.ReactNode> = {
  system: (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <rect x="3" y="4" width="18" height="12" rx="2" />
      <path d="M8 20h8M12 16v4" />
    </svg>
  ),
  light: (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden>
      <circle cx="12" cy="12" r="4" />
      <path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" />
    </svg>
  ),
  dark: (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M20 14.5A8 8 0 0 1 9.5 4a8 8 0 1 0 10.5 10.5Z" />
    </svg>
  ),
};

// Переключатели языка и темы в шапке. Выбор хранится в localStorage и синхронизируется между вкладками
export function Preferences() {
  const { locale, t, setLocale } = useI18n();
  const { theme, setTheme } = useTheme();

  // data-theme и lang уже выставил скрипт в <head>; при монтировании остаётся цвет адресной строки (theme-color).
  // Значение читаем из хранилища, а не из theme: при гидрации theme ещё равен серверному 'system'
  useEffect(() => applyTheme(getTheme()), []);

  const themeLabels: Record<Theme, string> = { system: t.prefs.themeSystem, light: t.prefs.themeLight, dark: t.prefs.themeDark };

  return (
    <div className={styles.preferences}>
      <title>{t.meta.title}</title>
      <div className={styles.segmented} role="group" aria-label={t.prefs.language}>
        {LOCALES.map((value) => (
          <button
            key={value}
            type="button"
            className={`${styles.option} ${locale === value ? styles.active : ''}`}
            aria-pressed={locale === value}
            onClick={() => setLocale(value)}
            lang={value}
          >
            {value.toUpperCase()}
          </button>
        ))}
      </div>
      <div className={styles.segmented} role="group" aria-label={t.prefs.theme}>
        {THEMES.map((value) => (
          <button
            key={value}
            type="button"
            className={`${styles.option} ${styles.iconOption} ${theme === value ? styles.active : ''}`}
            aria-pressed={theme === value}
            aria-label={themeLabels[value]}
            title={themeLabels[value]}
            onClick={() => setTheme(value)}
          >
            {THEME_ICONS[value]}
          </button>
        ))}
      </div>
    </div>
  );
}
