import { type Messages, messages } from './i18n';

// Тексты единиц — параметром: в рендере передаётся t.format из useI18n (согласован с гидрацией),
// вне React по умолчанию берётся текущий язык
type FormatTexts = Messages['format'];

const formatters = new Map<string, Intl.DateTimeFormat>();
const dateFormatter = (intl: string) => {
  if (!formatters.has(intl)) {
    formatters.set(intl, new Intl.DateTimeFormat(intl, { day: '2-digit', month: '2-digit', year: '2-digit', hour: '2-digit', minute: '2-digit' }));
  }
  return formatters.get(intl)!;
};

export const formatDate = (iso: string, t: FormatTexts = messages().format) => {
  const { intl, at } = t;
  return dateFormatter(intl).format(new Date(iso)).replace(',', at);
};

// граница КБ→МБ по округлённому значению: иначе 1 048 064 Б показывались бы как «1024.0 КБ»
export const formatSize = (bytes: number, units: FormatTexts = messages().format) => {
  if (bytes < 1024) return `${bytes} ${units.bytes}`;
  const kb = bytes / 1024;
  return kb.toFixed(1) === '1024.0' || kb >= 1024 ? `${(kb / 1024).toFixed(1)} ${units.mb}` : `${kb.toFixed(1)} ${units.kb}`;
};

// «только что», «5 мин назад», «3 ч назад», дальше — полная дата
export function formatRelative(iso: string, t: FormatTexts = messages().format): string {
  const minutes = Math.floor((Date.now() - new Date(iso).getTime()) / 60_000);
  if (minutes < 1) return t.justNow;
  if (minutes < 60) return t.minutesAgo(minutes);
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return t.hoursAgo(hours);
  return formatDate(iso, t);
}
