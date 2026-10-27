import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { api, ApiError } from './api';
import { getVoterToken, withVoterToken } from './voter';

const KEY = 'comments.voterToken';

beforeEach(() => {
  localStorage.clear();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('getVoterToken', () => {
  it('берёт токен из localStorage без запроса', async () => {
    localStorage.setItem(KEY, 'stored');
    const issue = vi.spyOn(api, 'issueVoterToken');

    await expect(getVoterToken()).resolves.toBe('stored');
    expect(issue).not.toHaveBeenCalled();
  });

  it('параллельные вызовы делают один запрос и сохраняют токен', async () => {
    const issue = vi.spyOn(api, 'issueVoterToken').mockResolvedValue({ token: 'new' });

    const [a, b] = await Promise.all([getVoterToken(), getVoterToken()]);
    expect([a, b]).toEqual(['new', 'new']);
    expect(issue).toHaveBeenCalledTimes(1);
    expect(localStorage.getItem(KEY)).toBe('new');
  });

  it('после ошибки следующий вызов делает новый запрос', async () => {
    const issue = vi.spyOn(api, 'issueVoterToken').mockRejectedValueOnce(new Error('down')).mockResolvedValueOnce({ token: 'ok' });

    await expect(getVoterToken()).rejects.toThrow('down');
    await expect(getVoterToken()).resolves.toBe('ok');
    expect(issue).toHaveBeenCalledTimes(2);
  });

  it('работает без localStorage (приватный режим)', async () => {
    vi.stubGlobal('localStorage', {
      getItem: () => {
        throw new Error('denied');
      },
      setItem: () => {
        throw new Error('denied');
      },
      removeItem: () => {
        throw new Error('denied');
      },
    });
    vi.spyOn(api, 'issueVoterToken').mockResolvedValue({ token: 'mem' });

    await expect(getVoterToken()).resolves.toBe('mem');
  });
});

describe('withVoterToken', () => {
  it('передаёт токен в функцию', async () => {
    localStorage.setItem(KEY, 't1');
    await expect(withVoterToken(async (token) => `got ${token}`)).resolves.toBe('got t1');
  });

  it('на 401 сбрасывает токен, получает новый и повторяет один раз', async () => {
    localStorage.setItem(KEY, 'stale');
    vi.spyOn(api, 'issueVoterToken').mockResolvedValue({ token: 'fresh' });
    const fn = vi.fn().mockRejectedValueOnce(new ApiError(401, 'invalid_voter_token', 'x')).mockResolvedValueOnce('done');

    await expect(withVoterToken(fn)).resolves.toBe('done');
    expect(fn.mock.calls).toEqual([['stale'], ['fresh']]);
    expect(localStorage.getItem(KEY)).toBe('fresh');
  });

  it('второй 401 пробрасывается (без бесконечных повторов)', async () => {
    localStorage.setItem(KEY, 'stale');
    vi.spyOn(api, 'issueVoterToken').mockResolvedValue({ token: 'fresh' });
    const fn = vi.fn().mockRejectedValue(new ApiError(401, 'invalid_voter_token', 'x'));

    await expect(withVoterToken(fn)).rejects.toMatchObject({ status: 401 });
    expect(fn).toHaveBeenCalledTimes(2);
  });

  it('другие ошибки пробрасываются без повтора', async () => {
    localStorage.setItem(KEY, 't');
    const fn = vi.fn().mockRejectedValue(new ApiError(500, 'internal_server_error', 'x'));
    await expect(withVoterToken(fn)).rejects.toMatchObject({ status: 500 });

    const plain = vi.fn().mockRejectedValue(new Error('boom'));
    await expect(withVoterToken(plain)).rejects.toThrow('boom');
    expect(fn).toHaveBeenCalledTimes(1);
    expect(plain).toHaveBeenCalledTimes(1);
  });
});
