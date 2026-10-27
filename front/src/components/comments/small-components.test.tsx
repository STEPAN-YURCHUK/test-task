import { fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { makeComment } from '@/test-utils/fixtures';
import { Avatar } from './Avatar';
import { Pagination } from './Pagination';
import { SortMenu } from './SortMenu';
import { VoteControl } from './VoteControl';
import { VotesContext } from './VotesContext';

describe('VoteControl', () => {
  const comment = makeComment({ uuid: 'c1', likesCount: 3, dislikesCount: 1 });
  const renderWith = (myVotes: Record<string, 1 | -1 | 0>, compact = false) => {
    const vote = vi.fn();
    render(
      <VotesContext.Provider value={{ myVotes, vote }}>
        <VoteControl comment={comment} compact={compact} />
      </VotesContext.Provider>,
    );
    return vote;
  };

  it('без своего голоса: счётчики, клик ставит лайк/дизлайк', async () => {
    const vote = renderWith({});
    const like = screen.getByRole('button', { name: /3/ });
    const dislike = screen.getByRole('button', { name: /1/ });
    expect(like).toHaveAttribute('aria-pressed', 'false');

    await userEvent.click(like);
    expect(vote).toHaveBeenLastCalledWith('c1', 1);
    await userEvent.click(dislike);
    expect(vote).toHaveBeenLastCalledWith('c1', -1);
  });

  it('повторный клик по своему лайку снимает голос', async () => {
    const vote = renderWith({ c1: 1 });
    const like = screen.getByTitle('Нравится');
    expect(like).toHaveAttribute('aria-pressed', 'true');
    expect(like).toHaveClass('voteLiked');
    await userEvent.click(like);
    expect(vote).toHaveBeenCalledWith('c1', 0);
  });

  it('повторный клик по своему дизлайку снимает голос; compact-вариант', async () => {
    const vote = renderWith({ c1: -1 }, true);
    expect(screen.getByRole('group')).toHaveClass('votesCompact');
    const dislike = screen.getByTitle('Не нравится');
    expect(dislike).toHaveClass('voteDisliked');
    await userEvent.click(dislike);
    expect(vote).toHaveBeenCalledWith('c1', 0);
  });

  it('контекст по умолчанию: без провайдера ничего не падает', async () => {
    render(<VoteControl comment={comment} />);
    await userEvent.click(screen.getByTitle('Нравится'));
    expect(screen.getByTitle('Нравится')).toHaveAttribute('aria-pressed', 'false');
  });
});

describe('SortMenu', () => {
  it('показывает текущую сортировку, открывается, выбирает другую', async () => {
    const onChange = vi.fn();
    render(<SortMenu sortBy="createdAt" sortOrder="DESC" onChange={onChange} />);

    const trigger = screen.getByRole('button', { name: /Сначала новые/ });
    expect(trigger).toHaveAttribute('aria-expanded', 'false');
    await userEvent.click(trigger);
    expect(trigger).toHaveAttribute('aria-expanded', 'true');

    const options = screen.getAllByRole('option');
    expect(options).toHaveLength(7);
    expect(screen.getByRole('option', { name: 'Сначала новые' })).toHaveAttribute('aria-selected', 'true');

    await userEvent.click(screen.getByRole('option', { name: 'Популярные' }));
    expect(onChange).toHaveBeenCalledWith('rating', 'DESC');
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument();
  });

  it('клик по текущему варианту просто закрывает меню', async () => {
    const onChange = vi.fn();
    render(<SortMenu sortBy="email" sortOrder="ASC" onChange={onChange} />);
    await userEvent.click(screen.getByRole('button', { name: /E-mail: A → Z/ }));
    await userEvent.click(screen.getByRole('option', { name: 'E-mail: A → Z' }));
    expect(onChange).not.toHaveBeenCalled();
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument();
  });

  it('Escape, клик снаружи и повторный клик по кнопке закрывают меню', async () => {
    render(
      <div>
        <SortMenu sortBy="userName" sortOrder="DESC" onChange={vi.fn()} />
        <p>outside</p>
      </div>,
    );
    const trigger = screen.getByRole('button', { name: /User Name: Z → A/ });

    await userEvent.click(trigger);
    fireEvent.keyDown(document, { key: 'Enter' });
    expect(screen.getByRole('listbox')).toBeInTheDocument();
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument();

    await userEvent.click(trigger);
    fireEvent.mouseDown(screen.getByRole('listbox'));
    expect(screen.getByRole('listbox')).toBeInTheDocument();
    fireEvent.mouseDown(screen.getByText('outside'));
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument();

    await userEvent.click(trigger);
    await userEvent.click(trigger);
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument();
  });

  it('неизвестная комбинация → первый вариант', () => {
    render(<SortMenu sortBy="rating" sortOrder="ASC" onChange={vi.fn()} />);
    expect(screen.getByRole('button', { name: /Сначала новые/ })).toBeInTheDocument();
  });
});

describe('Pagination', () => {
  const pages = () => screen.getAllByRole('button').map((b) => b.textContent);

  it('1 страница — ничего не рендерит', () => {
    const { container } = render(<Pagination page={1} totalPages={1} onChange={vi.fn()} />);
    expect(container).toBeEmptyDOMElement();
  });

  it('до 7 страниц — все номера', () => {
    render(<Pagination page={3} totalPages={7} onChange={vi.fn()} />);
    expect(pages()).toEqual(['←', '1', '2', '3', '4', '5', '6', '7', '→']);
    expect(screen.getByRole('button', { name: '3' })).toHaveAttribute('aria-current', 'true');
    expect(screen.getByRole('button', { name: '3' })).toHaveClass('pageActive');
  });

  it.each([
    [1, ['1', '2', '…', '20']],
    [10, ['1', '…', '9', '10', '11', '…', '20']],
    [3, ['1', '2', '3', '4', '…', '20']],
    [20, ['1', '…', '19', '20']],
  ])('много страниц, текущая %i → %j', (page, expected) => {
    render(<Pagination page={page} totalPages={20} onChange={vi.fn()} />);
    const items = [...screen.getByRole('navigation').children].map((el) => el.textContent).slice(1, -1);
    expect(items).toEqual(expected);
  });

  it('стрелки и номера вызывают onChange, крайние стрелки заблокированы', async () => {
    const onChange = vi.fn();
    const { rerender } = render(<Pagination page={1} totalPages={3} onChange={onChange} />);
    expect(screen.getByRole('button', { name: 'Предыдущая' })).toBeDisabled();
    await userEvent.click(screen.getByRole('button', { name: 'Следующая' }));
    expect(onChange).toHaveBeenLastCalledWith(2);
    await userEvent.click(screen.getByRole('button', { name: '3' }));
    expect(onChange).toHaveBeenLastCalledWith(3);

    rerender(<Pagination page={3} totalPages={3} onChange={onChange} />);
    expect(screen.getByRole('button', { name: 'Следующая' })).toBeDisabled();
    await userEvent.click(screen.getByRole('button', { name: 'Предыдущая' }));
    expect(onChange).toHaveBeenLastCalledWith(2);
  });
});

describe('Avatar', () => {
  it('первая буква в верхнем регистре, стабильный hue для одного имени, размер sm', () => {
    const { container, rerender } = render(<Avatar name="alice" />);
    const el = container.firstElementChild as HTMLElement;
    expect(el).toHaveTextContent('A');
    const hue = el.style.getPropertyValue('--hue');
    expect(Number(hue)).toBeGreaterThanOrEqual(0);
    expect(Number(hue)).toBeLessThan(360);

    rerender(<Avatar name="alice" size="sm" />);
    expect((container.firstElementChild as HTMLElement).style.getPropertyValue('--hue')).toBe(hue);
    expect(container.firstElementChild).toHaveClass('avatarSm');

    rerender(<Avatar name="bob" />);
    expect((container.firstElementChild as HTMLElement).style.getPropertyValue('--hue')).not.toBe(hue);
  });
});
