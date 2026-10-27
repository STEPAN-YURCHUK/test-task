import { Logger } from '@nestjs/common';
import { UPLOAD_PART_SIZE } from '../constants/file.const';
import { StatusUploadEnum } from '../enums/status-upload.enum';
import { TypeFileEnum } from '../enums/type-file.enum';
import { UploadSession } from '../types/upload-session.type';
import { FileUploadService } from './file-upload.service';

const MiB = 1024 * 1024;

const processed = (extra = {}) => ({
    type: TypeFileEnum.IMAGE,
    key: 'files/images/original/u.png',
    mimeType: 'image/png',
    size: 10,
    width: 320,
    height: 160,
    variants: null,
    video: null,
    ...extra,
});

const session = (extra: Partial<UploadSession> = {}): UploadSession => ({
    id: 'up-1',
    status: StatusUploadEnum.UPLOADING,
    type: TypeFileEnum.IMAGE,
    originalName: 'a.png',
    contentType: 'image/png',
    size: 12 * MiB,
    partSize: UPLOAD_PART_SIZE,
    partCount: 3,
    sourceKey: 'uploads/up-1/source.png',
    s3UploadId: 's3-up',
    result: null,
    error: null,
    createdAt: '2026-01-01T00:00:00.000Z',
    ...extra,
});

const setup = (initial: UploadSession | null = null) => {
    const store = new Map<string, UploadSession>(initial ? [[initial.id, initial]] : []);
    const sessions = {
        store,
        save: jest.fn(async (s: UploadSession) => void store.set(s.id, JSON.parse(JSON.stringify(s)))),
        find: jest.fn(async (id: string) => store.get(id) ?? null),
        remove: jest.fn(async (id: string) => void store.delete(id)),
        acquireClaim: jest.fn().mockResolvedValue(true),
        releaseClaim: jest.fn(),
    };
    const s3 = {
        buildKey: jest.fn((...parts: string[]) => parts.join('/')),
        getCdnUrl: jest.fn((key: string) => `https://cdn/${key}`),
        createMultipart: jest.fn().mockResolvedValue('s3-up'),
        signPart: jest.fn(async (_k, _u, n, size) => `https://sign/${n}/${size}`),
        listParts: jest.fn(),
        completeMultipart: jest.fn(),
        head: jest.fn(),
        abortMultipart: jest.fn().mockResolvedValue(undefined),
        deleteObject: jest.fn().mockResolvedValue(undefined),
        readToBuffer: jest.fn().mockResolvedValue(Buffer.from('src')),
        downloadToPath: jest.fn().mockResolvedValue(undefined),
    };
    const image = { processAndUpload: jest.fn().mockResolvedValue(processed()) };
    const text = { processAndUpload: jest.fn().mockResolvedValue(processed({ type: TypeFileEnum.TEXT, key: 'files/texts/up-1.txt' })) };
    const video = { processAndUpload: jest.fn() };
    const queue = { add: jest.fn() };
    const service = new FileUploadService(sessions as any, s3 as any, image as any, text as any, video as any, queue as any);
    return { service, sessions, s3, image, text, video, queue };
};

const parts = (sizes: number[]) => ({ Parts: sizes.map((Size, i) => ({ PartNumber: i + 1, Size, ETag: `e${i + 1}` })).reverse() });

