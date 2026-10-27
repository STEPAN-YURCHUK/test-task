import { Logger } from '@nestjs/common';
import { DISPOSABLE_EMAIL_CACHE_KEY, DISPOSABLE_EMAIL_LOCK_KEY, DISPOSABLE_EMAIL_SOURCES } from '../constants/disposable-email.const';
import { DisposableEmailService } from './disposable-email.service';

const [PRIMARY, SECONDARY] = DISPOSABLE_EMAIL_SOURCES;
const flush = () => new Promise((r) => setImmediate(r));

const createRedis = () => {
    const store = new Map<string, string>();
    return {
        store,
        get: jest.fn(async (key: string) => store.get(key) ?? null),
        set: jest.fn(async (key: string, value: string, ...args: unknown[]) => {
            if (args.includes('NX') && store.has(key)) return null;
            store.set(key, value);
            return 'OK';
        }),
        del: jest.fn(async (key: string) => Number(store.delete(key))),
    };
};

const textResponse = (body: string, ok = true, status = 200) => ({ ok, status, text: async () => body }) as Response;

describe('DisposableEmailService', () => {
    const env = { ...process.env };
    let redis: ReturnType<typeof createRedis>;
    let service: DisposableEmailService;
    let fetchMock: jest.SpyInstance;

    beforeEach(() => {
        delete process.env.DISPOSABLE_EMAIL_AUTO_REFRESH;
        jest.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);
        jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
        redis = createRedis();
        service = new DisposableEmailService(redis as any);
        fetchMock = jest
            .spyOn(globalThis, 'fetch')
            .mockImplementation(async (url) =>
                textResponse(
                    url === PRIMARY ? '# list\nmailinator.com\nyopmail.com\n' : 'temp-mail.org\nprivaterelay.appleid.com\nmailinator.com\n',
                ),
            );
    });
    afterEach(() => {
        service.onModuleDestroy();
        jest.restoreAllMocks();
        jest.useRealTimers();
    });
    afterAll(() => {
        process.env = env;
    });

    describe('isDisposable / checkNotDisposableOrThrow', () => {
        beforeEach(() => service.refresh());

        it.each([
            ['john@mailinator.com', true],
            ['John@YOPMAIL.com', true],
            ['x@inbox.temp-mail.org', true],
            ['john@gmail.com', false],
            ['not-an-email', false],
            ['', false],
        ])('%s → %s', (email, expected) => {
            expect(service.isDisposable(email)).toBe(expected);
        });

        it('скрытая почта Apple в allowlist — даже если есть в источнике', () => {
            expect(service.isDisposable('abc123@privaterelay.appleid.com')).toBe(false);
        });

        it('бросает 400 disposable_email_not_allowed', () => {
            expect(() => service.checkNotDisposableOrThrow('a@mailinator.com')).toThrow(
                expect.objectContaining({ message: 'disposable_email_not_allowed', status: 400 }),
            );
            expect(() => service.checkNotDisposableOrThrow('a@gmail.com')).not.toThrow();
        });
    });

    it('пока список не загружен, домены не проверяются (недоступный источник не закрывает комментарии)', () => {
        expect(service.loadedCount).toBe(0);
        expect(service.isDisposable('a@mailinator.com')).toBe(false);
    });

    describe('refresh', () => {
        it('объединяет оба источника без дублей, кладёт в Redis на 7 дней и снимает блокировку', async () => {
            await service.refresh();

            expect(fetchMock).toHaveBeenCalledWith(PRIMARY, expect.objectContaining({ signal: expect.any(AbortSignal) }));
            expect(fetchMock).toHaveBeenCalledWith(SECONDARY, expect.anything());
            expect(service.loadedCount).toBe(3);
            expect(redis.set).toHaveBeenCalledWith(DISPOSABLE_EMAIL_CACHE_KEY, expect.any(String), 'EX', 604800);
            expect(JSON.parse(redis.store.get(DISPOSABLE_EMAIL_CACHE_KEY)!).sort()).toEqual([
                'mailinator.com',
                'temp-mail.org',
                'yopmail.com',
            ]);
            expect(redis.store.has(DISPOSABLE_EMAIL_LOCK_KEY)).toBe(false);
        });

        it('другой экземпляр уже обновляет (блокировка занята) — пропуск без скачивания', async () => {
            redis.store.set(DISPOSABLE_EMAIL_LOCK_KEY, '1');
            await service.refresh();
            expect(fetchMock).not.toHaveBeenCalled();
        });

        it('кеш не сохранился (ошибка без message) — список всё равно обновлён', async () => {
            redis.set.mockImplementation(async (key: string) => {
                if (key === DISPOSABLE_EMAIL_CACHE_KEY) throw 'plain';
                return 'OK';
            });
            await service.refresh();
            expect(service.loadedCount).toBe(3);
            expect(Logger.prototype.warn).toHaveBeenCalledWith(expect.stringContaining('cache not saved: plain'));
        });

        it('Redis недоступен — обновление всё равно идёт, ошибки кеша не роняют', async () => {
            redis.set.mockRejectedValue(new Error('redis down'));
            redis.del.mockRejectedValue(new Error('redis down'));
            await expect(service.refresh()).resolves.toBeUndefined();
            expect(service.loadedCount).toBe(3);
        });

        it('повторы с паузой; источник так и не ответил — список из второго', async () => {
            jest.useFakeTimers();
            fetchMock.mockImplementation(async (url) => (url === PRIMARY ? textResponse('', false, 503) : textResponse('only.com')));

            const done = service.refresh();
            await jest.advanceTimersByTimeAsync(1000 + 2000);
            await done;

            expect(fetchMock.mock.calls.filter(([url]) => url === PRIMARY)).toHaveLength(3);
            expect(service.isDisposable('a@only.com')).toBe(true);
        });

        it('оба источника пустые/недоступны — прежний список остаётся', async () => {
            await service.refresh();
            jest.useFakeTimers();
            fetchMock.mockRejectedValue(new Error('offline'));

            const done = service.refresh();
            await jest.advanceTimersByTimeAsync(3000);
            await done;

            expect(service.loadedCount).toBe(3);
            expect(Logger.prototype.warn).toHaveBeenCalledWith(expect.stringContaining('keeping the previous list'));
        });

        it('ошибка без message тоже логируется', async () => {
            jest.useFakeTimers();
            fetchMock.mockRejectedValue('plain');
            const done = service.refresh();
            await jest.advanceTimersByTimeAsync(3000);
            await done;
            expect(Logger.prototype.warn).toHaveBeenCalledWith(expect.stringContaining('plain'));
        });
    });

    describe('loadFromCacheOrRefresh', () => {
        it('список из Redis — без скачивания', async () => {
            redis.store.set(DISPOSABLE_EMAIL_CACHE_KEY, JSON.stringify(['cached.com']));
            await service.loadFromCacheOrRefresh();
            expect(fetchMock).not.toHaveBeenCalled();
            expect(service.isDisposable('a@cached.com')).toBe(true);
        });

        it('кеша нет — скачивает', async () => {
            await service.loadFromCacheOrRefresh();
            expect(fetchMock).toHaveBeenCalledTimes(2);
        });

        it('Redis недоступен при чтении — скачивает', async () => {
            redis.get.mockRejectedValue(new Error('redis down'));
            await service.loadFromCacheOrRefresh();
            expect(service.loadedCount).toBe(3);
        });

        it('ошибка чтения без message', async () => {
            redis.get.mockRejectedValue('plain');
            await service.loadFromCacheOrRefresh();
            expect(Logger.prototype.warn).toHaveBeenCalledWith(expect.stringContaining('plain'));
        });
    });

    describe('onApplicationBootstrap', () => {
        it('загрузка в фоне и обновление раз в сутки', async () => {
            jest.useFakeTimers();
            const refresh = jest.spyOn(service, 'refresh');

            service.onApplicationBootstrap();
            await jest.advanceTimersByTimeAsync(0);
            expect(fetchMock).toHaveBeenCalledTimes(2);

            await jest.advanceTimersByTimeAsync(24 * 60 * 60 * 1000);
            expect(refresh).toHaveBeenCalledTimes(2);
        });

        it('DISPOSABLE_EMAIL_AUTO_REFRESH=false — ничего не качает (тесты)', async () => {
            process.env.DISPOSABLE_EMAIL_AUTO_REFRESH = 'false';
            service.onApplicationBootstrap();
            await flush();
            expect(fetchMock).not.toHaveBeenCalled();
        });

        it('onModuleDestroy без таймера — без ошибок', () => {
            expect(() => new DisposableEmailService(redis as any).onModuleDestroy()).not.toThrow();
        });
    });
});
