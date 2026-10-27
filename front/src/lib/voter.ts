import { api, ApiError } from './api';

// Анонимный голосующий: JWT со случайным voterId выдаёт сервер, браузер хранит его в localStorage
const STORAGE_KEY = 'comments.voterToken';
let pending: Promise<string> | null = null;

function readStored(): string | null {
  try {
    return localStorage.getItem(STORAGE_KEY);
  } catch {
    return null;
  }
}

function store(token: string | null) {
  try {
    if (token) localStorage.setItem(STORAGE_KEY, token);
    else localStorage.removeItem(STORAGE_KEY);
  } catch {
    // без хранилища токен живёт до перезагрузки страницы
  }
}

export function getVoterToken(): Promise<string> {
  const stored = readStored();
  if (stored) return Promise.resolve(stored);

  pending ??= api
    .issueVoterToken()
    .then(({ token }) => {
      store(token);
      return token;
    })
    .finally(() => {
      pending = null;
    });
  return pending;
}

// Выполняет запрос с токеном; протухший/чужой токен (401) один раз меняется на новый
export async function withVoterToken<T>(fn: (token: string) => Promise<T>): Promise<T> {
  try {
    return await fn(await getVoterToken());
  } catch (e) {
    if (!(e instanceof ApiError) || e.status !== 401) throw e;
    store(null);
    return await fn(await getVoterToken());
  }
}
