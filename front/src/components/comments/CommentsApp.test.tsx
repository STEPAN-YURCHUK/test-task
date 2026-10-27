import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { api, ApiError } from '@/lib/api';
import { setLocale } from '@/lib/i18n';
import { makeComment, makeList, makeTopLevel } from '@/test-utils/fixtures';
import type { Comment, CommentList } from '@/types/comment';
import { CommentsApp } from './CommentsApp';

// управляемый сокет: тест сам «присылает» события сервера
const socket = vi.hoisted(() => {
  const handlers = new Map<string, Set<(...args: unknown[]) => void>>();
  return {
    connected: false,
    handlers,
    on: vi.fn((event: string, fn: (...args: unknown[]) => void) => {
      if (!handlers.has(event)) handlers.set(event, new Set());
      handlers.get(event)!.add(fn);
    }),
    off: vi.fn((event: string, fn: (...args: unknown[]) => void) => handlers.get(event)?.delete(fn)),
    emit(event: string, payload?: unknown) {
      handlers.get(event)?.forEach((fn) => fn(payload));
    },
  };
});
vi.mock('@/lib/socket', () => ({ getCommentsSocket: () => socket }));
vi.mock('@/components/lightbox/LightboxProvider', () => ({ useLightbox: () => ({ open: vi.fn() }) }));

// форма — заглушка: кнопка вызывает onCreated с комментарием из window.__nextCreated
vi.mock('./CommentForm', () => ({
  CommentForm: ({ onCreated, parentUuid }: { onCreated: (c: Comment) => void; parentUuid?: string }) => (
    <button data-testid={parentUuid ? `reply-form-${parentUuid}` : 'root-form'} onClick={() => onCreated((window as unknown as { __nextCreated: Comment }).__nextCreated)}>
      create
    </button>
  ),
}));

const setCreated = (c: Comment) => ((window as unknown as { __nextCreated: Comment }).__nextCreated = c);

let getComments: ReturnType<typeof vi.spyOn>;
let myVotes: ReturnType<typeof vi.spyOn>;

const serve = (list: CommentList) => getComments.mockResolvedValueOnce(list);

beforeEach(() => {
  socket.connected = false;
  socket.handlers.clear();
  window.history.replaceState(null, '', '/');
  localStorage.setItem('comments.voterToken', 'voter-token');
  getComments = vi.spyOn(api, 'getComments');
  myVotes = vi.spyOn(api, 'myVotes').mockResolvedValue({});
  window.scrollTo = vi.fn();
});

afterEach(() => {
  vi.useRealTimers();
});

const items = () => {
  const root = makeTopLevel({ uuid: 'r1', text: 'Первый', likesCount: 2, dislikesCount: 1, user: { userName: 'Ann', email: 'ann@ex.com', homePage: null } });
  root.replies = [makeComment({ uuid: 'x1', parentUuid: 'r1', rootUuid: 'r1', text: 'Ответ' })];
  return [root, makeTopLevel({ uuid: 'r2', text: 'Второй' })];
};

