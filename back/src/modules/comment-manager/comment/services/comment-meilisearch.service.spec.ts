import { Logger } from '@nestjs/common';
import { MeiliIndexEnum } from 'src/infrastructure/meilisearch/enums/meili-index.enum';
import { SortFieldCommentEnum } from '../enums/sort-field-comment.enum';
import { SortOrderEnum } from '../enums/sort-order.enum';
import { CommentMeilisearchService } from './comment-meilisearch.service';

const flush = () => new Promise((r) => setImmediate(r));

const comment = (extra: Record<string, any> = {}) => ({
    uuid: 'c1',
    parentUuid: null,
    rootUuid: null,
    text: 'hi',
    createdAt: new Date('2026-01-02T03:04:05.000Z'),
    user: { uuid: 'u1', userName: 'John', email: 'John@Ex.com', homePage: 'https://j.dev' },
    file: { path: 'a.png' },
    ...extra,
});

const setup = () => {
    const meili = {
        countDocuments: jest.fn(),
        add: jest.fn().mockResolvedValue(undefined),
        addAndWait: jest.fn().mockResolvedValue(undefined),
        update: jest.fn().mockResolvedValue(undefined),
        search: jest.fn().mockResolvedValue({ hits: [] }),
    };
    const repository = { findAllForMeilisearch: jest.fn(), findOne: jest.fn(async () => comment()) };
    return { meili, repository, service: new CommentMeilisearchService(meili as any, repository as any) };
};

