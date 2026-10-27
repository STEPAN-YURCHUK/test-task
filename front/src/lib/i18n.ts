import { useSyncExternalStore } from 'react';
import { type Messages, MESSAGES } from './messages';
import { createPreference } from './preference';
import { DEFAULT_LOCALE, type Locale, LOCALE_STORAGE_KEY, LOCALES } from './preferences.const';

export { LOCALES, MESSAGES };
export type { Locale, Messages };

// Язык хранится в localStorage; на сервере и при гидрации — русский (язык ТЗ), затем подставляется сохранённый
const localePreference = createPreference<Locale>(LOCALE_STORAGE_KEY, LOCALES, DEFAULT_LOCALE, (locale) => {
  document.documentElement.lang = locale;
});

export const getLocale = localePreference.get;
export const setLocale = localePreference.set;

// Тексты для кода вне React (валидация, ошибки API). В рендере — t из useI18n: он согласован с гидрацией
export const messages = (): Messages => MESSAGES[getLocale()];

export function useI18n() {
  const locale = useSyncExternalStore(localePreference.subscribe, localePreference.get, localePreference.getServer);
  return { locale, t: MESSAGES[locale], setLocale };
}
