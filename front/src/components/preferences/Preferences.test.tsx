import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it } from 'vitest';
import { SortMenu } from '@/components/comments/SortMenu';
import { Preferences } from './Preferences';

const root = document.documentElement;

afterEach(() => {
  delete root.dataset.theme;
  root.lang = 'ru';
});

const setup = () =>
  render(
    <>
      <Preferences />
      <SortMenu sortBy="createdAt" sortOrder="DESC" onChange={() => {}} />
    </>,
  );

describe('Preferences', () => {
  it('переключение языка меняет тексты интерфейса, lang и title', async () => {
    setup();
    expect(screen.getByRole('button', { name: 'RU' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByText('Сначала новые')).toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: 'EN' }));

    expect(screen.getByText('Newest first')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'EN' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('group', { name: 'Language' })).toBeInTheDocument();
    expect(root.lang).toBe('en');
    expect(document.title).toBe('Comments');

    await userEvent.click(screen.getByRole('button', { name: 'RU' }));
    expect(screen.getByText('Сначала новые')).toBeInTheDocument();
    expect(document.title).toBe('Комментарии');
  });

  it('переключение темы: тёмная, светлая, как в системе', async () => {
    setup();
    expect(screen.getByRole('button', { name: 'Как в системе' })).toHaveAttribute('aria-pressed', 'true');

    await userEvent.click(screen.getByRole('button', { name: 'Тёмная' }));
    expect(root.dataset.theme).toBe('dark');
    expect(screen.getByRole('button', { name: 'Тёмная' })).toHaveAttribute('aria-pressed', 'true');

    await userEvent.click(screen.getByRole('button', { name: 'Светлая' }));
    expect(root.dataset.theme).toBe('light');

    await userEvent.click(screen.getByRole('button', { name: 'Как в системе' }));
    expect(root.dataset.theme).toBeUndefined();
  });

  it('сохранённый выбор применяется при монтировании', () => {
    localStorage.setItem('comments.theme', 'dark');
    localStorage.setItem('comments.locale', 'en');
    setup();
    expect(root.dataset.theme).toBe('dark');
    expect(screen.getByRole('button', { name: 'Dark' })).toHaveAttribute('aria-pressed', 'true');
  });
});
