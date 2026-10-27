import { SortFieldCommentEnum } from '../enums/sort-field-comment.enum';
import { SortOrderEnum } from '../enums/sort-order.enum';
import { COMMENT_EVENTS } from '../constants/comment.const';
import { ClientCommentService } from './client.comment.service';

const row = (data: Record<string, any>) => ({ ...data, toJSON: () => data });

const setup = () => {
    const trx = { id: 'trx' };
    const deps = {
        repository: {
            findAllTopLevel: jest.fn(),
            findAllByRootUuids: jest.fn(),
            findOne: jest.fn(),
            findOneForReply: jest.fn(),
            create: jest.fn().mockResolvedValue({ uuid: 'c-new' }),
        },
        errorService: { checkExists: jest.fn(), checkParentExists: jest.fn() },
        fileService: { upload: jest.fn(), attachUploaded: jest.fn() },
        meili: { findAll: jest.fn() },
        captcha: { verify: jest.fn() },
        users: { upsert: jest.fn().mockResolvedValue({ uuid: 'u1' }) },
        database: { withTransaction: jest.fn((_ctx, fn) => fn(trx)) },
        disposableEmail: { checkNotDisposableOrThrow: jest.fn() },
        events: { emit: jest.fn() },
    };
    const service = new ClientCommentService(
        deps.repository as any,
        deps.errorService as any,
        deps.fileService as any,
        deps.meili as any,
        deps.captcha as any,
        deps.users as any,
        deps.database as any,
        deps.disposableEmail as any,
        deps.events as any,
    );
    return { service, trx, ...deps };
};

const baseInput = {
    userName: 'John',
    email: 'John@Ex.com',
    text: 'Hi <strong>there</strong> & a < b',
    captchaToken: 't',
    captcha: 'abc',
    ipAddress: '1.2.3.4',
};