describe('FileUploadService', () => {
    beforeEach(() => {
        jest.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);
        jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    });
    afterEach(() => jest.restoreAllMocks());

    describe('init', () => {
        it('12 МБ → 3 куска по 5 МиБ, последний — остаток; сессия UPLOADING', async () => {
            const { service, sessions, s3 } = setup();
            const result = await service.init({ filename: 'Photo.PNG', size: 12 * MiB });

            expect(s3.createMultipart).toHaveBeenCalledWith(expect.stringMatching(/^uploads\/.+\/source\.png$/), 'image/png');
            expect(result.partSize).toBe(UPLOAD_PART_SIZE);
            expect(result.expiresIn).toBe(3600);
            expect(result.parts).toEqual([
                { partNumber: 1, size: 5 * MiB, url: `https://sign/1/${5 * MiB}` },
                { partNumber: 2, size: 5 * MiB, url: `https://sign/2/${5 * MiB}` },
                { partNumber: 3, size: 2 * MiB, url: `https://sign/3/${2 * MiB}` },
            ]);
            const saved = sessions.store.get(result.uploadId);
            expect(saved).toMatchObject({
                status: 'UPLOADING',
                type: 'IMAGE',
                originalName: 'Photo.PNG',
                partCount: 3,
                s3UploadId: 's3-up',
            });
        });

        it('маленький файл — один кусок', async () => {
            const { service } = setup();
            expect((await service.init({ filename: 'a.txt', size: 5 })).parts).toEqual([
                { partNumber: 1, size: 5, url: 'https://sign/1/5' },
            ]);
        });

        it('ровно 5 МиБ — один кусок', async () => {
            const { service } = setup();
            expect((await service.init({ filename: 'a.png', size: UPLOAD_PART_SIZE })).parts).toHaveLength(1);
        });

        it.each([
            ['exe', 'x.exe', 10, 'file_type_not_allowed'],
            ['без расширения', 'noext', 10, 'file_type_not_allowed'],
            ['txt > 100 КБ', 'a.txt', 100 * 1024 + 1, 'file_text_too_large'],
            ['картинка > 20 МБ', 'a.jpg', 20 * MiB + 1, 'file_image_too_large'],
        ])('%s → %s', async (_, filename, size, key) => {
            const { service, s3 } = setup();
            await expect(service.init({ filename, size })).rejects.toMatchObject({ message: key, status: 400 });
            expect(s3.createMultipart).not.toHaveBeenCalled();
        });

        it('видео: тип VIDEO и content-type', async () => {
            const { service, sessions, s3 } = setup();
            const { uploadId } = await service.init({ filename: 'clip.MOV', size: 30 * MiB });
            expect(s3.createMultipart).toHaveBeenCalledWith(expect.stringMatching(/source\.mov$/), 'video/quicktime');
            expect(sessions.store.get(uploadId)).toMatchObject({ type: 'VIDEO', partCount: 6 });
        });

        // БАГ: для видео больше лимита отдаётся ключ картинки (file-upload.service.ts, init)
        it('видео > 200 МБ → file_video_too_large', async () => {
            const { service } = setup();
            await expect(service.init({ filename: 'a.mp4', size: 200 * MiB + 1 })).rejects.toThrow('file_video_too_large');
        });
    });

    describe('parts', () => {
        it('переподписывает ссылки для UPLOADING', async () => {
            const { service, s3 } = setup(session());
            const result = await service.parts('up-1');
            expect(result.parts).toHaveLength(3);
            expect(s3.signPart).toHaveBeenCalledTimes(3);
        });

        it('не UPLOADING → 409 file_upload_not_ready', async () => {
            const { service } = setup(session({ status: StatusUploadEnum.PROCESSING }));
            await expect(service.parts('up-1')).rejects.toMatchObject({ message: 'file_upload_not_ready', status: 409 });
        });

        it('нет сессии → 404 file_upload_not_found', async () => {
            await expect(setup().service.parts('nope')).rejects.toMatchObject({ message: 'file_upload_not_found', status: 404 });
        });
    });

    describe('complete', () => {
        it('все куски на месте → склейка (по порядку), PROCESSING, задача process-upload', async () => {
            const { service, s3, queue, sessions } = setup(session());
            s3.listParts.mockResolvedValue(parts([5 * MiB, 5 * MiB, 2 * MiB]));
            s3.head.mockResolvedValue({ ContentLength: 12 * MiB });

            const result = await service.complete('up-1');

            expect(s3.completeMultipart).toHaveBeenCalledWith('uploads/up-1/source.png', 's3-up', [
                { PartNumber: 1, ETag: 'e1' },
                { PartNumber: 2, ETag: 'e2' },
                { PartNumber: 3, ETag: 'e3' },
            ]);
            expect(queue.add).toHaveBeenCalledWith('process-upload', { uploadId: 'up-1' }, { jobId: 'up-1' });
            expect(sessions.store.get('up-1').status).toBe('PROCESSING');
            expect(result).toEqual({ uploadId: 'up-1', status: 'PROCESSING', error: null, file: null });
        });

        it('видео → задача process-video без таймаута Bull (он не убивает ffmpeg)', async () => {
            const { service, s3, queue } = setup(session({ type: TypeFileEnum.VIDEO, size: 3, partCount: 1 }));
            s3.listParts.mockResolvedValue(parts([3]));
            s3.head.mockResolvedValue({ ContentLength: 3 });
            await service.complete('up-1');
            expect(queue.add).toHaveBeenCalledWith('process-video', { uploadId: 'up-1' }, { jobId: 'up-1' });
        });

        it.each([
            ['не хватает куска', [5 * MiB, 5 * MiB]],
            ['неверный размер куска', [5 * MiB, 4 * MiB, 3 * MiB]],
            ['лишний кусок', [5 * MiB, 5 * MiB, 2 * MiB, 1]],
        ])('%s → 409 file_upload_incomplete', async (_, sizes) => {
            const { service, s3, queue } = setup(session());
            s3.listParts.mockResolvedValue(parts(sizes));
            await expect(service.complete('up-1')).rejects.toMatchObject({ message: 'file_upload_incomplete', status: 409 });
            expect(s3.completeMultipart).not.toHaveBeenCalled();
            expect(queue.add).not.toHaveBeenCalled();
        });

        it('S3 без Parts → incomplete', async () => {
            const { service, s3 } = setup(session());
            s3.listParts.mockResolvedValue({});
            await expect(service.complete('up-1')).rejects.toThrow('file_upload_incomplete');
        });

        it('номера кусков с пропуском → incomplete', async () => {
            const { service, s3 } = setup(session({ partCount: 2, size: 5 * MiB + 1 }));
            s3.listParts.mockResolvedValue({
                Parts: [
                    { PartNumber: 1, Size: 5 * MiB },
                    { PartNumber: 3, Size: 1 },
                ],
            });
            await expect(service.complete('up-1')).rejects.toThrow('file_upload_incomplete');
        });

        it('итоговый размер не совпал → incomplete, без очереди', async () => {
            const { service, s3, queue } = setup(session());
            s3.listParts.mockResolvedValue(parts([5 * MiB, 5 * MiB, 2 * MiB]));
            s3.head.mockResolvedValue({ ContentLength: 1 });
            await expect(service.complete('up-1')).rejects.toThrow('file_upload_incomplete');
            expect(queue.add).not.toHaveBeenCalled();
        });

        it('повторный complete при PROCESSING — без S3, задача ставится ещё раз (идемпотентно по jobId)', async () => {
            const { service, s3, queue } = setup(session({ status: StatusUploadEnum.PROCESSING }));
            expect((await service.complete('up-1')).status).toBe('PROCESSING');
            expect(s3.listParts).not.toHaveBeenCalled();
            expect(queue.add).toHaveBeenCalledWith('process-upload', { uploadId: 'up-1' }, { jobId: 'up-1' });
        });

        it('сбой постановки в очередь → повторный complete восстанавливает задачу', async () => {
            const { service, s3, queue, sessions } = setup(session());
            s3.listParts.mockResolvedValue(parts([5 * MiB, 5 * MiB, 2 * MiB]));
            s3.head.mockResolvedValue({ ContentLength: 12 * MiB });
            queue.add.mockRejectedValueOnce(new Error('redis down'));

            await expect(service.complete('up-1')).rejects.toThrow('redis down');
            expect(sessions.store.get('up-1').status).toBe('PROCESSING');

            expect((await service.complete('up-1')).status).toBe('PROCESSING');
            expect(queue.add).toHaveBeenCalledTimes(2);
            expect(s3.completeMultipart).toHaveBeenCalledTimes(1);
        });

        it('READY / FAILED — просто статус, без очереди', async () => {
            const { service, queue } = setup(session({ status: StatusUploadEnum.READY, result: processed() as any }));
            expect((await service.complete('up-1')).status).toBe('READY');
            expect(queue.add).not.toHaveBeenCalled();
        });
    });

    describe('status', () => {
        it('READY картинка: CDN url, webpUrl, без постера', async () => {
            const result = processed({ variants: { webpOriginalPath: 'files/images/webp-original/u.webp' } });
            const { service } = setup(session({ status: StatusUploadEnum.READY, result } as any));
            expect((await service.status('up-1')).file).toEqual({
                type: 'IMAGE',
                url: 'https://cdn/files/images/original/u.png',
                originalName: 'a.png',
                mimeType: 'image/png',
                size: 10,
                width: 320,
                height: 160,
                webpUrl: 'https://cdn/files/images/webp-original/u.webp',
                posterUrl: null,
                duration: null,
            });
        });

        it('READY видео: постер и длительность', async () => {
            const result = processed({ type: TypeFileEnum.VIDEO, video: { duration: 4.5, posterPath: 'p.jpg', webpPosterPath: 'p.webp' } });
            const { service } = setup(session({ status: StatusUploadEnum.READY, result } as any));
            expect((await service.status('up-1')).file).toMatchObject({ webpUrl: null, posterUrl: 'https://cdn/p.webp', duration: 4.5 });
        });

        it('FAILED: ошибка и без файла', async () => {
            const { service } = setup(session({ status: StatusUploadEnum.FAILED, error: 'file_image_invalid' }));
            expect(await service.status('up-1')).toEqual({ uploadId: 'up-1', status: 'FAILED', error: 'file_image_invalid', file: null });
        });

        it('нет сессии → 404', async () => {
            await expect(setup().service.status('x')).rejects.toThrow('file_upload_not_found');
        });
    });

    describe('abort', () => {
        it('нет сессии — тихо', async () => {
            const { service, s3 } = setup();
            await service.abort('x');
            expect(s3.abortMultipart).not.toHaveBeenCalled();
        });

        it('UPLOADING → abortMultipart, сессия удалена', async () => {
            const { service, s3, sessions } = setup(session());
            await service.abort('up-1');
            expect(s3.abortMultipart).toHaveBeenCalledWith('uploads/up-1/source.png', 's3-up');
            expect(sessions.store.has('up-1')).toBe(false);
        });

        it('READY → удаляются исходник, результат и все варианты; ошибки S3 глушатся', async () => {
            const result = processed({
                variants: {
                    smallPath: 's.png',
                    mediumPath: 'm.png',
                    webpSmallPath: 's.webp',
                    webpMediumPath: 'm.webp',
                    webpOriginalPath: 'o.webp',
                    smallWidth: 1,
                    smallHeight: 1,
                    mediumWidth: 1,
                    mediumHeight: 1,
                },
            });
            const { service, s3 } = setup(session({ status: StatusUploadEnum.READY, result } as any));
            s3.deleteObject.mockRejectedValue(new Error('s3 down'));
            await expect(service.abort('up-1')).resolves.toBeUndefined();
            expect(s3.abortMultipart).not.toHaveBeenCalled();
            expect(s3.deleteObject.mock.calls.map(([key]) => key).sort()).toEqual(
                ['files/images/original/u.png', 'm.png', 'm.webp', 'o.webp', 's.png', 's.webp', 'uploads/up-1/source.png'].sort(),
            );
        });

        it('PROCESSING → удаляется собранный исходник', async () => {
            const { service, s3 } = setup(session({ status: StatusUploadEnum.PROCESSING }));
            await service.abort('up-1');
            expect(s3.deleteObject).toHaveBeenCalledWith('uploads/up-1/source.png');
        });

        it('abortMultipart упал — не мешает', async () => {
            const { service, s3 } = setup(session());
            s3.abortMultipart.mockRejectedValue(new Error('NoSuchUpload'));
            await expect(service.abort('up-1')).resolves.toBeUndefined();
        });
    });

    describe('process', () => {
        it('картинка: читает до 20 МБ, обрабатывает, удаляет исходник, READY', async () => {
            const { service, s3, image, sessions } = setup(session({ status: StatusUploadEnum.PROCESSING }));
            await service.process('up-1');
            expect(s3.readToBuffer).toHaveBeenCalledWith('uploads/up-1/source.png', 20 * MiB);
            expect(image.processAndUpload).toHaveBeenCalledWith(Buffer.from('src'), 'up-1');
            expect(s3.deleteObject).toHaveBeenCalledWith('uploads/up-1/source.png');
            expect(sessions.store.get('up-1')).toMatchObject({ status: 'READY', result: processed() });
        });

        it('текст: лимит 100 КБ и ключ files/texts/<id>', async () => {
            const { service, s3, text } = setup(session({ status: StatusUploadEnum.PROCESSING, type: TypeFileEnum.TEXT }));
            await service.process('up-1');
            expect(s3.readToBuffer).toHaveBeenCalledWith(expect.any(String), 100 * 1024);
            expect(text.processAndUpload).toHaveBeenCalledWith(Buffer.from('src'), 'files/texts/up-1');
        });

        it('видео: скачивает на диск во временную папку, transcoded не попадает в сессию', async () => {
            const { service, s3, video, sessions } = setup(
                session({ status: StatusUploadEnum.PROCESSING, type: TypeFileEnum.VIDEO, sourceKey: 'uploads/up-1/source.mkv' }),
            );
            video.processAndUpload.mockResolvedValue({ ...processed({ type: TypeFileEnum.VIDEO }), transcoded: true });
            await service.process('up-1');
            expect(s3.downloadToPath).toHaveBeenCalledWith(
                'uploads/up-1/source.mkv',
                expect.stringMatching(/comments-video-.+source\.mkv$/),
            );
            expect(video.processAndUpload).toHaveBeenCalledWith(
                expect.stringMatching(/source\.mkv$/),
                expect.stringMatching(/comments-video-/),
                'up-1',
            );
            expect(sessions.store.get('up-1').result).not.toHaveProperty('transcoded');
        });

        it('видео: ошибка обработки — временная папка всё равно удаляется, ошибка наружу', async () => {
            const { service, video } = setup(session({ status: StatusUploadEnum.PROCESSING, type: TypeFileEnum.VIDEO }));
            video.processAndUpload.mockRejectedValue(new Error('ffmpeg crashed'));
            await expect(service.process('up-1')).rejects.toThrow('ffmpeg crashed');
        });

        it('сессию отменили во время обработки → результат удаляется', async () => {
            const { service, s3, sessions, image } = setup(session({ status: StatusUploadEnum.PROCESSING }));
            image.processAndUpload.mockImplementation(async () => {
                sessions.store.delete('up-1');
                return processed({
                    variants: {
                        smallPath: 's.png',
                        mediumPath: 'm.png',
                        webpSmallPath: 's.webp',
                        webpMediumPath: 'm.webp',
                        webpOriginalPath: 'o.webp',
                        smallWidth: 1,
                        smallHeight: 1,
                        mediumWidth: 1,
                        mediumHeight: 1,
                    },
                });
            });
            await service.process('up-1');
            expect(s3.deleteObject).toHaveBeenCalledWith('files/images/original/u.png');
            expect(s3.deleteObject).toHaveBeenCalledWith('s.webp');
            expect(s3.deleteObject).toHaveBeenCalledWith('o.webp');
            expect(sessions.save).not.toHaveBeenCalled();
        });

        it('ошибки удаления в S3 после обработки глушатся (исходник и результат отменённой сессии)', async () => {
            const { service, s3, sessions, image } = setup(session({ status: StatusUploadEnum.PROCESSING }));
            s3.deleteObject.mockRejectedValue(new Error('s3 down'));
            image.processAndUpload.mockImplementation(async () => {
                sessions.store.delete('up-1');
                return processed();
            });
            await expect(service.process('up-1')).resolves.toBeUndefined();
            expect(s3.deleteObject).toHaveBeenCalledTimes(2);
        });

        it('ошибки удаления в S3 после обработки глушатся (исходник и результат отменённой сессии)', async () => {
            const { service, s3, sessions, image } = setup(session({ status: StatusUploadEnum.PROCESSING }));
            s3.deleteObject.mockRejectedValue(new Error('s3 down'));
            image.processAndUpload.mockImplementation(async () => {
                sessions.store.delete('up-1');
                return processed();
            });
            await expect(service.process('up-1')).resolves.toBeUndefined();
            expect(s3.deleteObject).toHaveBeenCalledTimes(2);
        });
        it('не PROCESSING или нет сессии — ничего не делает', async () => {
            const { service, s3 } = setup(session({ status: StatusUploadEnum.READY }));
            await service.process('up-1');
            await service.process('missing');
            expect(s3.readToBuffer).not.toHaveBeenCalled();
        });
    });

    describe('markFailed', () => {
        it('FAILED с причиной, исходник удаляется', async () => {
            const { service, s3, sessions } = setup(session({ status: StatusUploadEnum.PROCESSING }));
            await service.markFailed('up-1', 'file_image_invalid');
            expect(s3.deleteObject).toHaveBeenCalledWith('uploads/up-1/source.png');
            expect(sessions.store.get('up-1')).toMatchObject({ status: 'FAILED', error: 'file_image_invalid' });
        });

        it('ошибка удаления исходника не мешает FAILED', async () => {
            const { service, s3, sessions } = setup(session({ status: StatusUploadEnum.PROCESSING }));
            s3.deleteObject.mockRejectedValue(new Error('s3 down'));
            await service.markFailed('up-1', 'file_processing_failed');
            expect(sessions.store.get('up-1').status).toBe('FAILED');
        });

        it('ошибка удаления исходника не мешает FAILED', async () => {
            const { service, s3, sessions } = setup(session({ status: StatusUploadEnum.PROCESSING }));
            s3.deleteObject.mockRejectedValue(new Error('s3 down'));
            await service.markFailed('up-1', 'file_processing_failed');
            expect(sessions.store.get('up-1').status).toBe('FAILED');
        });

        it('нет сессии — тихо', async () => {
            const { service, sessions } = setup();
            await service.markFailed('x', 'e');
            expect(sessions.save).not.toHaveBeenCalled();
        });
    });

    describe('claim', () => {
        it('не READY → 409 file_upload_not_ready', async () => {
            await expect(setup(session({ status: StatusUploadEnum.PROCESSING })).service.claim('up-1')).rejects.toMatchObject({
                message: 'file_upload_not_ready',
                status: 409,
            });
        });

        it('READY без результата → 409', async () => {
            await expect(setup(session({ status: StatusUploadEnum.READY })).service.claim('up-1')).rejects.toThrow('file_upload_not_ready');
        });

        it('уже прикрепляется другим запросом (NX lock) → 409', async () => {
            const { service, sessions } = setup(session({ status: StatusUploadEnum.READY, result: processed() as any }));
            sessions.acquireClaim.mockResolvedValue(false);
            await expect(service.claim('up-1')).rejects.toThrow('file_upload_not_ready');
        });

        it('нет сессии → 404', async () => {
            await expect(setup().service.claim('x')).rejects.toThrow('file_upload_not_found');
        });

        it('ok: finish(true) удаляет сессию, finish(false) снимает блокировку', async () => {
            const { service, sessions } = setup(session({ status: StatusUploadEnum.READY, result: processed() as any }));
            const claimed = await service.claim('up-1');
            expect(claimed.session.result).toEqual(processed());
            await claimed.finish(false);
            expect(sessions.releaseClaim).toHaveBeenCalledWith('up-1');
            expect(sessions.remove).not.toHaveBeenCalled();
            await claimed.finish(true);
            expect(sessions.remove).toHaveBeenCalledWith('up-1');
        });
    });
});
