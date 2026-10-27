import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { imageFile, makeChain, makeComment, makeTopLevel } from '@/test-utils/fixtures';
import type { Comment, TopLevelComment } from '@/types/comment';
import { CommentsTable } from './CommentsTable';

vi.mock('@/components/lightbox/LightboxProvider', () => ({ useLightbox: () => ({ open: vi.fn() }) }));
vi.mock('./CommentForm', () => ({
  CommentForm: ({ parentUuid, onCancel, onCreated }: { parentUuid: string; onCancel: () => void; onCreated: (c: Comment) => void }) => (
    <div data-testid="reply-form" data-parent={parentUuid}>
      <button onClick={onCancel}>cancel-form</button>
      <button onClick={() => onCreated({ uuid: 'new' } as Comment)}>submit-form</button>
    </div>
  ),
}));

const renderTable = (items: TopLevelComment[], overrides: Partial<Parameters<typeof CommentsTable>[0]> = {}) => {
  const props = {
    items,
    sortBy: 'createdAt' as const,
    sortOrder: 'DESC' as const,
    replyTo: null,
    freshUuids: new Set<string>(),
    ...overrides,
    onReply: vi.fn<(uuid: string | null) => void>(),
    onCreated: vi.fn<(comment: Comment) => void>(),
  };
  const view = render(<CommentsTable {...props} />);
  return { ...props, ...view };
};

