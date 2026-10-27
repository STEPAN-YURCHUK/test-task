import { afterEach, describe, expect, it, vi } from 'vitest';
import { commentDomId, jumpToComment } from './jumpToComment';

describe('jumpToComment', () => {
  afterEach(() => {
    document.body.innerHTML = '';
  });

  it('id карточки', () => {
    expect(commentDomId('abc')).toBe('comment-abc');
  });

  it('комментария нет на странице → false, ничего не делает', () => {
    expect(jumpToComment('missing')).toBe(false);
  });

  it('повторный клик перезапускает подсветку', () => {
    const el = document.createElement('article');
    el.id = 'comment-x';
    el.tabIndex = -1;
    el.scrollIntoView = vi.fn();
    document.body.append(el);

    expect(jumpToComment('x')).toBe(true);
    const removeSpy = vi.spyOn(el.classList, 'remove');
    expect(jumpToComment('x')).toBe(true);

    expect(removeSpy).toHaveBeenCalledWith('flash');
    expect(el).toHaveClass('flash');
    expect(el.scrollIntoView).toHaveBeenCalledTimes(2);
  });
});
