import { afterEach, describe, expect, it } from 'vitest';
import { PREFERENCES_BOOT_SCRIPT } from './preferences.const';
import { getTheme, setTheme } from './theme';

const root = document.documentElement;

afterEach(() => {
  delete root.dataset.theme;
  root.lang = 'ru';
});

describe('тема', () => {
  it('по умолчанию как в системе — без data-theme', () => {
    expect(getTheme()).toBe('system');
    expect(root.dataset.theme).toBeUndefined();
  });

  it('светлая/тёмная ставят data-theme и сохраняются; system его убирает', () => {
    setTheme('dark');
    expect(root.dataset.theme).toBe('dark');
    expect(localStorage.getItem('comments.theme')).toBe('dark');

    setTheme('light');
    expect(root.dataset.theme).toBe('light');

    setTheme('system');
    expect(root.dataset.theme).toBeUndefined();
    expect(getTheme()).toBe('system');
  });
});

describe('цвет адресной строки (meta theme-color)', () => {
  const addMeta = (media: string, content: string) => {
    const meta = document.createElement('meta');
    meta.name = 'theme-color';
    meta.media = media;
    meta.content = content;
    document.head.append(meta);
    return meta;
  };

  it('ручная тема ставит её цвет обоим тегам, «как в системе» возвращает исходные', () => {
    const light = addMeta('(prefers-color-scheme: light)', '#f6f6f9');
    const dark = addMeta('(prefers-color-scheme: dark)', '#0b0b12');

    setTheme('dark');
    expect([light.content, dark.content]).toEqual(['#0b0b12', '#0b0b12']);
    setTheme('light');
    expect([light.content, dark.content]).toEqual(['#f6f6f9', '#f6f6f9']);
    setTheme('system');
    expect([light.content, dark.content]).toEqual(['#f6f6f9', '#0b0b12']);

    light.remove();
    dark.remove();
  });
});

describe('скрипт в <head> до гидрации', () => {
  const boot = () => new Function(PREFERENCES_BOOT_SCRIPT)();

  it('применяет сохранённые тему и язык', () => {
    localStorage.setItem('comments.theme', 'dark');
    localStorage.setItem('comments.locale', 'en');
    boot();
    expect(root.dataset.theme).toBe('dark');
    expect(root.lang).toBe('en');
  });

  it('игнорирует system и мусор', () => {
    localStorage.setItem('comments.theme', 'system');
    localStorage.setItem('comments.locale', '<script>');
    boot();
    expect(root.dataset.theme).toBeUndefined();
    expect(root.lang).toBe('ru');
  });
});
