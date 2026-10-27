// Публичные списки одноразовых почтовых доменов: первый обычно полнее и свежее, второй добавляет покрытие.
// Списки объединяются.
export const DISPOSABLE_EMAIL_SOURCES = [
    'https://disposable.github.io/disposable-email-domains/domains.txt',
    'https://raw.githubusercontent.com/disposable-email-domains/disposable-email-domains/main/disposable_email_blocklist.conf',
] as const;

// Быстрые ручные правки поверх списков: домен сюда — без ожидания обновления источника
export const DISPOSABLE_EMAIL_MANUAL_BLOCKLIST: readonly string[] = [];

// Скрытая почта Apple — постоянный адрес настоящего Apple ID, а не одноразовый ящик
export const DISPOSABLE_EMAIL_MANUAL_ALLOWLIST: readonly string[] = ['privaterelay.appleid.com'];

// Кеш списка в Redis: перезапуск и соседние экземпляры не качают его заново
export const DISPOSABLE_EMAIL_CACHE_KEY = 'disposable-email:blocklist:v1';
export const DISPOSABLE_EMAIL_CACHE_TTL_SECONDS = 7 * 24 * 60 * 60;
// одно скачивание на все экземпляры
export const DISPOSABLE_EMAIL_LOCK_KEY = 'disposable-email:refresh-lock';
export const DISPOSABLE_EMAIL_LOCK_TTL_SECONDS = 60;

export const DISPOSABLE_EMAIL_REFRESH_INTERVAL_MS = 24 * 60 * 60 * 1000;
export const DISPOSABLE_EMAIL_DOWNLOAD_TIMEOUT_MS = 15_000;
export const DISPOSABLE_EMAIL_DOWNLOAD_ATTEMPTS = 3;
