import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { api, ApiError } from '@/lib/api';
import { setLocale } from '@/lib/i18n';
import * as uploadModule from '@/lib/upload';
import { makeComment } from '@/test-utils/fixtures';
import { CommentForm } from './CommentForm';

let getCaptcha: ReturnType<typeof vi.spyOn>;
let createComment: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  let n = 0;
  getCaptcha = vi.spyOn(api, 'getCaptcha').mockImplementation(async () => ({ token: `cap-${++n}`, image: `img-${n}` }));
  createComment = vi.spyOn(api, 'createComment');
  URL.createObjectURL = vi.fn(() => 'blob:x');
  URL.revokeObjectURL = vi.fn();
});

afterEach(() => {
  vi.useRealTimers();
});

const field = (placeholder: string) => screen.getByPlaceholderText(placeholder) as HTMLInputElement;
const textarea = () => screen.getByRole('textbox', { name: /Text/ });

async function fillValid(user = userEvent.setup()) {
  await user.type(field('JohnDoe'), '  John1 ');
  await user.type(field('john@example.com'), 'john@ex.com');
  await user.type(textarea(), 'Hello <i>w</i>');
  await user.type(field('Текст с картинки'), ' aB3 ');
  return user;
}

const sentForm = () => Object.fromEntries((createComment.mock.calls.at(-1)![0] as FormData).entries());

