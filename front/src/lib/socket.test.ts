import { describe, expect, it, vi } from 'vitest';

const io = vi.fn(() => ({ id: 'sock' }));
vi.mock('socket.io-client', () => ({ io }));

describe('getCommentsSocket', () => {
  it('создаёт одно websocket-подключение к /comments и переиспользует его', async () => {
    const { getCommentsSocket } = await import('./socket');
    const { API_URL } = await import('./config');

    const first = getCommentsSocket();
    const second = getCommentsSocket();

    expect(first).toBe(second);
    expect(io).toHaveBeenCalledTimes(1);
    expect(io).toHaveBeenCalledWith(`${API_URL}/comments`, { transports: ['websocket'], autoConnect: true });
  });
});
