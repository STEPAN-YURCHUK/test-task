import { Logger } from '@nestjs/common';
import { MeiliIndexEnum } from './enums/meili-index.enum';
import { initMeili, meiliIndexUid, reconfigureMeiliIndex } from './meilisearch.init';
import { MeiliSearchService } from './services/meilisearch.service';

const task = (status = 'succeeded', error?: string) => ({
    waitTask: jest.fn().mockResolvedValue({ uid: 1, status, error: error ? { message: error } : null }),
});

const createMeili = () => {
    const index = {
        updateSettings: jest.fn(() => task()),
        addDocuments: jest.fn().mockResolvedValue('added'),
        updateDocuments: jest.fn().mockResolvedValue('updated'),
        getStats: jest.fn().mockResolvedValue({ numberOfDocuments: 7 }),
        search: jest.fn(),
        deleteAllDocuments: jest.fn(() => task()),
    };
    return {
        indexObj: index,
        index: jest.fn(() => index),
        getIndex: jest.fn(),
        createIndex: jest.fn(() => task()),
        deleteIndex: jest.fn(() => task()),
        tasks: { getTasks: jest.fn(), waitForTasks: jest.fn() },
    };
};

describe('meilisearch.init', () => {
    const env = { ...process.env };
    beforeEach(() => {
        delete process.env.MEILI_INDEX_PREFIX;
        jest.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);
        jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
    });
    afterEach(() => jest.restoreAllMocks());
    afterAll(() => {
        process.env = env;
    });

    it('meiliIndexUid учитывает MEILI_INDEX_PREFIX', () => {
        expect(meiliIndexUid(MeiliIndexEnum.COMMENT)).toBe('comments');
        process.env.MEILI_INDEX_PREFIX = 'test_';
        expect(meiliIndexUid(MeiliIndexEnum.COMMENT)).toBe('test_comments');
    });

    it('индекс есть с правильным ключом — только настройки', async () => {
        const meili = createMeili();
        meili.getIndex.mockResolvedValue({ primaryKey: 'uuid' });
        await reconfigureMeiliIndex(meili as any, MeiliIndexEnum.COMMENT);
        expect(meili.createIndex).not.toHaveBeenCalled();
        expect(meili.indexObj.updateSettings).toHaveBeenCalledWith(
            expect.objectContaining({ filterableAttributes: ['isRoot', 'rootUuid', 'userUuid'], pagination: { maxTotalHits: 1_000_000 } }),
        );
    });

    it('индекса нет — создаётся с primaryKey uuid', async () => {
        const meili = createMeili();
        meili.getIndex.mockRejectedValue(new Error('index_not_found'));
        await reconfigureMeiliIndex(meili as any, MeiliIndexEnum.COMMENT);
        expect(meili.createIndex).toHaveBeenCalledWith('comments', { primaryKey: 'uuid' });
    });

    it('неверный primaryKey — удаляется и создаётся заново', async () => {
        const meili = createMeili();
        meili.getIndex.mockResolvedValue({ primaryKey: 'id' });
        await reconfigureMeiliIndex(meili as any, MeiliIndexEnum.COMMENT);
        expect(meili.deleteIndex).toHaveBeenCalledWith('comments');
        expect(meili.createIndex).toHaveBeenCalled();
    });

    it('задача настроек упала → ошибка с текстом', async () => {
        const meili = createMeili();
        meili.getIndex.mockResolvedValue({ primaryKey: 'uuid' });
        meili.indexObj.updateSettings.mockReturnValue(task('failed', 'bad setting'));
        await expect(reconfigureMeiliIndex(meili as any, MeiliIndexEnum.COMMENT)).rejects.toThrow('bad setting');
    });

    it('задача упала без текста ошибки', async () => {
        const meili = createMeili();
        meili.getIndex.mockResolvedValue({ primaryKey: 'uuid' });
        meili.indexObj.updateSettings.mockReturnValue(task('failed'));
        await expect(reconfigureMeiliIndex(meili as any, MeiliIndexEnum.COMMENT)).rejects.toThrow('unknown error');
    });

    it('initMeili: ошибка не роняет приложение', async () => {
        const meili = createMeili();
        meili.getIndex.mockResolvedValue({ primaryKey: 'uuid' });
        meili.indexObj.updateSettings.mockImplementation(() => {
            throw new Error('down');
        });
        await expect(initMeili(meili as any)).resolves.toBeUndefined();
        expect(Logger.prototype.error).toHaveBeenCalledWith(expect.stringContaining('down'));
    });

    it('initMeili: ошибка без message', async () => {
        const meili = createMeili();
        meili.getIndex.mockResolvedValue({ primaryKey: 'uuid' });
        meili.indexObj.updateSettings.mockImplementation(() => {
            throw 'raw';
        });
        await initMeili(meili as any);
        expect(Logger.prototype.error).toHaveBeenCalledWith(expect.stringContaining('raw'));
    });

    it('initMeili: успех логируется', async () => {
        const meili = createMeili();
        meili.getIndex.mockResolvedValue({ primaryKey: 'uuid' });
        await initMeili(meili as any);
        expect(Logger.prototype.log).toHaveBeenCalledWith(expect.stringContaining('configured'));
    });
});