describe('CommentsApp', () => {
  it('загрузка: «Загрузка…», затем список, статистика, свои голоса', async () => {
    serve(makeList(items(), { total: 2 }));
    myVotes.mockResolvedValue({ r1: 1 });
    render(<CommentsApp />);

    expect(screen.getByText('Загрузка…')).toBeInTheDocument();
    expect(await screen.findByText('Первый')).toBeInTheDocument();
    expect(getComments).toHaveBeenCalledWith({ page: 1, sortBy: 'createdAt', sortOrder: 'DESC' });
    expect(screen.getByText(/обсуждений/)).toHaveTextContent('2 обсуждений');
    expect(screen.getByText(/ответов на странице/)).toHaveTextContent('1 ответов на странице');

    expect(myVotes).toHaveBeenCalledWith('voter-token', ['r1', 'x1', 'r2']);
    const card = screen.getByText('Первый').closest('tbody')!;
    await waitFor(() => expect(within(card).getAllByTitle('Нравится')[0]).toHaveAttribute('aria-pressed', 'true'));
  });

  it('параметры из URL читаются, а невалидные заменяются значениями по умолчанию', async () => {
    window.history.replaceState(null, '', '/?page=3&sortBy=userName&sortOrder=ASC');
    serve(makeList([], { page: 3 }));
    const { unmount } = render(<CommentsApp />);
    await waitFor(() => expect(getComments).toHaveBeenCalledWith({ page: 3, sortBy: 'userName', sortOrder: 'ASC' }));
    expect(window.location.search).toBe('?page=3&sortBy=userName&sortOrder=ASC');
    unmount();

    window.history.replaceState(null, '', '/?page=-1&sortBy=drop&sortOrder=up');
    serve(makeList([]));
    render(<CommentsApp />);
    await waitFor(() => expect(getComments).toHaveBeenLastCalledWith({ page: 1, sortBy: 'createdAt', sortOrder: 'DESC' }));
    expect(window.location.search).toBe('');
  });

  it('пустой список и ошибки загрузки', async () => {
    serve(makeList([]));
    const { unmount } = render(<CommentsApp />);
    expect(await screen.findByText('Комментариев пока нет — станьте первым.')).toBeInTheDocument();
    expect(myVotes).not.toHaveBeenCalled();
    unmount();

    getComments.mockRejectedValueOnce(new ApiError(500, 'internal_server_error', 'Внутренняя ошибка сервера'));
    const second = render(<CommentsApp />);
    expect(await screen.findByText('Внутренняя ошибка сервера')).toBeInTheDocument();
    second.unmount();

    getComments.mockRejectedValueOnce(new Error('boom'));
    render(<CommentsApp />);
    expect(await screen.findByText('Не удалось загрузить комментарии')).toBeInTheDocument();
  });

  it('ошибка получения своих голосов не ломает страницу', async () => {
    serve(makeList(items()));
    myVotes.mockRejectedValue(new Error('down'));
    render(<CommentsApp />);
    expect(await screen.findByText('Первый')).toBeInTheDocument();
  });

  it('смена сортировки: запрос с page=1 и URL', async () => {
    serve(makeList(items()));
    render(<CommentsApp />);
    await screen.findByText('Первый');

    serve(makeList(items()));
    await userEvent.click(screen.getByRole('button', { name: /Сначала новые/ }));
    await userEvent.click(screen.getByRole('option', { name: 'Популярные' }));

    await waitFor(() => expect(getComments).toHaveBeenLastCalledWith({ page: 1, sortBy: 'rating', sortOrder: 'DESC' }));
    expect(window.location.search).toBe('?sortBy=rating');
  });

  it('пагинация: запрос нужной страницы, прокрутка наверх, URL', async () => {
    serve(makeList(items(), { totalPages: 3, total: 60 }));
    render(<CommentsApp />);
    await screen.findByText('Первый');

    serve(makeList(items(), { page: 2, totalPages: 3, total: 60 }));
    await userEvent.click(within(screen.getByRole('navigation', { name: 'Страницы' })).getByRole('button', { name: '2' }));
    await waitFor(() => expect(getComments).toHaveBeenLastCalledWith({ page: 2, sortBy: 'createdAt', sortOrder: 'DESC' }));
    expect(window.scrollTo).toHaveBeenCalledWith({ top: 0, behavior: 'smooth' });
    expect(window.location.search).toBe('?page=2');
  });

  it('устаревший ответ (запрос сменился) игнорируется', async () => {
    let resolveFirst!: (l: CommentList) => void;
    getComments.mockReturnValueOnce(new Promise((r) => (resolveFirst = r)));
    serve(makeList([makeTopLevel({ text: 'Свежий' })]));
    window.history.replaceState(null, '', '/');
    render(<CommentsApp />);

    await waitFor(() => expect(getComments).toHaveBeenCalledTimes(1));
    await userEvent.click(screen.getByRole('button', { name: /Сначала новые/ }));
    await userEvent.click(screen.getByRole('option', { name: 'Сначала старые' }));
    expect(await screen.findByText('Свежий')).toBeInTheDocument();

    await act(async () => resolveFirst(makeList([makeTopLevel({ text: 'Старый' })])));
    expect(screen.queryByText('Старый')).not.toBeInTheDocument();
  });

  it('сокет: Live/Offline по connect/disconnect, уже подключённый — сразу Live', async () => {
    socket.connected = true;
    serve(makeList([]));
    const { unmount } = render(<CommentsApp />);
    expect(screen.getByText('Live')).toBeInTheDocument();

    act(() => socket.emit('disconnect'));
    expect(screen.getByText('Offline')).toBeInTheDocument();
    act(() => socket.emit('connect'));
    expect(screen.getByText('Live')).toBeInTheDocument();

    unmount();
    expect(socket.off).toHaveBeenCalledWith('comment_created', expect.any(Function));
    expect(socket.off).toHaveBeenCalledWith('comment_voted', expect.any(Function));
  });

  it('сокет comment_created: на живой странице заглавный вставляется сверху и подсвечивается, дубли игнорируются', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    serve(makeList(items(), { total: 2 }));
    render(<CommentsApp />);
    await screen.findByText('Первый');

    const fresh = makeComment({ uuid: 'n1', text: 'Новый' });
    act(() => socket.emit('comment_created', fresh));
    act(() => socket.emit('comment_created', fresh));

    const tbodies = document.querySelectorAll('tbody');
    expect(tbodies).toHaveLength(3);
    expect(within(tbodies[0] as HTMLElement).getByText('Новый')).toBeInTheDocument();
    expect(tbodies[0]).toHaveClass('fresh');
    expect(screen.getByText(/обсуждений/)).toHaveTextContent('3 обсуждений');

    act(() => vi.advanceTimersByTime(2500));
    expect(document.querySelector('tbody')).not.toHaveClass('fresh');
  });

  it('вставка сверху не превышает размер страницы и пересчитывает число страниц', async () => {
    serve(makeList(items(), { total: 2, pageSize: 2 }));
    render(<CommentsApp />);
    await screen.findByText('Первый');

    act(() => socket.emit('comment_created', makeComment({ text: 'Новый' })));
    expect(document.querySelectorAll('tbody')).toHaveLength(2);
    expect(screen.queryByText('Второй')).not.toBeInTheDocument();
    expect(screen.getByRole('navigation', { name: 'Страницы' })).toBeInTheDocument();
  });

  it('сокет comment_created: ответ добавляется в свою ветку (один раз), чужая ветка не трогается', async () => {
    serve(makeList(items()));
    render(<CommentsApp />);
    await screen.findByText('Первый');

    const reply = makeComment({ uuid: 'x2', parentUuid: 'r1', rootUuid: 'r1', text: 'Ещё ответ' });
    act(() => socket.emit('comment_created', reply));
    act(() => socket.emit('comment_created', reply));
    act(() => socket.emit('comment_created', makeComment({ parentUuid: 'zz', rootUuid: 'zz', text: 'Не наша ветка' })));

    expect(screen.getAllByText('Ещё ответ')).toHaveLength(1);
    expect(screen.queryByText('Не наша ветка')).not.toBeInTheDocument();
    expect(within(screen.getByText('Первый').closest('tbody')!).getByText('2 ответа')).toBeInTheDocument();
  });

  it('сокет comment_created не на живой странице → баннер, клик возвращает на «Сначала новые»', async () => {
    window.history.replaceState(null, '', '/?sortBy=rating');
    serve(makeList(items()));
    render(<CommentsApp />);
    await screen.findByText('Первый');

    act(() => socket.emit('comment_created', makeComment()));
    act(() => socket.emit('comment_created', makeComment()));
    const banner = screen.getByRole('button', { name: 'Новых комментариев: 2 — показать' });

    serve(makeList(items()));
    await userEvent.click(banner);
    await waitFor(() => expect(getComments).toHaveBeenLastCalledWith({ page: 1, sortBy: 'createdAt', sortOrder: 'DESC' }));
    await waitFor(() => expect(screen.queryByText(/Новых комментариев/)).not.toBeInTheDocument());
  });

  it('сокет comment_created до загрузки query игнорируется без ошибок', () => {
    getComments.mockReturnValue(new Promise(() => {}));
    render(<CommentsApp />);
    act(() => socket.emit('comment_created', makeComment()));
    expect(screen.getByText('Загрузка…')).toBeInTheDocument();
  });

  it('сокет comment_voted обновляет счётчики у заглавного и у ответа', async () => {
    serve(makeList(items()));
    render(<CommentsApp />);
    await screen.findByText('Первый');

    act(() => socket.emit('comment_voted', { commentUuid: 'r1', likesCount: 10, dislikesCount: 4, rating: 6 }));
    act(() => socket.emit('comment_voted', { commentUuid: 'x1', likesCount: 7, dislikesCount: 0, rating: 7 }));

    const rootActions = screen.getByText('Первый').closest('.rootBody')!.querySelector(':scope > .commentActions')!;
    expect(within(rootActions as HTMLElement).getByTitle('Нравится')).toHaveTextContent('10');
    expect(within(rootActions as HTMLElement).getByTitle('Не нравится')).toHaveTextContent('4');
    expect(within(screen.getByText('Ответ').closest('article')!).getByTitle('Нравится')).toHaveTextContent('7');
  });

  it('голос: оптимистично +1, затем значения сервера', async () => {
    serve(makeList(items()));
    let resolveVote!: (v: unknown) => void;
    const vote = vi.spyOn(api, 'vote').mockReturnValue(new Promise((r) => (resolveVote = r)) as never);
    render(<CommentsApp />);
    await screen.findByText('Первый');

    const rootActions = () => screen.getByText('Первый').closest('.rootBody')!.querySelector(':scope > .commentActions') as HTMLElement;
    await userEvent.click(within(rootActions()).getByTitle('Нравится'));
    expect(within(rootActions()).getByTitle('Нравится')).toHaveTextContent('3');
    expect(within(rootActions()).getByTitle('Нравится')).toHaveAttribute('aria-pressed', 'true');
    await waitFor(() => expect(vote).toHaveBeenCalledWith('voter-token', 'r1', 1));

    await act(async () => resolveVote({ likesCount: 9, dislikesCount: 1, rating: 8, myVote: 1 }));
    expect(within(rootActions()).getByTitle('Нравится')).toHaveTextContent('9');
  });

  it('голос: смена дизлайка на лайк пересчитывает оба счётчика; ошибка — откат', async () => {
    serve(makeList(items()));
    myVotes.mockResolvedValue({ r1: -1 });
    vi.spyOn(api, 'vote').mockRejectedValue(new ApiError(500, 'internal_server_error', 'x'));
    render(<CommentsApp />);
    await screen.findByText('Первый');

    const rootActions = () => screen.getByText('Первый').closest('.rootBody')!.querySelector(':scope > .commentActions') as HTMLElement;
    await waitFor(() => expect(within(rootActions()).getByTitle('Не нравится')).toHaveAttribute('aria-pressed', 'true'));

    await userEvent.click(within(rootActions()).getByTitle('Нравится'));
    await waitFor(() => expect(within(rootActions()).getByTitle('Не нравится')).toHaveAttribute('aria-pressed', 'true'));
    expect(within(rootActions()).getByTitle('Нравится')).toHaveTextContent('2');
    expect(within(rootActions()).getByTitle('Не нравится')).toHaveTextContent('1');
  });

  it('голос: оптимистичное значение при переключении видно до ответа сервера', async () => {
    serve(makeList(items()));
    myVotes.mockResolvedValue({ r1: -1 });
    vi.spyOn(api, 'vote').mockReturnValue(new Promise(() => {}) as never);
    render(<CommentsApp />);
    await screen.findByText('Первый');
    const rootActions = () => screen.getByText('Первый').closest('.rootBody')!.querySelector(':scope > .commentActions') as HTMLElement;
    await waitFor(() => expect(within(rootActions()).getByTitle('Не нравится')).toHaveAttribute('aria-pressed', 'true'));

    await userEvent.click(within(rootActions()).getByTitle('Нравится'));
    expect(within(rootActions()).getByTitle('Нравится')).toHaveTextContent('3');
    expect(within(rootActions()).getByTitle('Не нравится')).toHaveTextContent('0');
  });

  it('свой новый заглавный комментарий: на живой странице вставляется, иначе — переход на «Сначала новые»', async () => {
    serve(makeList(items()));
    const { unmount } = render(<CommentsApp />);
    await screen.findByText('Первый');

    setCreated(makeComment({ uuid: 'mine', text: 'Мой' }));
    fireEvent.click(screen.getByTestId('root-form'));
    expect(within(document.querySelector('tbody')!).getByText('Мой')).toBeInTheDocument();
    unmount();

    window.history.replaceState(null, '', '/?page=2');
    serve(makeList(items(), { page: 2, totalPages: 2 }));
    render(<CommentsApp />);
    await screen.findByText('Первый');

    serve(makeList(items()));
    setCreated(makeComment({ uuid: 'mine2' }));
    fireEvent.click(screen.getByTestId('root-form'));
    await waitFor(() => expect(getComments).toHaveBeenLastCalledWith({ page: 1, sortBy: 'createdAt', sortOrder: 'DESC' }));
  });

  it('свой заглавный не с живой страницы: если индекс ещё не успел — комментарий всё равно появляется сверху', async () => {
    window.history.replaceState(null, '', '/?sortBy=rating&sortOrder=DESC');
    serve(makeList(items()));
    render(<CommentsApp />);
    await screen.findByText('Первый');

    // перезагруженная первая страница пришла без нового комментария (Meilisearch отстаёт)
    serve(makeList(items()));
    setCreated(makeComment({ uuid: 'mine3', text: 'Только что мой' }));
    fireEvent.click(screen.getByTestId('root-form'));

    expect(await screen.findByText('Только что мой')).toBeInTheDocument();
    expect(document.querySelector('tbody')!.id).toBe('comment-mine3');
  });

  it('свои голоса запрашиваются пачками по 1000 uuid и объединяются', async () => {
    const root = makeTopLevel({ uuid: 'big' });
    root.replies = Array.from({ length: 2100 }, (_, i) => makeComment({ uuid: `rep${i}`, parentUuid: 'big', rootUuid: 'big' }));
    serve(makeList([root]));
    myVotes.mockImplementation(async (_token: string, uuids: string[]) => (uuids.includes('big') ? { big: 1 } : { rep2050: -1 }));
    render(<CommentsApp />);

    await waitFor(() => expect(myVotes).toHaveBeenCalledTimes(3));
    expect(myVotes.mock.calls.map((call: unknown[]) => (call[1] as string[]).length)).toEqual([1000, 1000, 101]);
    const card = document.querySelector('tbody')!;
    await waitFor(() => expect(within(card.querySelector('.rootBody > .commentActions') as HTMLElement).getByTitle('Нравится')).toHaveAttribute('aria-pressed', 'true'));
  });

  it('после переподключения сокета текущая страница перечитывается; первое подключение — нет', async () => {
    serve(makeList(items()));
    render(<CommentsApp />);
    await screen.findByText('Первый');

    act(() => socket.emit('connect'));
    expect(getComments).toHaveBeenCalledTimes(1);

    serve(makeList([makeTopLevel({ uuid: 'missed', text: 'Пропущенный' })]));
    act(() => socket.emit('disconnect'));
    act(() => socket.emit('connect'));
    expect(await screen.findByText('Пропущенный')).toBeInTheDocument();
    expect(getComments).toHaveBeenCalledTimes(2);
  });

  it('голос: быстрые клики — ответ на более ранний клик не затирает последний', async () => {
    serve(makeList(items()));
    const resolvers: ((v: unknown) => void)[] = [];
    vi.spyOn(api, 'vote').mockImplementation(() => new Promise((r) => resolvers.push(r)) as never);
    render(<CommentsApp />);
    await screen.findByText('Первый');
    const like = () => within(screen.getByText('Первый').closest('.rootBody')!.querySelector(':scope > .commentActions') as HTMLElement).getByTitle('Нравится');

    await userEvent.click(like()); // лайк
    await userEvent.click(like()); // снять лайк — ref уже знает о первом клике
    await waitFor(() => expect(resolvers).toHaveLength(2));
    expect(like()).toHaveTextContent('2');
    expect(like()).toHaveAttribute('aria-pressed', 'false');

    await act(async () => resolvers[1]({ likesCount: 2, dislikesCount: 1, rating: 1, myVote: 0 }));
    await act(async () => resolvers[0]({ likesCount: 3, dislikesCount: 1, rating: 2, myVote: 1 }));
    expect(like()).toHaveTextContent('2');
    expect(like()).toHaveAttribute('aria-pressed', 'false');
  });

  it('голос: откат снимает только свою дельту и не затирает счётчики, пришедшие по сокету', async () => {
    serve(makeList(items()));
    let rejectVote!: (e: unknown) => void;
    vi.spyOn(api, 'vote').mockReturnValue(new Promise((_, reject) => (rejectVote = reject)) as never);
    render(<CommentsApp />);
    await screen.findByText('Первый');
    const like = () => within(screen.getByText('Первый').closest('.rootBody')!.querySelector(':scope > .commentActions') as HTMLElement).getByTitle('Нравится');

    await userEvent.click(like());
    expect(like()).toHaveTextContent('3');
    act(() => socket.emit('comment_voted', { commentUuid: 'r1', likesCount: 6, dislikesCount: 1, rating: 5 }));
    await act(async () => rejectVote(new Error('down')));

    expect(like()).toHaveTextContent('5');
    expect(like()).toHaveAttribute('aria-pressed', 'false');
  });

  it('ошибка загрузки без сообщения сервера переводится при смене языка', async () => {
    getComments.mockRejectedValueOnce(new Error('boom'));
    render(<CommentsApp />);
    expect(await screen.findByText('Не удалось загрузить комментарии')).toBeInTheDocument();
    act(() => setLocale('en'));
    expect(screen.getByText('Could not load comments')).toBeInTheDocument();
    act(() => setLocale('ru'));
  });

  it('свой ответ: форма ответа открывается, ответ вставляется в ветку', async () => {
    serve(makeList(items()));
    render(<CommentsApp />);
    await screen.findByText('Первый');

    const rootActions = screen.getByText('Первый').closest('.rootBody')!.querySelector(':scope > .commentActions') as HTMLElement;
    await userEvent.click(within(rootActions).getByRole('button', { name: 'Ответить' }));
    setCreated(makeComment({ uuid: 'myreply', parentUuid: 'r1', rootUuid: 'r1', text: 'Мой ответ' }));
    fireEvent.click(screen.getByTestId('reply-form-r1'));

    expect(screen.getByText('Мой ответ')).toBeInTheDocument();
    expect(screen.queryByTestId('reply-form-r1')).not.toBeInTheDocument();
  });

  it('форма до загрузки query: onCreated ничего не делает', () => {
    getComments.mockReturnValue(new Promise(() => {}));
    render(<CommentsApp />);
    setCreated(makeComment());
    expect(() => fireEvent.click(screen.getByTestId('root-form'))).not.toThrow();
  });
});