describe('ClientCommentService', () => {
    describe('findAll', () => {
        const input = { page: 2, sortBy: SortFieldCommentEnum.EMAIL, sortOrder: SortOrderEnum.ASC };

        it('читает из Meilisearch и группирует ответы по rootUuid', async () => {
            const { service, meili, repository } = setup();
            meili.findAll.mockResolvedValue({
                rows: [{ uuid: 'r1' }, { uuid: 'r2' }],
                count: 51,
                replies: [
                    { uuid: 'a', rootUuid: 'r1' },
                    { uuid: 'b', rootUuid: 'r1' },
                    { uuid: 'c', rootUuid: 'r2' },
                ],
            });

            const result = await service.findAll(input);

            expect(meili.findAll).toHaveBeenCalledWith({ limit: 25, offset: 25, sortBy: 'email', sortOrder: 'ASC' });
            expect(repository.findAllTopLevel).not.toHaveBeenCalled();
            expect(result).toEqual({
                items: [
                    {
                        uuid: 'r1',
                        replies: [
                            { uuid: 'a', rootUuid: 'r1' },
                            { uuid: 'b', rootUuid: 'r1' },
                        ],
                    },
                    { uuid: 'r2', replies: [{ uuid: 'c', rootUuid: 'r2' }] },
                ],
                total: 51,
                page: 2,
                pageSize: 25,
                totalPages: 3,
            });
        });

        it('заглавный без ответов получает пустой массив replies', async () => {
            const { service, meili } = setup();
            meili.findAll.mockResolvedValue({ rows: [{ uuid: 'lonely' }], count: 1, replies: [{ uuid: 'x', rootUuid: 'other' }] });
            expect((await service.findAll(input)).items).toEqual([{ uuid: 'lonely', replies: [] }]);
        });

        it('пустой результат → totalPages = 1', async () => {
            const { service, meili } = setup();
            meili.findAll.mockResolvedValue({ rows: [], count: 0, replies: [] });
            expect((await service.findAll({ ...input, page: 1 })).totalPages).toBe(1);
        });

        it('Meilisearch упал → читает из Postgres', async () => {
            const { service, meili, repository } = setup();
            meili.findAll.mockRejectedValue(new Error('meili down'));
            repository.findAllTopLevel.mockResolvedValue({ rows: [row({ uuid: 'r1' })], count: 1 });
            repository.findAllByRootUuids.mockResolvedValue([row({ uuid: 'x', rootUuid: 'r1' })]);

            const result = await service.findAll({ ...input, page: 1 });

            expect(repository.findAllByRootUuids).toHaveBeenCalledWith(['r1']);
            expect(result.items).toEqual([{ uuid: 'r1', replies: [{ uuid: 'x', rootUuid: 'r1' }] }]);
        });

        it('ошибка без message тоже уходит в фолбэк', async () => {
            const { service, meili, repository } = setup();
            meili.findAll.mockRejectedValue('string error');
            repository.findAllTopLevel.mockResolvedValue({ rows: [], count: 0 });
            repository.findAllByRootUuids.mockResolvedValue([]);
            expect((await service.findAll(input)).items).toEqual([]);
        });
    });

    it('findOne проверяет существование', async () => {
        const { service, errorService, repository } = setup();
        repository.findOne.mockResolvedValue({ uuid: 'c1' });
        expect(await service.findOne('c1')).toEqual({ uuid: 'c1' });
        expect(errorService.checkExists).toHaveBeenCalledWith('c1');
    });

    it('preview возвращает очищенный HTML', () => {
        expect(setup().service.preview('<i>x</i> & y')).toEqual({ html: '<i>x</i> &amp; y' });
    });

    describe('create', () => {
        it('file и uploadId вместе → conflicting_file_sources (до капчи)', async () => {
            const { service, captcha } = setup();
            await expect(service.create({ ...baseInput, file: {} as any, uploadId: 'u' })).rejects.toThrow('conflicting_file_sources');
            expect(captcha.verify).not.toHaveBeenCalled();
        });

        it('временный e-mail → disposable_email_not_allowed до капчи (одноразовый токен не сгорает)', async () => {
            const { service, captcha, database, disposableEmail } = setup();
            disposableEmail.checkNotDisposableOrThrow.mockImplementation(() => {
                throw new Error('disposable_email_not_allowed');
            });
            await expect(service.create({ ...baseInput, email: 'a@mailinator.com' })).rejects.toThrow('disposable_email_not_allowed');
            expect(disposableEmail.checkNotDisposableOrThrow).toHaveBeenCalledWith('a@mailinator.com');
            expect(captcha.verify).not.toHaveBeenCalled();
            expect(database.withTransaction).not.toHaveBeenCalled();
        });

        it('ошибка капчи прерывает создание', async () => {
            const { service, captcha, database } = setup();
            captcha.verify.mockRejectedValue(new Error('captcha_invalid'));
            await expect(service.create(baseInput)).rejects.toThrow('captcha_invalid');
            expect(database.withTransaction).not.toHaveBeenCalled();
        });

        it('невалидный HTML отклоняется до транзакции', async () => {
            const { service, database } = setup();
            await expect(service.create({ ...baseInput, text: '<script>' })).rejects.toThrow('text_tag_not_allowed');
            expect(database.withTransaction).not.toHaveBeenCalled();
        });

        it('заглавный комментарий: санитайз, email в нижнем регистре, без homePage не затирает, событие', async () => {
            const { service, users, repository, events, trx, captcha } = setup();
            repository.findOne.mockResolvedValue({ uuid: 'c-new', text: 'x' });

            const result = await service.create({ ...baseInput, userAgent: 'U'.repeat(600) });

            expect(captcha.verify).toHaveBeenCalledWith({ token: 't', answer: 'abc' });
            expect(users.upsert).toHaveBeenCalledWith({ userName: 'John', email: 'john@ex.com' }, trx);
            expect(repository.create).toHaveBeenCalledWith(
                {
                    userUuid: 'u1',
                    parentUuid: null,
                    rootUuid: null,
                    text: 'Hi <strong>there</strong> &amp; a &lt; b',
                    ipAddress: '1.2.3.4',
                    userAgent: 'U'.repeat(512),
                },
                trx,
            );
            expect(events.emit).toHaveBeenCalledWith(COMMENT_EVENTS.CREATED, { comment: { uuid: 'c-new', text: 'x' } });
            expect(result).toEqual({ uuid: 'c-new', text: 'x' });
        });

        it('homePage передан → сохраняется; без ip/userAgent → null', async () => {
            const { service, users, repository, trx } = setup();
            await service.create({ ...baseInput, ipAddress: undefined, homePage: 'https://j.dev' });
            expect(users.upsert).toHaveBeenCalledWith({ userName: 'John', email: 'john@ex.com', homePage: 'https://j.dev' }, trx);
            expect(repository.create.mock.calls[0][0]).toMatchObject({ ipAddress: null, userAgent: null });
        });

        it.each([
            ['ответ на заглавный → rootUuid = parent.uuid', { uuid: 'p1', rootUuid: null }, 'p1'],
            ['ответ на ответ → rootUuid = parent.rootUuid', { uuid: 'p2', rootUuid: 'root' }, 'root'],
        ])('%s', async (_, parent, rootUuid) => {
            const { service, repository, errorService, trx } = setup();
            repository.findOneForReply.mockResolvedValue(parent);
            await service.create({ ...baseInput, parentUuid: parent.uuid });
            expect(errorService.checkParentExists).toHaveBeenCalledWith(parent.uuid, trx);
            expect(repository.create.mock.calls[0][0]).toMatchObject({ parentUuid: parent.uuid, rootUuid });
        });

        it('legacy file → clientFileService.upload с ссылкой на комментарий', async () => {
            const { service, fileService, trx } = setup();
            const file = { originalname: 'a.png' } as any;
            await service.create({ ...baseInput, file });
            expect(fileService.upload).toHaveBeenCalledWith(file, { modelUuid: 'c-new', modelType: 'comments', modelColumn: 'file' }, trx);
        });

        it('uploadId → attachUploaded, finish(true) после коммита', async () => {
            const { service, fileService, events } = setup();
            const finish = jest.fn();
            fileService.attachUploaded.mockResolvedValue({ file: {}, finish });
            await service.create({ ...baseInput, uploadId: 'up1' });
            expect(fileService.attachUploaded).toHaveBeenCalledWith(
                'up1',
                expect.objectContaining({ modelUuid: 'c-new' }),
                expect.anything(),
            );
            expect(finish).toHaveBeenCalledWith(true);
            expect(finish.mock.invocationCallOrder[0]).toBeLessThan(events.emit.mock.invocationCallOrder[0]);
        });

        it('транзакция упала после attachUploaded → finish(false) и ошибка наружу', async () => {
            const { service, fileService, database, events } = setup();
            const finish = jest.fn();
            fileService.attachUploaded.mockResolvedValue({ file: {}, finish });
            database.withTransaction.mockImplementation(async (_ctx, fn) => {
                await fn({});
                throw new Error('commit failed');
            });
            await expect(service.create({ ...baseInput, uploadId: 'up1' })).rejects.toThrow('commit failed');
            expect(finish).toHaveBeenCalledWith(false);
            expect(finish).not.toHaveBeenCalledWith(true);
            expect(events.emit).not.toHaveBeenCalled();
        });

        it('ошибка до attachUploaded — finish не вызывается', async () => {
            const { service, errorService } = setup();
            errorService.checkParentExists.mockRejectedValue(new Error('parent_comment_not_found'));
            await expect(service.create({ ...baseInput, parentUuid: 'nope', uploadId: 'up1' })).rejects.toThrow('parent_comment_not_found');
        });
    });
});
