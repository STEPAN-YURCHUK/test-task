import { beforeEach, describe, expect, it, vi } from 'vitest';
import { api, ApiError } from './api';
import { API_BASE } from './config';

const fetchMock = vi.fn();

const respond = (status: number, body: unknown) =>
  fetchMock.mockResolvedValueOnce({
    ok: status >= 200 && status < 300,
    status,
    json: () => (body === undefined ? Promise.reject(new Error('no body')) : Promise.resolve(body)),
  });

const lastCall = () => {
  const [url, init] = fetchMock.mock.calls.at(-1)!;
  return { url: url as string, init: init as RequestInit, headers: new Headers((init as RequestInit).headers) };
};

beforeEach(() => {
  fetchMock.mockReset();
  vi.stubGlobal('fetch', fetchMock);
});

describe('request', () => {
  it('успешный ответ: JSON, Accept-Language и no-store', async () => {
    respond(200, { token: 't' });
    await expect(api.getCaptcha()).resolves.toEqual({ token: 't' });

    const { url, init } = lastCall();
    expect(url).toBe(`${API_BASE}/captcha`);
    expect(lastCall().headers.get('Accept-Language')).toBe('ru');
    expect(init.cache).toBe('no-store');
  });

  it('ошибка API → ApiError со status, code, message и errors', async () => {
    respond(400, { code: 'not_valid_data', message: 'Ошибка валидации', errors: { email: ['Неверный формат e-mail'] } });
    const error = await api.preview('x').catch((e) => e);

    expect(error).toBeInstanceOf(ApiError);
    expect(error).toMatchObject({ status: 400, code: 'not_valid_data', message: 'Ошибка валидации', errors: { email: ['Неверный формат e-mail'] } });
  });

  it('ошибка без тела → общее сообщение и пустые errors', async () => {
    respond(500, undefined);
    const error = await api.getCaptcha().catch((e) => e);

    expect(error).toMatchObject({ status: 500, code: undefined, message: 'Ошибка запроса', errors: {} });
  });

  it('сетевая ошибка → network_error', async () => {
    fetchMock.mockRejectedValueOnce(new TypeError('Failed to fetch'));
    const error = await api.getCaptcha().catch((e) => e);

    expect(error).toMatchObject({ status: 0, code: 'network_error', message: 'Сервер недоступен. Проверьте соединение.' });
  });
});

describe('методы', () => {
  it('getComments — query string', async () => {
    respond(200, { items: [] });
    await api.getComments({ page: 2, sortBy: 'userName', sortOrder: 'ASC' });
    expect(lastCall().url).toBe(`${API_BASE}/comments?page=2&sortBy=userName&sortOrder=ASC`);
  });

  it('preview — POST JSON', async () => {
    respond(200, { html: '<i>x</i>' });
    await api.preview('<i>x</i>');
    const { url, init } = lastCall();
    expect(url).toBe(`${API_BASE}/comments/preview`);
    expect(init.method).toBe('POST');
    expect(lastCall().headers.get('Content-Type')).toBe('application/json');
    expect(JSON.parse(init.body as string)).toEqual({ text: '<i>x</i>' });
  });

  it('createComment — FormData без Content-Type (его ставит браузер)', async () => {
    respond(201, { uuid: '1' });
    const form = new FormData();
    await api.createComment(form);
    const { init } = lastCall();
    expect(init.body).toBe(form);
    expect(lastCall().headers.get('Content-Type')).toBeNull();
  });

  it('initUpload / refreshUploadParts / completeUpload / getUpload', async () => {
    respond(201, {});
    await api.initUpload('a.png', 10);
    expect(lastCall().url).toBe(`${API_BASE}/uploads`);
    expect(JSON.parse(lastCall().init.body as string)).toEqual({ filename: 'a.png', size: 10 });

    respond(200, {});
    await api.refreshUploadParts('u1');
    expect(lastCall()).toMatchObject({ url: `${API_BASE}/uploads/u1/parts`, init: { method: 'POST' } });

    respond(200, {});
    await api.completeUpload('u1');
    expect(lastCall()).toMatchObject({ url: `${API_BASE}/uploads/u1/complete`, init: { method: 'POST' } });

    respond(200, {});
    await api.getUpload('u1');
    expect(lastCall().url).toBe(`${API_BASE}/uploads/u1`);
  });

  it('abortUpload — DELETE, ошибки сети глотаются', async () => {
    fetchMock.mockRejectedValueOnce(new Error('offline'));
    await expect(api.abortUpload('u1')).resolves.toBeUndefined();
    expect(fetchMock).toHaveBeenCalledWith(`${API_BASE}/uploads/u1`, { method: 'DELETE' });
  });

  it('issueVoterToken / vote / myVotes — Authorization: Bearer', async () => {
    respond(201, { token: 'tok' });
    await api.issueVoterToken();
    expect(lastCall()).toMatchObject({ url: `${API_BASE}/comments/voters`, init: { method: 'POST' } });

    respond(200, { likesCount: 1 });
    await api.vote('tok', 'c1', -1);
    expect(lastCall().url).toBe(`${API_BASE}/comments/c1/vote`);
    expect(lastCall().init.method).toBe('PUT');
    expect(lastCall().headers.get('Authorization')).toBe('Bearer tok');
    expect(JSON.parse(lastCall().init.body as string)).toEqual({ value: -1 });

    respond(200, {});
    await api.myVotes('tok', ['a', 'b']);
    expect(lastCall().url).toBe(`${API_BASE}/comments/votes/my`);
    expect(lastCall().headers.get('Authorization')).toBe('Bearer tok');
    expect(JSON.parse(lastCall().init.body as string)).toEqual({ uuids: ['a', 'b'] });
  });
});
