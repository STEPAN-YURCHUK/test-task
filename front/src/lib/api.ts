import { API_BASE } from './config';
import { getLocale, messages } from './i18n';
import type { Captcha, Comment, CommentList, SortBy, SortOrder, UploadInit, UploadStatus, VoteCounters, VoteValue } from '@/types/comment';

export class ApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string | undefined,
    message: string,
    public readonly errors: Record<string, string[]> = {},
  ) {
    super(message);
  }
}

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  // Headers, а не spread: init.headers может быть Headers или массивом пар — spread такие потерял бы
  const headers = new Headers(init.headers);
  if (!headers.has('Accept-Language')) headers.set('Accept-Language', getLocale());

  let response: Response;
  try {
    response = await fetch(`${API_BASE}${path}`, { ...init, headers, cache: 'no-store' });
  } catch {
    throw new ApiError(0, 'network_error', messages().api.network);
  }

  const body = await response.json().catch(() => null);
  if (!response.ok) {
    throw new ApiError(response.status, body?.code, body?.message ?? messages().api.requestFailed, body?.errors ?? {});
  }
  return body as T;
}

export const api = {
  getComments: (params: { page: number; sortBy: SortBy; sortOrder: SortOrder }) =>
    request<CommentList>(`/comments?${new URLSearchParams({ ...params, page: String(params.page) })}`),

  getCaptcha: () => request<Captcha>('/captcha'),

  preview: (text: string) =>
    request<{ html: string }>('/comments/preview', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text }),
    }),

  createComment: (form: FormData) => request<Comment>('/comments', { method: 'POST', body: form }),

  initUpload: (filename: string, size: number) =>
    request<UploadInit>('/uploads', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ filename, size }),
    }),

  refreshUploadParts: (uploadId: string) => request<UploadInit>(`/uploads/${uploadId}/parts`, { method: 'POST' }),

  completeUpload: (uploadId: string) => request<UploadStatus>(`/uploads/${uploadId}/complete`, { method: 'POST' }),

  getUpload: (uploadId: string) => request<UploadStatus>(`/uploads/${uploadId}`),

  abortUpload: (uploadId: string) => fetch(`${API_BASE}/uploads/${uploadId}`, { method: 'DELETE' }).catch(() => undefined),

  issueVoterToken: () => request<{ token: string }>('/comments/voters', { method: 'POST' }),

  vote: (token: string, commentUuid: string, value: VoteValue) =>
    request<VoteCounters & { myVote: VoteValue }>(`/comments/${commentUuid}/vote`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ value }),
    }),

  myVotes: (token: string, uuids: string[]) =>
    request<Record<string, VoteValue>>('/comments/votes/my', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ uuids }),
    }),
};
