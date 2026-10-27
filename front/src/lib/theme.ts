import { useSyncExternalStore } from 'react';
import { createPreference } from './preference';
import { type Theme, THEME_COLORS, THEME_STORAGE_KEY, THEMES } from './preferences.const';

export { THEMES };
export type { Theme };

// 'system' — без атрибута, работает prefers-color-scheme; light/dark — data-theme на <html> (см. globals.css)
export function applyTheme(theme: Theme) {
  const root = document.documentElement;
  if (theme === 'system') delete root.dataset.theme;
  else root.dataset.theme = theme;

  // адресная строка мобильного браузера: у <meta name="theme-color"> из layout условие по prefers-color-scheme,
  // при ручном выборе обоим тегам ставим цвет выбранной темы, при «как в системе» возвращаем исходный
  document.querySelectorAll<HTMLMetaElement>('meta[name="theme-color"]').forEach((meta) => {
    meta.dataset.systemColor ??= meta.content;
    meta.content = theme === 'system' ? meta.dataset.systemColor : THEME_COLORS[theme];
  });
}

const themePreference = createPreference<Theme>(THEME_STORAGE_KEY, THEMES, 'system', applyTheme);

export const getTheme = themePreference.get;
export const setTheme = themePreference.set;

export function useTheme() {
  const theme = useSyncExternalStore(themePreference.subscribe, themePreference.get, themePreference.getServer);
  return { theme, setTheme };
}
