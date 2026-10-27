import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { api } from './api';
import { sanitizeCommentHtml } from './comment-html';
import { formatDate, formatRelative, formatSize } from './format';
import { getLocale, MESSAGES, messages, setLocale, useI18n } from './i18n';
import { validateCommentForm } from './validation';

// структура ключей + у функций одинаковое число параметров
function shape(value: unknown): unknown {
  if (typeof value === 'function') return `fn/${value.length}`;
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, shape(v)]));
  return typeof value;
}

afterEach(() => {
  document.documentElement.lang = 'ru';
});

describe('словари', () => {
  it('en и ru совпадают по ключам и сигнатурам', () => {
    expect(shape(MESSAGES.en)).toEqual(shape(MESSAGES.ru));
  });

  it.each(['ru', 'en'] as const)('%s: каждая функция подставляет аргумент', (locale) => {
    const visit = (value: unknown, path: string) => {
      if (typeof value === 'function') {
        const arg = value.length && /mod|hint/.test(path) ? 'Ctrl' : 7;
        expect(value(arg), path).toContain(String(arg));
      } else if (value && typeof value === 'object') {
        for (const [k, v] of Object.entries(value)) visit(v, `${path}.${k}`);
      }
    };
    visit(MESSAGES[locale], locale);
  });

  it('в английском нет кириллицы', () => {
    expect(JSON.stringify(MESSAGES.en)).not.toMatch(/[А-Яа-яЁё]/);
  });

  it.each([
    [1, '1 ответ'],
    [2, '2 ответа'],
    [5, '5 ответов'],
    [11, '11 ответов'],
    [21, '21 ответ'],
    [22, '22 ответа'],
    [112, '112 ответов'],
  ])('русское множественное число: %i → %s', (n, expected) => {
    expect(MESSAGES.ru.thread.replies(n)).toBe(expected);
  });

  it('английское множественное число', () => {
    expect(MESSAGES.en.thread.replies(1)).toBe('1 reply');
    expect(MESSAGES.en.thread.replies(3)).toBe('3 replies');
  });
});

describe('выбор языка', () => {
  it('по умолчанию русский', () => {
    expect(getLocale()).toBe('ru');
    expect(messages()).toBe(MESSAGES.ru);
  });

  // до первого setLocale: значение в памяти ещё не задано
  it('без localStorage и без выбора — русский', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('denied');
    });
    expect(getLocale()).toBe('ru');
  });

  it('setLocale сохраняет выбор, меняет lang у <html>', () => {
    setLocale('en');
    expect(localStorage.getItem('comments.locale')).toBe('en');
    expect(getLocale()).toBe('en');
    expect(document.documentElement.lang).toBe('en');
  });

  it('неизвестное значение в хранилище → русский', () => {
    localStorage.setItem('comments.locale', 'de');
    expect(getLocale()).toBe('ru');
  });

  it('без localStorage выбор живёт в памяти', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('denied');
    });
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('denied');
    });
    setLocale('en');
    expect(getLocale()).toBe('en');
    setLocale('ru');
    expect(getLocale()).toBe('ru');
  });

  it('хранилище читается, но запись запрещена (переполнено) — выбор всё равно применяется', () => {
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('QuotaExceededError');
    });
    setLocale('en');
    expect(getLocale()).toBe('en');
    expect(document.documentElement.lang).toBe('en');
    setLocale('ru');
  });

  it('useI18n перерисовывается при смене языка, в т.ч. из другой вкладки', () => {
    const { result } = renderHook(() => useI18n());
    expect(result.current.t.app.heroTitle).toBe('Комментарии');

    act(() => result.current.setLocale('en'));
    expect(result.current.locale).toBe('en');
    expect(result.current.t.app.heroTitle).toBe('Comments');

    act(() => {
      localStorage.setItem('comments.locale', 'ru');
      window.dispatchEvent(new StorageEvent('storage', { key: 'comments.locale' }));
    });
    expect(result.current.locale).toBe('ru');
    expect(document.documentElement.lang).toBe('ru');

    // событие о другом ключе не трогает язык
    act(() => {
      localStorage.setItem('comments.locale', 'en');
      window.dispatchEvent(new StorageEvent('storage', { key: 'comments.theme' }));
    });
    expect(result.current.locale).toBe('ru');
  });
});

describe('тексты вне React следуют языку', () => {
  beforeEach(() => setLocale('en'));

  it('форматирование', () => {
    expect(formatSize(1536)).toBe('1.5 KB');
    expect(formatSize(12)).toBe('12 B');
    expect(formatDate('2026-10-26T15:04:00')).toBe('26/10/26, 15:04');

    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-10-26T12:00:00'));
    expect(formatRelative('2026-10-26T11:59:50')).toBe('just now');
    expect(formatRelative('2026-10-26T11:55:00')).toBe('5 min ago');
    expect(formatRelative('2026-10-26T09:00:00')).toBe('3 h ago');
    vi.useRealTimers();
  });

  it('валидация формы и ошибки HTML', () => {
    const errors = validateCommentForm({ userName: 'Иван', email: 'x', homePage: 'ftp://a', text: '<b>x</b>', captcha: '' }, null);
    expect(errors).toEqual({
      userName: 'Latin letters and digits only',
      email: 'Invalid e-mail format',
      homePage: 'Invalid URL format (http/https)',
      captcha: 'Required field',
      text: 'Tag is not allowed (allowed: a, code, i, strong): b',
    });
    expect(() => sanitizeCommentHtml('<i>')).toThrow('Tag is not closed');
  });

  it('API: Accept-Language и сетевая ошибка на выбранном языке', async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce({ ok: true, json: () => Promise.resolve({}) }).mockRejectedValueOnce(new Error('offline'));
    vi.stubGlobal('fetch', fetchMock);

    await api.getCaptcha();
    expect(new Headers(fetchMock.mock.calls[0][1].headers).get('Accept-Language')).toBe('en');
    await expect(api.getCaptcha()).rejects.toThrow('Server is unreachable. Check your connection.');

    // заголовки вызывающего не теряются
    fetchMock.mockResolvedValueOnce({ ok: true, json: () => Promise.resolve({}) });
    await api.vote('tok', 'c1', 1);
    const headers = new Headers(fetchMock.mock.calls[2][1].headers);
    expect([headers.get('Authorization'), headers.get('Accept-Language')]).toEqual(['Bearer tok', 'en']);
    vi.unstubAllGlobals();
  });
});
