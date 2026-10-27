import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CommentEditor } from './CommentEditor';

function Controlled({ initial = '', error }: { initial?: string; error?: string }) {
  const [value, setValue] = useState(initial);
  return (
    <>
      <CommentEditor value={value} error={error} rows={4} onChange={setValue} />
      <output data-testid="value">{value}</output>
    </>
  );
}

const textarea = () => screen.getByRole('textbox', { name: /Text/ }) as HTMLTextAreaElement;
const value = () => screen.getByTestId('value').textContent;
const select = (start: number, end: number) => textarea().setSelectionRange(start, end);

beforeEach(() => {
  // как в браузере: колбэк после рендера с новым значением
  vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => setTimeout(() => cb(0), 0));
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('CommentEditor', () => {
  it.each([
    ['Курсив <i>', '<i>', '</i>'],
    ['Жирный <strong>', '<strong>', '</strong>'],
    ['Код <code>', '<code>', '</code>'],
  ])('кнопка «%s» оборачивает выделение и выделяет текст внутри тега', async (label, open, close) => {
    render(<Controlled initial="hello world" />);
    select(6, 11);
    await userEvent.click(screen.getByRole('button', { name: label }));

    expect(value()).toBe(`hello ${open}world${close}`);
    await waitFor(() => expect(textarea().selectionStart).toBe(6 + open.length));
    expect(textarea().selectionEnd).toBe(6 + open.length + 5);
    expect(document.activeElement).toBe(textarea());
  });

  it('без выделения вставляет пустой тег в позицию курсора', async () => {
    render(<Controlled initial="ab" />);
    select(1, 1);
    await userEvent.click(screen.getByRole('button', { name: 'Курсив <i>' }));
    expect(value()).toBe('a<i></i>b');
  });

  it('ссылка: панель, валидация http(s), title с кавычками, вставка вокруг выделения', async () => {
    render(<Controlled initial="see docs" />);
    select(4, 8);
    await userEvent.click(screen.getByRole('button', { name: 'Ссылка <a href title>' }));

    const href = screen.getByRole('textbox', { name: 'Адрес ссылки' });
    const insert = screen.getByRole('button', { name: 'Вставить' });
    expect(href).toHaveValue('https://');
    expect(insert).toBeDisabled();

    await userEvent.clear(href);
    await userEvent.type(href, 'ftp://x.io');
    expect(insert).toBeDisabled();

    await userEvent.clear(href);
    await userEvent.type(href, ' https://ex.com/?q="1" ');
    await userEvent.type(screen.getByRole('textbox', { name: 'Заголовок ссылки' }), 'Say "hi"');
    expect(insert).toBeEnabled();
    await userEvent.click(insert);

    expect(value()).toBe('see <a href="https://ex.com/?q=&quot;1&quot;" title="Say &quot;hi&quot;">docs</a>');
    expect(screen.queryByRole('textbox', { name: 'Адрес ссылки' })).not.toBeInTheDocument();
  });

  it('ссылка без title — без атрибута title', async () => {
    render(<Controlled initial="x" />);
    select(0, 1);
    await userEvent.click(screen.getByRole('button', { name: 'Ссылка <a href title>' }));
    await userEvent.type(screen.getByRole('textbox', { name: 'Адрес ссылки' }), 'a.io');
    await userEvent.click(screen.getByRole('button', { name: 'Вставить' }));
    expect(value()).toBe('<a href="https://a.io">x</a>');
  });

  it('Enter в поле ссылки вставляет, Enter с невалидным адресом — ничего', async () => {
    render(<Controlled initial="x" />);
    select(0, 1);
    await userEvent.click(screen.getByRole('button', { name: 'Ссылка <a href title>' }));
    const href = screen.getByRole('textbox', { name: 'Адрес ссылки' });

    await userEvent.clear(href);
    await userEvent.type(href, 'bad{Enter}');
    expect(value()).toBe('x');
    expect(href).toBeInTheDocument();

    await userEvent.clear(href);
    await userEvent.type(href, 'http://ok.io');
    await userEvent.type(screen.getByRole('textbox', { name: 'Заголовок ссылки' }), '{Enter}');
    expect(value()).toBe('<a href="http://ok.io">x</a>');
  });

  it('Escape и «Отмена» закрывают панель ссылки без изменений', async () => {
    render(<Controlled initial="x" />);
    await userEvent.click(screen.getByRole('button', { name: 'Ссылка <a href title>' }));
    await userEvent.type(screen.getByRole('textbox', { name: 'Адрес ссылки' }), '{Escape}');
    expect(screen.queryByRole('textbox', { name: 'Адрес ссылки' })).not.toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: 'Ссылка <a href title>' }));
    await userEvent.click(screen.getByRole('button', { name: 'Отмена' }));
    expect(screen.queryByRole('textbox', { name: 'Адрес ссылки' })).not.toBeInTheDocument();
    expect(value()).toBe('x');
  });

  it.each([
    [{ ctrlKey: true, key: 'b' }, '<strong>x</strong>'],
    [{ metaKey: true, key: 'I' }, '<i>x</i>'],
    [{ ctrlKey: true, key: 'e' }, '<code>x</code>'],
  ])('хоткей %o', (keys, expected) => {
    render(<Controlled initial="x" />);
    select(0, 1);
    fireEvent.keyDown(textarea(), keys);
    expect(value()).toBe(expected);
  });

  it('хоткей Ctrl+K открывает панель ссылки, остальные клавиши игнорируются', () => {
    render(<Controlled initial="x" />);
    fireEvent.keyDown(textarea(), { key: 'k', ctrlKey: true });
    expect(screen.getByRole('textbox', { name: 'Адрес ссылки' })).toBeInTheDocument();

    fireEvent.keyDown(textarea(), { key: 'b' });
    fireEvent.keyDown(textarea(), { key: 'z', ctrlKey: true });
    expect(value()).toBe('x');
  });

  it('счётчик символов и предупреждение у лимита', async () => {
    const { rerender } = render(<CommentEditor value="abc" rows={3} onChange={() => {}} />);
    expect(screen.getByText('3 / 5000')).not.toHaveClass('counterWarn');

    rerender(<CommentEditor value={'a'.repeat(4501)} rows={3} onChange={() => {}} />);
    expect(screen.getByText('4501 / 5000')).toHaveClass('counterWarn');
  });

  it('ошибка: подсветка редактора и текст', () => {
    render(<Controlled error="Тег не закрыт: <i>" />);
    expect(screen.getByText('Тег не закрыт: <i>')).toBeInTheDocument();
    expect(textarea()).toHaveAttribute('aria-invalid', 'true');
    expect(textarea().closest('.editor')).toHaveClass('editorInvalid');
  });

  it('ввод текста вызывает onChange', async () => {
    render(<Controlled />);
    await userEvent.type(textarea(), 'hi');
    expect(value()).toBe('hi');
  });

  it('подсказка хоткеев: Ctrl на Windows, ⌘ на Mac', () => {
    const { unmount } = render(<Controlled />);
    expect(screen.getByText(/Ctrl\+B/)).toBeInTheDocument();
    unmount();

    vi.spyOn(navigator, 'platform', 'get').mockReturnValue('MacIntel');
    render(<Controlled />);
    expect(screen.getByText(/⌘\+B/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Курсив <i>' })).toHaveAttribute('title', 'Курсив <i> · ⌘+I');
  });

  it('mousedown по кнопке не уводит фокус из textarea', () => {
    render(<Controlled />);
    const event = new MouseEvent('mousedown', { bubbles: true, cancelable: true });
    screen.getByRole('button', { name: 'Курсив <i>' }).dispatchEvent(event);
    expect(event.defaultPrevented).toBe(true);
  });
});