describe('CommentsTable', () => {
  it('таблица: колонки с aria-sort, tbody на каждый заглавный комментарий', () => {
    const items = [makeTopLevel(), makeTopLevel()];
    const { container } = renderTable(items, { sortBy: 'userName', sortOrder: 'ASC' });

    expect(screen.getByRole('columnheader', { name: 'User Name' })).toHaveAttribute('aria-sort', 'ascending');
    expect(screen.getByRole('columnheader', { name: 'E-mail' })).toHaveAttribute('aria-sort', 'none');
    expect(screen.getByRole('columnheader', { name: 'Дата' })).toHaveAttribute('aria-sort', 'none');
    expect(container.querySelectorAll('tbody')).toHaveLength(2);
  });

  it('сортировка по убыванию → descending', () => {
    renderTable([makeTopLevel()], { sortBy: 'email', sortOrder: 'DESC' });
    expect(screen.getByRole('columnheader', { name: 'E-mail' })).toHaveAttribute('aria-sort', 'descending');
  });

  it('шапка карточки: имя, e-mail, чип сайта без www, время; свежий комментарий подсвечен', () => {
    const item = makeTopLevel({ uuid: 'r1', user: { userName: 'John1', email: 'john@ex.com', homePage: 'https://www.john.dev/about' } });
    const { container } = renderTable([item], { freshUuids: new Set(['r1']) });

    expect(screen.getByText('John1')).toBeInTheDocument();
    const chip = screen.getByRole('link', { name: /john\.dev/ });
    expect(chip).toHaveAttribute('href', 'https://www.john.dev/about');
    expect(chip).toHaveAttribute('rel', 'nofollow noopener noreferrer ugc');
    expect(chip).toHaveAttribute('target', '_blank');
    expect(screen.getAllByText('john@ex.com')).toHaveLength(2);
    expect(container.querySelector('time')).toHaveTextContent('только что');
    expect(container.querySelector('tbody')).toHaveClass('fresh');
  });

  it('некорректный homePage показывается как есть', () => {
    renderTable([makeTopLevel({ user: { userName: 'X', email: 'x@ex.com', homePage: 'not-a-url' } })]);
    expect(screen.getByRole('link', { name: /not-a-url/ })).toBeInTheDocument();
  });

  it('текст: разрешённые теги рендерятся, посторонние — экранируются', () => {
    const { container } = renderTable([
      makeTopLevel({ text: 'Hello <strong>world</strong>' }),
      makeTopLevel({ text: '<img src=x onerror=alert(1)>' }),
    ]);
    expect(container.querySelector('strong')).toHaveTextContent('world');
    expect(container.querySelector('img[src="x"]')).toBeNull();
    expect(screen.getByText('<img src=x onerror=alert(1)>')).toBeInTheDocument();
  });

  it('вложение отображается', () => {
    renderTable([makeTopLevel({ file: imageFile() })]);
    expect(screen.getByRole('button', { name: 'Открыть изображение photo.png' })).toBeInTheDocument();
  });

  it('вложенность: уровень 2 — вложенные карточки, глубже — плоский список с «в ответ …»', () => {
    const root = makeTopLevel({ uuid: 'root' });
    const a = makeComment({ uuid: 'a', parentUuid: 'root', rootUuid: 'root', text: 'A', user: { userName: 'Ann', email: 'a@ex.com', homePage: null } });
    const b = makeComment({ uuid: 'b', parentUuid: 'a', rootUuid: 'root', text: 'B', user: { userName: 'Bob', email: 'b@ex.com', homePage: null } });
    const c = makeComment({ uuid: 'c', parentUuid: 'b', rootUuid: 'root', text: 'C' });
    const a2 = makeComment({ uuid: 'a2', parentUuid: 'a', rootUuid: 'root', text: 'A2' });
    root.replies = [a, b, c, a2];
    const { container } = renderTable([root]);

    const articleOf = (text: string) => screen.getByText(text, { selector: '.bubble' }).closest('article')!;
    // A вложен в .children корня и сам не плоский
    expect(articleOf('A').parentElement).toHaveClass('children');
    expect(articleOf('A').parentElement).not.toHaveClass('flat');
    // у каждого ответа есть кнопка «в ответ <автор родителя>» (у A — автор заглавного)
    expect(articleOf('A').querySelector(':scope > .replyMain > .replyTo')).toHaveTextContent(`в ответ ${root.user.userName}`);

    // потомки A — один плоский список в порядке обхода: B, C, A2
    const flat = container.querySelector('.children.flat')!;
    const flatTexts = [...flat.querySelectorAll(':scope > article .bubble')].map((el) => el.textContent);
    expect(flatTexts).toEqual(['B', 'C', 'A2']);
    expect(within(articleOf('B')).getByText('Ann')).toBeInTheDocument();
    expect(within(articleOf('C')).getByText('Bob', { selector: 'strong' })).toBeInTheDocument();
    expect(container.querySelectorAll('.children.flat')).toHaveLength(1);
  });

  it('цепочка из 1000 уровней: без рекурсии, по 10 с «Показать ещё» и «Показать все»', async () => {
    const root = makeTopLevel({ uuid: 'deep' });
    root.replies = makeChain(root, 1000);
    const { container } = renderTable([root]);

    const flatArticles = () => container.querySelectorAll('.children.flat > article').length;
    expect(flatArticles()).toBe(10);
    expect(screen.getByText('level 1')).toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: 'Показать ещё 10' }));
    expect(flatArticles()).toBe(20);
    expect(screen.getByRole('button', { name: 'Показать все (979)' })).toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: 'Показать все (979)' }));
    expect(flatArticles()).toBe(999);
    expect(screen.getByText('level 1000')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Показать/ })).not.toBeInTheDocument();
    // 999 карточек в jsdom под инструментированием покрытия рендерятся несколько секунд
  }, 30_000);

  it('«Показать ещё» показывает остаток, если его меньше 10', async () => {
    const root = makeTopLevel({ uuid: 'r' });
    root.replies = makeChain(root, 14);
    renderTable([root]);
    await userEvent.click(screen.getByRole('button', { name: 'Показать ещё 3' }));
    expect(screen.queryByRole('button', { name: /Показать/ })).not.toBeInTheDocument();
  });

  it.each([
    [1, '1 ответ'],
    [2, '2 ответа'],
    [4, '4 ответа'],
    [5, '5 ответов'],
    [11, '11 ответов'],
    [12, '12 ответов'],
    [21, '21 ответ'],
    [22, '22 ответа'],
  ])('%i прямых ответов → «%s»', (count, label) => {
    const root = makeTopLevel({ uuid: `p${count}` });
    root.replies = Array.from({ length: count }, () => makeComment({ parentUuid: root.uuid, rootUuid: root.uuid }));
    renderTable([root]);
    expect(screen.getByText(label)).toBeInTheDocument();
  });

  it('«Ответить» вызывает onReply; открытая форма — «Отменить», отмена и отправка формы', async () => {
    const root = makeTopLevel({ uuid: 'r1' });
    const { onReply, onCreated, rerender, ...rest } = renderTable([root]);

    await userEvent.click(screen.getByRole('button', { name: 'Ответить' }));
    expect(onReply).toHaveBeenLastCalledWith('r1');

    rerender(<CommentsTable {...rest} items={[root]} onReply={onReply} onCreated={onCreated} replyTo="r1" />);
    expect(screen.getByTestId('reply-form')).toHaveAttribute('data-parent', 'r1');
    expect(screen.getByRole('button', { name: 'Отменить' })).toHaveClass('actionButtonActive');

    await userEvent.click(screen.getByRole('button', { name: 'Отменить' }));
    expect(onReply).toHaveBeenLastCalledWith(null);

    onReply.mockClear();
    await userEvent.click(screen.getByText('cancel-form'));
    expect(onReply).toHaveBeenLastCalledWith(null);

    onReply.mockClear();
    await userEvent.click(screen.getByText('submit-form'));
    expect(onReply).toHaveBeenLastCalledWith(null);
    expect(onCreated).toHaveBeenCalledWith({ uuid: 'new' });
  });

  it('ответ на ответ открывает форму внутри нужной карточки; свежий ответ подсвечен', () => {
    const root = makeTopLevel({ uuid: 'r' });
    const reply = makeComment({ uuid: 'x', parentUuid: 'r', rootUuid: 'r', text: 'child' });
    root.replies = [reply];
    renderTable([root], { replyTo: 'x', freshUuids: new Set(['x']) });

    const article = screen.getByText('child').closest('article')!;
    expect(within(article).getByTestId('reply-form')).toHaveAttribute('data-parent', 'x');
    expect(article).toHaveClass('fresh');
  });

  it('ответ без parentUuid в replies игнорируется при группировке', () => {
    const root = makeTopLevel({ uuid: 'r' });
    root.replies = [makeComment({ parentUuid: null, rootUuid: 'r', text: 'orphan' })];
    renderTable([root]);
    expect(screen.queryByText('orphan')).not.toBeInTheDocument();
  });

  describe('«в ответ …» — переход к родительскому комментарию', () => {
    const tree = () => {
      const root = makeTopLevel({ uuid: 'root' });
      const a = makeComment({ uuid: 'a', parentUuid: 'root', rootUuid: 'root', text: 'A', user: { userName: 'Ann', email: 'a@ex.com', homePage: null } });
      const b = makeComment({ uuid: 'b', parentUuid: 'a', rootUuid: 'root', text: 'B', user: { userName: 'Bob', email: 'b@ex.com', homePage: null } });
      const c = makeComment({ uuid: 'c', parentUuid: 'b', rootUuid: 'root', text: 'C' });
      root.replies = [a, b, c];
      return root;
    };
    const articleOf = (text: string) => screen.getByText(text, { selector: '.bubble' }).closest('article')!;

    it('клик прокручивает к родительскому ответу, ставит фокус и подсвечивает на 2 с', async () => {
      vi.useFakeTimers({ shouldAdvanceTime: true });
      const scroll = vi.fn();
      Element.prototype.scrollIntoView = scroll;
      renderTable([tree()]);

      const parent = document.getElementById('comment-b')!;
      expect(parent).toBe(articleOf('B'));

      await userEvent.click(within(articleOf('C')).getByRole('button', { name: /в ответ Bob/ }));

      expect(scroll).toHaveBeenCalledTimes(1);
      expect(scroll.mock.contexts[0]).toBe(parent);
      expect(scroll).toHaveBeenCalledWith({ behavior: 'smooth', block: 'start' });
      expect(document.activeElement).toBe(parent);
      expect(parent).toHaveClass('flash');

      vi.advanceTimersByTime(2000);
      expect(parent).not.toHaveClass('flash');
      vi.useRealTimers();
    });

    it('ответ первого уровня ведёт к карточке заглавного комментария', async () => {
      const scroll = vi.fn();
      Element.prototype.scrollIntoView = scroll;
      const root = tree();
      renderTable([root]);

      await userEvent.click(within(articleOf('A')).getByRole('button', { name: new RegExp(`в ответ ${root.user.userName}`) }));

      const card = document.getElementById('comment-root')!;
      expect(card.tagName).toBe('TBODY');
      expect(scroll.mock.contexts[0]).toBe(card);
      expect(card).toHaveClass('flash');
    });

    it('при «уменьшить движение» прокрутка без анимации', async () => {
      const scroll = vi.fn();
      Element.prototype.scrollIntoView = scroll;
      window.matchMedia = vi.fn().mockReturnValue({ matches: true }) as unknown as typeof window.matchMedia;
      renderTable([tree()]);

      await userEvent.click(within(articleOf('C')).getByRole('button', { name: /в ответ Bob/ }));
      expect(scroll).toHaveBeenCalledWith({ behavior: 'auto', block: 'start' });
      // @ts-expect-error — в jsdom matchMedia нет, возвращаем как было
      delete window.matchMedia;
    });
  });
});
