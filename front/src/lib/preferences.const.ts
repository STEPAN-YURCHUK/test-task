// Ключи и допустимые значения настроек. Без React — нужен и серверному layout (скрипт в <head>, theme-color)
export type Locale = 'ru' | 'en';
export const LOCALES: Locale[] = ['ru', 'en'];
export const DEFAULT_LOCALE: Locale = 'ru';
export const LOCALE_STORAGE_KEY = 'comments.locale';

export type Theme = 'system' | 'light' | 'dark';
export const THEMES: Theme[] = ['system', 'light', 'dark'];
export const THEME_STORAGE_KEY = 'comments.theme';
// фон страницы (--bg) — цвет адресной строки мобильного браузера
export const THEME_COLORS = { light: '#f6f6f9', dark: '#0b0b12' } as const;

// Выполняется в <head> до отрисовки: без вспышки светлой темы и с верным lang у английской версии
export const PREFERENCES_BOOT_SCRIPT = `try{var d=document.documentElement,t=localStorage.getItem(${JSON.stringify(THEME_STORAGE_KEY)}),l=localStorage.getItem(${JSON.stringify(LOCALE_STORAGE_KEY)});if(${JSON.stringify(THEMES.filter((theme) => theme !== 'system'))}.indexOf(t)>-1)d.dataset.theme=t;if(${JSON.stringify(LOCALES)}.indexOf(l)>-1)d.lang=l}catch(e){}`;