describe('CommentForm', () => {
  it('пустая форма — ошибки всех обязательных полей, запрос не уходит', async () => {
    render(<CommentForm onCreated={vi.fn()} />);
    await userEvent.click(screen.getByRole('button', { name: 'Отправить' }));

    expect(screen.getAllByText('Обязательное поле')).toHaveLength(4);
    expect(createComment).not.toHaveBeenCalled();
    expect(field('JohnDoe')).toHaveClass('invalid');

    await userEvent.type(field('JohnDoe'), 'a');
    expect(field('JohnDoe')).not.toHaveClass('invalid');
  });

  it('невалидные значения — понятные сообщения', async () => {
    render(<CommentForm onCreated={vi.fn()} />);
    await userEvent.type(field('JohnDoe'), 'John Doe');
    await userEvent.type(field('john@example.com'), 'bad');
    await userEvent.type(field('https://example.com'), 'ftp://x');
    await userEvent.type(textarea(), '<b>x</b>');
    await userEvent.type(field('Текст с картинки'), 'аб');
    await userEvent.click(screen.getByRole('button', { name: 'Отправить' }));

    expect(screen.getAllByText('Только латинские буквы и цифры')).toHaveLength(2);
    expect(screen.getByText('Неверный формат e-mail')).toBeInTheDocument();
    expect(screen.getByText('Неверный формат URL (http/https)')).toBeInTheDocument();
    expect(screen.getByText(/Тег запрещён/)).toBeInTheDocument();
  });

  it('успешная отправка: FormData с обрезанными полями и токеном капчи, сброс, профиль, новая капча', async () => {
    const onCreated = vi.fn();
    const created = makeComment();
    createComment.mockResolvedValue(created);
    render(<CommentForm onCreated={onCreated} />);
    await waitFor(() => expect(getCaptcha).toHaveBeenCalledTimes(1));

    await fillValid();
    await userEvent.click(screen.getByRole('button', { name: 'Отправить' }));

    await waitFor(() => expect(onCreated).toHaveBeenCalledWith(created));
    expect(sentForm()).toEqual({ userName: 'John1', email: 'john@ex.com', text: 'Hello <i>w</i>', captchaToken: 'cap-1', captcha: 'aB3' });
    expect(screen.getByText('Комментарий опубликован')).toBeInTheDocument();
    expect(textarea()).toHaveValue('');
    expect(field('Текст с картинки')).toHaveValue('');
    expect(field('JohnDoe')).toHaveValue('  John1 ');
    expect(JSON.parse(localStorage.getItem('comments.profile')!)).toEqual({ userName: '  John1 ', email: 'john@ex.com', homePage: '' });
    await waitFor(() => expect(getCaptcha).toHaveBeenCalledTimes(2));
  });

  it('ответ: parentUuid и homePage уходят, кнопка «Ответить», без сообщения об успехе, «Отмена»', async () => {
    const onCancel = vi.fn();
    createComment.mockResolvedValue(makeComment());
    render(<CommentForm parentUuid="p1" onCreated={vi.fn()} onCancel={onCancel} />);

    expect(textarea()).toHaveAttribute('rows', '3');
    await fillValid();
    await userEvent.type(field('https://example.com'), 'https://john.dev');
    await userEvent.click(screen.getByRole('button', { name: 'Ответить' }));

    await waitFor(() => expect(createComment).toHaveBeenCalled());
    expect(sentForm()).toMatchObject({ parentUuid: 'p1', homePage: 'https://john.dev' });
    expect(screen.queryByText('Комментарий опубликован')).not.toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: 'Отмена' }));
    expect(onCancel).toHaveBeenCalled();
  });

  it('во время отправки кнопка заблокирована и показывает «Отправка…»', async () => {
    let resolve!: (v: unknown) => void;
    createComment.mockReturnValue(new Promise((r) => (resolve = r)) as never);
    render(<CommentForm onCreated={vi.fn()} />);
    await fillValid();
    await userEvent.click(screen.getByRole('button', { name: 'Отправить' }));

    expect(screen.getByRole('button', { name: 'Отправка…' })).toBeDisabled();
    await act(async () => resolve(makeComment()));
    expect(screen.getByRole('button', { name: 'Отправить' })).toBeEnabled();
  });

  it('профиль из localStorage подставляется; битый JSON игнорируется', () => {
    localStorage.setItem('comments.profile', JSON.stringify({ userName: 'Saved', email: 's@ex.com', homePage: 'https://s.io' }));
    const { unmount } = render(<CommentForm onCreated={vi.fn()} />);
    expect(field('JohnDoe')).toHaveValue('Saved');
    expect(field('https://example.com')).toHaveValue('https://s.io');
    unmount();

    localStorage.setItem('comments.profile', '{broken');
    render(<CommentForm onCreated={vi.fn()} />);
    expect(field('JohnDoe')).toHaveValue('');
  });

  it('запрет записи в localStorage не мешает отправке', async () => {
    createComment.mockResolvedValue(makeComment());
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('quota');
    });
    const onCreated = vi.fn();
    render(<CommentForm onCreated={onCreated} />);
    await fillValid();
    await userEvent.click(screen.getByRole('button', { name: 'Отправить' }));
    await waitFor(() => expect(onCreated).toHaveBeenCalled());
  });

  it('ошибки валидации сервера раскладываются по полям', async () => {
    createComment.mockRejectedValue(new ApiError(400, 'not_valid_data', 'Ошибка валидации', { email: ['Сервер: e-mail занят'], text: ['Сервер: тег'] }));
    render(<CommentForm onCreated={vi.fn()} />);
    await fillValid();
    await userEvent.click(screen.getByRole('button', { name: 'Отправить' }));

    expect(await screen.findByText('Сервер: e-mail занят')).toBeInTheDocument();
    expect(screen.getByText('Сервер: тег')).toBeInTheDocument();
    expect(screen.queryByText('Ошибка валидации')).not.toBeInTheDocument();
  });

  it.each(['captcha_invalid', 'captcha_expired'])('%s → ошибка у капчи, капча перезагружается', async (code) => {
    createComment.mockRejectedValue(new ApiError(400, code, 'Неверная CAPTCHA'));
    render(<CommentForm onCreated={vi.fn()} />);
    await waitFor(() => expect(getCaptcha).toHaveBeenCalledTimes(1));
    await fillValid();
    await userEvent.click(screen.getByRole('button', { name: 'Отправить' }));

    expect(await screen.findByText('Неверная CAPTCHA')).toBeInTheDocument();
    expect(field('Текст с картинки')).toHaveValue('');
    await waitFor(() => expect(getCaptcha).toHaveBeenCalledTimes(2));
  });

  it('показанные ошибки проверки, предпросмотра и отправки переводятся при смене языка', async () => {
    createComment.mockRejectedValueOnce(new Error('boom'));
    vi.spyOn(api, 'preview').mockRejectedValue(new Error('offline'));
    render(<CommentForm onCreated={vi.fn()} />);

    await userEvent.click(screen.getByRole('button', { name: 'Отправить' }));
    expect(screen.getAllByText('Обязательное поле')).toHaveLength(4);
    act(() => setLocale('en'));
    expect(screen.getAllByText('Required field')).toHaveLength(4);
    act(() => setLocale('ru'));

    await userEvent.type(textarea(), 'ok');
    await userEvent.click(screen.getByRole('button', { name: 'Предпросмотр' }));
    expect(await screen.findByText('Ошибка предпросмотра')).toBeInTheDocument();

    await fillValid();
    await userEvent.click(screen.getByRole('button', { name: 'Отправить' }));
    expect(await screen.findByText('Не удалось отправить комментарий')).toBeInTheDocument();

    act(() => setLocale('en'));
    expect(screen.getByText('Preview failed')).toBeInTheDocument();
    expect(screen.getByText('Could not send the comment')).toBeInTheDocument();
    act(() => setLocale('ru'));
  });

  it('ошибка без привязки к полю → общий алерт; не-API ошибка → общее сообщение', async () => {
    createComment.mockRejectedValueOnce(new ApiError(429, 'too_many_request', 'Слишком много запросов'));
    render(<CommentForm onCreated={vi.fn()} />);
    await fillValid();
    await userEvent.click(screen.getByRole('button', { name: 'Отправить' }));
    expect(await screen.findByText('Слишком много запросов')).toBeInTheDocument();

    createComment.mockRejectedValueOnce(new Error('boom'));
    await userEvent.type(field('Текст с картинки'), 'zz');
    await userEvent.click(screen.getByRole('button', { name: 'Отправить' }));
    expect(await screen.findByText('Не удалось отправить комментарий')).toBeInTheDocument();
  });

  describe('файл', () => {
    const png = new File([new Uint8Array(10)], 'a.png', { type: 'image/png' });
    const fileInput = () => document.querySelector('input[type=file]') as HTMLInputElement;

    it('готовая загрузка уходит как uploadId, после успеха файл сбрасывается', async () => {
      vi.spyOn(uploadModule, 'uploadFile').mockResolvedValue({ uploadId: 'up-1', status: 'READY', error: null, file: null });
      createComment.mockResolvedValue(makeComment());
      render(<CommentForm onCreated={vi.fn()} />);

      await userEvent.upload(fileInput(), png);
      expect(await screen.findByText(/Готово/)).toBeInTheDocument();
      await fillValid();
      await userEvent.click(screen.getByRole('button', { name: 'Отправить' }));

      await waitFor(() => expect(createComment).toHaveBeenCalled());
      expect(sentForm()).toMatchObject({ uploadId: 'up-1' });
      expect(await screen.findByText('Перетащите файл')).toBeInTheDocument();
    });

    it('пока файл грузится — кнопка заблокирована, submit формы даёт «Дождитесь…»', async () => {
      vi.spyOn(uploadModule, 'uploadFile').mockReturnValue(new Promise(() => {}) as never);
      render(<CommentForm onCreated={vi.fn()} />);
      await fillValid();
      await userEvent.upload(fileInput(), png);

      expect(screen.getByRole('button', { name: 'Отправить' })).toBeDisabled();
      fireEvent.submit(textarea().closest('form')!);
      expect(await screen.findByText('Дождитесь окончания загрузки файла')).toBeInTheDocument();
      expect(createComment).not.toHaveBeenCalled();
    });

    it('файл с ошибкой: отправка запрещена, «Повторить» перезапускает загрузку, выбор нового файла очищает ошибку', async () => {
      const upload = vi.spyOn(uploadModule, 'uploadFile').mockRejectedValue(new ApiError(422, 'file_image_invalid', 'Битая картинка'));
      render(<CommentForm onCreated={vi.fn()} />);
      await fillValid();
      await userEvent.upload(fileInput(), png);
      expect(await screen.findByText('Файл не является корректным изображением JPG, GIF или PNG')).toBeInTheDocument();

      await userEvent.click(screen.getByRole('button', { name: 'Отправить' }));
      expect(createComment).not.toHaveBeenCalled();

      await userEvent.click(screen.getByRole('button', { name: 'Повторить' }));
      await waitFor(() => expect(upload).toHaveBeenCalledTimes(2));

      await userEvent.click(screen.getByRole('button', { name: 'Убрать файл' }));
      expect(screen.getByText('Перетащите файл')).toBeInTheDocument();
    });

    it('серверная ошибка file_* — показывается у вложения и загрузка сбрасывается', async () => {
      vi.spyOn(uploadModule, 'uploadFile').mockResolvedValue({ uploadId: 'up-1', status: 'READY', error: null, file: null });
      createComment.mockRejectedValue(new ApiError(409, 'file_upload_not_ready', 'Файл ещё не готов или уже использован'));
      render(<CommentForm onCreated={vi.fn()} />);
      await userEvent.upload(fileInput(), png);
      await screen.findByText(/Готово/);
      await fillValid();
      await userEvent.click(screen.getByRole('button', { name: 'Отправить' }));

      expect(await screen.findByText('Файл ещё не готов или уже использован')).toBeInTheDocument();
      expect(screen.getByText('Перетащите файл')).toBeInTheDocument();
    });
  });

  describe('предпросмотр', () => {
    it('локальная ошибка не ходит на сервер', async () => {
      const preview = vi.spyOn(api, 'preview');
      render(<CommentForm onCreated={vi.fn()} />);
      await userEvent.click(screen.getByRole('button', { name: 'Предпросмотр' }));
      expect(await screen.findByText('Обязательное поле')).toBeInTheDocument();
      expect(preview).not.toHaveBeenCalled();
    });

    it('серверный HTML показывается безопасно; при вводе обновляется с debounce 350 мс; скрытие', async () => {
      vi.useFakeTimers({ shouldAdvanceTime: true });
      const preview = vi.spyOn(api, 'preview').mockImplementation(async (text) => ({ html: text.replace('x', '<strong>x</strong>') }));
      const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
      render(<CommentForm onCreated={vi.fn()} />);

      await user.type(textarea(), 'x');
      await user.click(screen.getByRole('button', { name: 'Предпросмотр' }));
      await waitFor(() => expect(document.querySelector('.preview strong')).toHaveTextContent('x'));
      const callsAfterOpen = preview.mock.calls.length;

      await user.type(textarea(), 'y');
      expect(preview).toHaveBeenCalledTimes(callsAfterOpen);
      await act(() => vi.advanceTimersByTimeAsync(350));
      expect(preview).toHaveBeenLastCalledWith('xy');

      await user.click(screen.getByRole('button', { name: 'Скрыть предпросмотр' }));
      expect(document.querySelector('.preview')).toBeNull();
    });

    it.each([
      ['ApiError с ошибкой поля text', new ApiError(400, 'not_valid_data', 'Ошибка валидации', { text: ['Тег не закрыт'] }), 'Тег не закрыт'],
      ['ApiError без полей', new ApiError(500, 'internal_server_error', 'Внутренняя ошибка'), 'Внутренняя ошибка'],
      ['сетевая ошибка', new Error('offline'), 'Ошибка предпросмотра'],
    ])('%s', async (_name, error, message) => {
      vi.spyOn(api, 'preview').mockRejectedValue(error);
      render(<CommentForm onCreated={vi.fn()} />);
      await userEvent.type(textarea(), 'ok');
      await userEvent.click(screen.getByRole('button', { name: 'Предпросмотр' }));
      expect(await screen.findByText(message)).toBeInTheDocument();
    });

    it('посторонний HTML с сервера экранируется', async () => {
      vi.spyOn(api, 'preview').mockResolvedValue({ html: '<img src=x onerror=alert(1)>' });
      render(<CommentForm onCreated={vi.fn()} />);
      await userEvent.type(textarea(), 'ok');
      await userEvent.click(screen.getByRole('button', { name: 'Предпросмотр' }));
      expect(await screen.findByText('<img src=x onerror=alert(1)>')).toBeInTheDocument();
      expect(document.querySelector('.preview img')).toBeNull();
    });
  });
});
