import { TypeFileEnum } from '../enums/type-file.enum';
import { ClientFileService } from './client.file.service';

const ref = { modelUuid: 'c1', modelType: 'comments', modelColumn: 'file' };
const multer = (originalname: string, buffer = Buffer.from('x')) => ({ originalname, buffer }) as any;

const setup = () => {
    const trx = { id: 'trx' };
    const deps = {
        repository: { create: jest.fn(async (data) => ({ ...data, uuid: data.uuid ?? 'generated' })) },
        uploads: { claim: jest.fn() },
        image: {
            processAndUpload: jest.fn().mockResolvedValue({
                type: TypeFileEnum.IMAGE,
                key: 'img.png',
                mimeType: 'image/png',
                size: 1,
                width: 2,
                height: 3,
                variants: { smallPath: 's.png' },
                video: null,
            }),
        },
        text: {
            processAndUpload: jest.fn().mockResolvedValue({
                type: TypeFileEnum.TEXT,
                key: 't.txt',
                mimeType: 'text/plain',
                size: 1,
                width: null,
                height: null,
                variants: null,
                video: null,
            }),
        },
        s3: { getCdnUrl: jest.fn((k) => `https://cdn/${k}`), buildKey: jest.fn((...p: string[]) => ['f', ...p].join('/')) },
        database: { withTransaction: jest.fn((ctx, fn) => fn(ctx.transaction ?? trx)) },
    };
    const service = new ClientFileService(
        deps.repository as any,
        deps.uploads as any,
        deps.image as any,
        deps.text as any,
        deps.s3 as any,
        deps.database as any,
    );
    return { service, trx, ...deps };
};

describe('ClientFileService', () => {
    it('getPublicUrl → CDN', () => {
        expect(setup().service.getPublicUrl('a/b.png')).toBe('https://cdn/a/b.png');
    });

    describe('upload (старый путь)', () => {
        it('txt → TextService, запись с владельцем и uuid из ключа', async () => {
            const { service, text, repository, trx } = setup();
            const file = await service.upload(multer('note.TXT'), ref, trx as any);
            const uuid = (repository.create.mock.calls[0][0] as any).uuid;
            expect(text.processAndUpload).toHaveBeenCalledWith(Buffer.from('x'), `f/files/texts/${uuid}`);
            expect(repository.create).toHaveBeenCalledWith(
                {
                    uuid,
                    type: 'TEXT',
                    path: 't.txt',
                    originalName: 'note.TXT',
                    mimeType: 'text/plain',
                    size: 1,
                    width: null,
                    height: null,
                    ...ref,
                },
                trx,
            );
            expect(file.uuid).toBe(uuid);
        });

        it('картинка → ImageService, варианты попадают в запись', async () => {
            const { service, image, repository } = setup();
            await service.upload(multer('a.JPEG'), ref, undefined);
            expect(image.processAndUpload).toHaveBeenCalled();
            expect(repository.create.mock.calls[0][0]).toMatchObject({ type: 'IMAGE', path: 'img.png', smallPath: 's.png' });
        });

        // БАГ: ImageService.processAndUpload теперь ждёт uuid и сам строит ключ варианта,
        // а сюда передаётся готовый ключ → путь вида files/images/original/<S3_FOLDER>/files/images/<uuid>.png
        it('картинка: в ImageService передаётся uuid, а не готовый ключ', async () => {
            const { service, image, repository } = setup();
            await service.upload(multer('a.png'), ref, undefined);
            expect(image.processAndUpload).toHaveBeenCalledWith(Buffer.from('x'), (repository.create.mock.calls[0][0] as any).uuid);
        });

        it('имя файла из latin1 multer восстанавливается в UTF-8', async () => {
            const { service, repository } = setup();
            const name = Buffer.from('отчёт.txt', 'utf8').toString('latin1');
            await service.upload(multer(name), ref, undefined);
            expect(repository.create.mock.calls[0][0].originalName).toBe('отчёт.txt');
        });

        // БАГ: имя обрезается до 255 символов ДО извлечения расширения → у длинного имени теряется .txt
        it('длинное имя (> 255) с .txt принимается, сохраняется обрезанным', async () => {
            const { service, repository } = setup();
            await service.upload(multer(`${'a'.repeat(300)}.txt`), ref, undefined);
            expect(repository.create.mock.calls[0][0].originalName).toHaveLength(255);
        });

        it('неизвестное расширение → 400 file_type_not_allowed, ничего не пишется', async () => {
            const { service, repository, image, text } = setup();
            await expect(service.upload(multer('a.exe'), ref, undefined)).rejects.toMatchObject({
                message: 'file_type_not_allowed',
                status: 400,
            });
            expect(repository.create).not.toHaveBeenCalled();
            expect(image.processAndUpload).not.toHaveBeenCalled();
            expect(text.processAndUpload).not.toHaveBeenCalled();
        });
    });

    describe('attachUploaded (прямая загрузка)', () => {
        const claimed = (finish = jest.fn()) => ({
            finish,
            session: {
                originalName: 'clip.mkv',
                result: {
                    type: TypeFileEnum.VIDEO,
                    key: 'v.mp4',
                    mimeType: 'video/mp4',
                    size: 9,
                    width: 1280,
                    height: 720,
                    variants: null,
                    video: { duration: 4, posterPath: 'p.jpg', webpPosterPath: 'p.webp' },
                },
            },
        });

        it('создаёт запись без явного uuid, видео-поля сохраняются, finish отдаётся наружу', async () => {
            const { service, uploads, repository, trx } = setup();
            const c = claimed();
            uploads.claim.mockResolvedValue(c);
            const result = await service.attachUploaded('up-1', ref, trx as any);
            expect(uploads.claim).toHaveBeenCalledWith('up-1');
            const data = repository.create.mock.calls[0][0];
            expect(data).not.toHaveProperty('uuid');
            expect(data).toMatchObject({
                type: 'VIDEO',
                path: 'v.mp4',
                originalName: 'clip.mkv',
                duration: 4,
                posterPath: 'p.jpg',
                ...ref,
            });
            expect(result.finish).toBe(c.finish);
            expect(c.finish).not.toHaveBeenCalled();
        });

        it('ошибка записи → finish(false) и ошибка наружу', async () => {
            const { service, uploads, repository } = setup();
            const c = claimed();
            uploads.claim.mockResolvedValue(c);
            repository.create.mockRejectedValue(new Error('unique violation'));
            await expect(service.attachUploaded('up-1', ref, {} as any)).rejects.toThrow('unique violation');
            expect(c.finish).toHaveBeenCalledWith(false);
        });

        it('claim отклонён — ошибка наружу, запись не создаётся', async () => {
            const { service, uploads, repository } = setup();
            uploads.claim.mockRejectedValue(new Error('file_upload_not_ready'));
            await expect(service.attachUploaded('up-1', ref, {} as any)).rejects.toThrow('file_upload_not_ready');
            expect(repository.create).not.toHaveBeenCalled();
        });
    });
});