describe('MeiliSearchService', () => {
    const env = { ...process.env };
    beforeEach(() => {
        process.env.MEILI_INDEX_PREFIX = 'test_';
        jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    });
    afterEach(() => jest.restoreAllMocks());
    afterAll(() => {
        process.env = env;
    });

    const brokenError = (code: string) => Object.assign(new Error(code), { cause: { code } });

    it('add / update с primaryKey uuid, одиночный документ оборачивается в массив', async () => {
        const meili = createMeili();
        const service = new MeiliSearchService(meili as any);
        await service.add(MeiliIndexEnum.COMMENT, { uuid: 'a' });
        expect(meili.index).toHaveBeenCalledWith('test_comments');
        expect(meili.indexObj.addDocuments).toHaveBeenCalledWith([{ uuid: 'a' }], { primaryKey: 'uuid' });
        await service.update(MeiliIndexEnum.COMMENT, [{ uuid: 'b' }]);
        expect(meili.indexObj.updateDocuments).toHaveBeenCalledWith([{ uuid: 'b' }], { primaryKey: 'uuid' });
        await service.add(MeiliIndexEnum.COMMENT, [{ uuid: 'c' }, { uuid: 'd' }]);
        expect(meili.indexObj.addDocuments).toHaveBeenLastCalledWith([{ uuid: 'c' }, { uuid: 'd' }], { primaryKey: 'uuid' });
        await service.update(MeiliIndexEnum.COMMENT, { uuid: 'e' });
        expect(meili.indexObj.updateDocuments).toHaveBeenLastCalledWith([{ uuid: 'e' }], { primaryKey: 'uuid' });
    });

    it('addAndWait — добавляет и ждёт задачу индексации', async () => {
        const meili = createMeili();
        const enqueued = task();
        meili.indexObj.addDocuments.mockReturnValueOnce(enqueued);
        await new MeiliSearchService(meili as any).addAndWait(MeiliIndexEnum.COMMENT, { uuid: 'a' });
        expect(meili.indexObj.addDocuments).toHaveBeenCalledWith([{ uuid: 'a' }], { primaryKey: 'uuid' });
        expect(enqueued.waitTask).toHaveBeenCalledWith({ timeout: 30_000 });

        meili.indexObj.addDocuments.mockReturnValueOnce(task());
        await new MeiliSearchService(meili as any).addAndWait(MeiliIndexEnum.COMMENT, [{ uuid: 'b' }]);
        expect(meili.indexObj.addDocuments).toHaveBeenLastCalledWith([{ uuid: 'b' }], { primaryKey: 'uuid' });
    });

    it('add массивом и update одиночным документом', async () => {
        const meili = createMeili();
        const service = new MeiliSearchService(meili as any);
        await service.add(MeiliIndexEnum.COMMENT, [{ uuid: 'c' }, { uuid: 'd' }]);
        expect(meili.indexObj.addDocuments).toHaveBeenCalledWith([{ uuid: 'c' }, { uuid: 'd' }], { primaryKey: 'uuid' });
        await service.update(MeiliIndexEnum.COMMENT, { uuid: 'e' });
        expect(meili.indexObj.updateDocuments).toHaveBeenCalledWith([{ uuid: 'e' }], { primaryKey: 'uuid' });
    });
    it('countDocuments', async () => {
        expect(await new MeiliSearchService(createMeili() as any).countDocuments(MeiliIndexEnum.COMMENT)).toBe(7);
    });

    it('clear ждёт удаления', async () => {
        const meili = createMeili();
        await new MeiliSearchService(meili as any).clear(MeiliIndexEnum.COMMENT);
        expect(meili.indexObj.deleteAllDocuments).toHaveBeenCalled();
    });

    it('waitForPendingTasks: ждёт только незавершённые задачи своего индекса', async () => {
        const meili = createMeili();
        meili.tasks.getTasks.mockResolvedValueOnce({ results: [{ uid: 5 }, { uid: 6 }] }).mockResolvedValueOnce({ results: [] });
        const service = new MeiliSearchService(meili as any);
        await service.waitForPendingTasks(MeiliIndexEnum.COMMENT);
        expect(meili.tasks.getTasks).toHaveBeenCalledWith({ indexUids: ['test_comments'], statuses: ['enqueued', 'processing'] });
        expect(meili.tasks.waitForTasks).toHaveBeenCalledWith([5, 6], { timeout: 30_000 });
        await service.waitForPendingTasks(MeiliIndexEnum.COMMENT);
        expect(meili.tasks.waitForTasks).toHaveBeenCalledTimes(1);
    });

    it('search: обычный успех', async () => {
        const meili = createMeili();
        meili.indexObj.search.mockResolvedValue({ hits: [1] });
        expect(await new MeiliSearchService(meili as any).search(MeiliIndexEnum.COMMENT, '', { limit: 1 })).toEqual({ hits: [1] });
    });

    it.each(['invalid_search_sort', 'invalid_search_filter', 'index_not_found'])(
        'search: %s → чинит индекс и повторяет один раз',
        async (code) => {
            const meili = createMeili();
            meili.getIndex.mockResolvedValue({ primaryKey: 'uuid' });
            meili.indexObj.search.mockRejectedValueOnce(brokenError(code)).mockResolvedValueOnce({ hits: ['ok'] });
            const result = await new MeiliSearchService(meili as any).search(MeiliIndexEnum.COMMENT, '', {});
            expect(result).toEqual({ hits: ['ok'] });
            expect(meili.indexObj.updateSettings).toHaveBeenCalledTimes(1);
        },
    );

    it('параллельные запросы делят одну починку', async () => {
        const meili = createMeili();
        meili.getIndex.mockResolvedValue({ primaryKey: 'uuid' });
        meili.indexObj.search
            .mockRejectedValueOnce(brokenError('invalid_search_sort'))
            .mockRejectedValueOnce(brokenError('invalid_search_sort'))
            .mockResolvedValue({ hits: [] });
        const service = new MeiliSearchService(meili as any);
        await Promise.all([service.search(MeiliIndexEnum.COMMENT, '', {}), service.search(MeiliIndexEnum.COMMENT, '', {})]);
        expect(meili.indexObj.updateSettings).toHaveBeenCalledTimes(1);
    });

    it('другие ошибки пробрасываются без починки', async () => {
        const meili = createMeili();
        meili.indexObj.search.mockRejectedValue(new Error('ECONNREFUSED'));
        await expect(new MeiliSearchService(meili as any).search(MeiliIndexEnum.COMMENT, '', {})).rejects.toThrow('ECONNREFUSED');
        expect(meili.indexObj.updateSettings).not.toHaveBeenCalled();
    });
});