describe('CommentMeilisearchService', () => {
    const env = { ...process.env };
    beforeEach(() => {
        delete process.env.MEILI_REINDEX_ON_START;
        jest.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);
        jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
        jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
    });
    afterEach(() => jest.restoreAllMocks());
    afterAll(() => {
        process.env = env;
    });

    describe('handleCommentCreated → документ', () => {
        it('заглавный: isRoot, поля сортировки в нижнем регистре, timestamp', async () => {
            const { service, meili } = setup();
            await service.handleCommentCreated({ comment: comment() as any });
            expect(meili.addAndWait).toHaveBeenCalledWith(MeiliIndexEnum.COMMENT, {
                uuid: 'c1',
                parentUuid: null,
                rootUuid: null,
                isRoot: true,
                text: 'hi',
                likesCount: 0,
                dislikesCount: 0,
                rating: 0,
                createdAt: '2026-01-02T03:04:05.000Z',
                createdAtTs: Date.parse('2026-01-02T03:04:05.000Z'),
                userNameSort: 'john',
                emailSort: 'john@ex.com',
                userUuid: 'u1',
                user: { userName: 'John', email: 'John@Ex.com', homePage: 'https://j.dev' },
                file: { path: 'a.png' },
            });
        });

        it('ответ из модели (toJSON): isRoot=false, без файла и homePage', async () => {
            const { service, meili } = setup();
            const data = comment({
                parentUuid: 'p',
                rootUuid: 'r',
                file: undefined,
                likesCount: 3,
                userUuid: 'u2',
                user: { userName: 'A', email: 'a@b.c' },
            });
            await service.handleCommentCreated({ comment: { toJSON: () => data } as any });
            expect(meili.addAndWait.mock.calls[0][1]).toMatchObject({
                isRoot: false,
                parentUuid: 'p',
                rootUuid: 'r',
                file: null,
                likesCount: 3,
                userUuid: 'u2',
                user: { homePage: null },
            });
        });

        it('новая Home page автора переносится в его прежние документы', async () => {
            const { service, meili } = setup();
            meili.search.mockResolvedValueOnce({
                hits: [
                    { uuid: 'c1', user: { homePage: 'https://j.dev' } },
                    { uuid: 'old1', user: { homePage: 'https://old.dev' } },
                    { uuid: 'old2', user: { homePage: 'https://j.dev' } },
                ],
            });
            await service.handleCommentCreated({ comment: comment() as any });

            expect(meili.search).toHaveBeenCalledWith(MeiliIndexEnum.COMMENT, '', {
                filter: 'userUuid = "u1"',
                attributesToRetrieve: ['uuid', 'user'],
                limit: 100_000,
            });
            expect(meili.update).toHaveBeenCalledWith(MeiliIndexEnum.COMMENT, [
                { uuid: 'old1', user: { userName: 'John', email: 'John@Ex.com', homePage: 'https://j.dev' } },
            ]);
        });

        it('данные автора берутся из Postgres заново: отставший обработчик не откатывает новую Home page', async () => {
            const { service, meili, repository } = setup();
            repository.findOne.mockResolvedValueOnce(
                comment({ user: { uuid: 'u1', userName: 'John', email: 'John@Ex.com', homePage: 'https://new.dev' } }),
            );
            meili.search.mockResolvedValueOnce({
                hits: [
                    { uuid: 'c1', user: { homePage: 'https://j.dev' } },
                    { uuid: 'c2', user: { homePage: 'https://new.dev' } },
                ],
            });

            await service.handleCommentCreated({ comment: comment() as any });

            expect(repository.findOne).toHaveBeenCalledWith('c1');
            expect(meili.update).toHaveBeenCalledWith(MeiliIndexEnum.COMMENT, [
                { uuid: 'c1', user: { userName: 'John', email: 'John@Ex.com', homePage: 'https://new.dev' } },
            ]);
        });

        it('комментарий уже удалён из Postgres → без синхронизации', async () => {
            const { service, meili, repository } = setup();
            repository.findOne.mockResolvedValueOnce(null);
            await service.handleCommentCreated({ comment: comment() as any });
            expect(meili.search).not.toHaveBeenCalled();
        });

        it('все документы автора актуальны → без обновления; без автора → без поиска', async () => {
            const { service, meili } = setup();
            await service.handleCommentCreated({ comment: comment() as any });
            expect(meili.update).not.toHaveBeenCalled();

            await service.handleCommentCreated({ comment: comment({ user: { userName: 'A', email: 'a@b.c' } }) as any });
            expect(meili.search).toHaveBeenCalledTimes(1);
        });

        it('ошибка Meilisearch не пробрасывается', async () => {
            const { service, meili } = setup();
            meili.addAndWait.mockRejectedValue(new Error('down'));
            await expect(service.handleCommentCreated({ comment: comment() as any })).resolves.toBeUndefined();
            expect(Logger.prototype.error).toHaveBeenCalled();
        });

        it('ошибка без message тоже логируется', async () => {
            const { service, meili } = setup();
            meili.update.mockRejectedValue('plain');
            await service.handleVoted({ commentUuid: 'c', likesCount: 0, dislikesCount: 0, rating: 0 });
            expect(Logger.prototype.error).toHaveBeenCalledWith(expect.stringContaining('plain'));
        });
    });

    it('handleVoted — частичное обновление счётчиков', async () => {
        const { service, meili } = setup();
        await service.handleVoted({ commentUuid: 'c1', likesCount: 2, dislikesCount: 1, rating: 1 });
        expect(meili.update).toHaveBeenCalledWith(MeiliIndexEnum.COMMENT, { uuid: 'c1', likesCount: 2, dislikesCount: 1, rating: 1 });
    });

    describe('findAll', () => {
        it.each([
            [SortFieldCommentEnum.CREATED_AT, SortOrderEnum.DESC, ['createdAtTs:desc']],
            [SortFieldCommentEnum.CREATED_AT, SortOrderEnum.ASC, ['createdAtTs:asc']],
            [SortFieldCommentEnum.USER_NAME, SortOrderEnum.ASC, ['userNameSort:asc', 'createdAtTs:desc']],
            [SortFieldCommentEnum.EMAIL, SortOrderEnum.DESC, ['emailSort:desc', 'createdAtTs:desc']],
            [SortFieldCommentEnum.RATING, SortOrderEnum.DESC, ['rating:desc', 'createdAtTs:desc']],
        ])('%s %s → sort %j', async (sortBy, sortOrder, sort) => {
            const { service, meili } = setup();
            meili.search.mockResolvedValueOnce({ hits: [], totalHits: 0 });
            await service.findAll({ limit: 25, offset: 50, sortBy, sortOrder });
            expect(meili.search).toHaveBeenCalledWith(MeiliIndexEnum.COMMENT, '', {
                filter: 'isRoot = true',
                sort,
                page: 3,
                hitsPerPage: 25,
            });
        });

        it('пустые корни — второй запрос не делается', async () => {
            const { service, meili } = setup();
            meili.search.mockResolvedValueOnce({ hits: [] });
            expect(
                await service.findAll({ limit: 25, offset: 0, sortBy: SortFieldCommentEnum.CREATED_AT, sortOrder: SortOrderEnum.DESC }),
            ).toEqual({
                rows: [],
                count: 0,
                replies: [],
            });
            expect(meili.search).toHaveBeenCalledTimes(1);
        });

        it('ответы веток — фильтр rootUuid IN [...] по возрастанию', async () => {
            const { service, meili } = setup();
            meili.search
                .mockResolvedValueOnce({ hits: [{ uuid: 'a' }, { uuid: 'b' }], totalHits: 2 })
                .mockResolvedValueOnce({ hits: [{ uuid: 'x' }] });
            const result = await service.findAll({
                limit: 25,
                offset: 0,
                sortBy: SortFieldCommentEnum.CREATED_AT,
                sortOrder: SortOrderEnum.DESC,
            });
            expect(meili.search).toHaveBeenLastCalledWith(MeiliIndexEnum.COMMENT, '', {
                filter: 'rootUuid IN ["a", "b"]',
                sort: ['createdAtTs:asc'],
                limit: 100_000,
            });
            expect(result).toEqual({ rows: [{ uuid: 'a' }, { uuid: 'b' }], count: 2, replies: [{ uuid: 'x' }] });
        });
    });

    describe('reindexAll', () => {
        it('идёт батчами по 1000 keyset-курсором (uuid последней строки) до пустого', async () => {
            const { service, meili, repository } = setup();
            const batch = Array.from({ length: 1000 }, (_, i) => comment({ uuid: `c${String(i).padStart(4, '0')}` }));
            repository.findAllForMeilisearch
                .mockResolvedValueOnce(batch)
                .mockResolvedValueOnce([comment({ uuid: 'last' })])
                .mockResolvedValueOnce([]);
            await service.reindexAll();
            expect(repository.findAllForMeilisearch.mock.calls).toEqual([
                [null, 1000],
                ['c0999', 1000],
                ['last', 1000],
            ]);
            expect(meili.add).toHaveBeenCalledTimes(2);
            expect(meili.add.mock.calls[0][1]).toHaveLength(1000);
        });
    });

    describe('onApplicationBootstrap', () => {
        it('пустой индекс → переиндексация', async () => {
            const { service, meili, repository } = setup();
            meili.countDocuments.mockResolvedValue(0);
            repository.findAllForMeilisearch.mockResolvedValue([]);
            await service.onApplicationBootstrap();
            await flush();
            expect(repository.findAllForMeilisearch).toHaveBeenCalled();
        });

        it('непустой индекс → без переиндексации', async () => {
            const { service, meili, repository } = setup();
            meili.countDocuments.mockResolvedValue(10);
            await service.onApplicationBootstrap();
            expect(repository.findAllForMeilisearch).not.toHaveBeenCalled();
        });

        it('MEILI_REINDEX_ON_START=true → переиндексация даже непустого', async () => {
            process.env.MEILI_REINDEX_ON_START = 'true';
            const { service, meili, repository } = setup();
            meili.countDocuments.mockResolvedValue(10);
            repository.findAllForMeilisearch.mockResolvedValue([]);
            await service.onApplicationBootstrap();
            await flush();
            expect(repository.findAllForMeilisearch).toHaveBeenCalled();
        });

        it('ошибка переиндексации логируется, не роняет старт', async () => {
            const { service, meili, repository } = setup();
            meili.countDocuments.mockResolvedValue(0);
            repository.findAllForMeilisearch.mockRejectedValue(new Error('db down'));
            await service.onApplicationBootstrap();
            await flush();
            expect(Logger.prototype.error).toHaveBeenCalledWith(expect.stringContaining('db down'));
        });

        it('ошибка переиндексации без message', async () => {
            const { service, meili, repository } = setup();
            meili.countDocuments.mockResolvedValue(0);
            repository.findAllForMeilisearch.mockRejectedValue('oops');
            await service.onApplicationBootstrap();
            await flush();
            expect(Logger.prototype.error).toHaveBeenCalledWith(expect.stringContaining('oops'));
        });

        it('Meilisearch недоступен → предупреждение', async () => {
            const { service, meili } = setup();
            meili.countDocuments.mockRejectedValue(new Error('ECONNREFUSED'));
            await expect(service.onApplicationBootstrap()).resolves.toBeUndefined();
            expect(Logger.prototype.warn).toHaveBeenCalledWith(expect.stringContaining('ECONNREFUSED'));
        });

        it('недоступен без message', async () => {
            const { service, meili } = setup();
            meili.countDocuments.mockRejectedValue('nope');
            await service.onApplicationBootstrap();
            expect(Logger.prototype.warn).toHaveBeenCalledWith(expect.stringContaining('nope'));
        });
    });
});
