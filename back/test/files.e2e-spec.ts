import request = require('supertest');
import * as sharp from 'sharp';
import { gif, hasFfmpeg, jpeg, png, video } from './fixtures/media';
import { directUpload, postComment } from './helpers/factories';
import { createTestApp, TestApp } from './helpers/test-app';

describe('Files: S3, варианты картинок, WebP, прямая загрузка, видео (e2e)', () => {
    let t: TestApp;
    const api = () => request(t.app.getHttpServer());
    const meta = (url: string) => sharp(t.s3.objects.get(t.s3.keyFromUrl(url)).body).metadata();

    beforeAll(async () => {
        t = await createTestApp();
    });
    beforeEach(() => t.reset());
    afterAll(() => t.close());

    describe('картинка в запросе комментария (старый путь)', () => {
        it('большая картинка пропорционально уменьшается до 320x240 и получает small/medium/original + webp', async () => {
            const res = await postComment(t, {}, { buffer: await png(1000, 500), name: 'wide.png' }).expect(201);
            const file = res.body.file;

            expect(file).toMatchObject({ type: 'IMAGE', mimeType: 'image/png', width: 320, height: 160 });
            expect(file.variants.small).toMatchObject({ width: 160, height: 80 });
            expect(file.variants.medium).toMatchObject({ width: 240, height: 120 });
            expect(file.variants.original).toMatchObject({ width: 320, height: 160 });

            for (const v of Object.values<any>(file.variants)) {
                // ровно <folder>/files/images/<вариант>/<uuid>.<ext> — без вложенного повторения папки
                expect(v.url).toMatch(/^https:\/\/cdn\.test\/comments\/e2e\/files\/images\/(small|medium|original)\/[0-9a-f-]{36}\.png$/);
                expect(v.webpUrl).toMatch(
                    /^https:\/\/cdn\.test\/comments\/e2e\/files\/images\/webp-(small|medium|original)\/[0-9a-f-]{36}\.webp$/,
                );
                expect((await meta(v.url)).format).toBe('png');
                expect((await meta(v.webpUrl)).format).toBe('webp');
                expect(t.s3.objects.get(t.s3.keyFromUrl(v.webpUrl)).public).toBe(true);
            }
        });

        it('маленькая картинка не увеличивается', async () => {
            const { file } = (await postComment(t, {}, { buffer: await jpeg(100, 50), name: 'small.jpg' })).body;
            expect(file.variants.original).toMatchObject({ width: 100, height: 50 });
            expect(file.variants.small).toMatchObject({ width: 100, height: 50 });
        });

        it('вертикальная картинка вписывается по высоте', async () => {
            const { file } = (await postComment(t, {}, { buffer: await png(300, 900), name: 'tall.png' })).body;
            expect(file.variants.original).toMatchObject({ width: 80, height: 240 });
        });

        it('анимированный GIF остаётся анимированным и в webp', async () => {
            const { file } = (await postComment(t, {}, { buffer: await gif(400, 300), name: 'anim.gif' })).body;
            const original = await sharp(t.s3.objects.get(t.s3.keyFromUrl(file.variants.original.url)).body, { animated: true }).metadata();
            const webp = await sharp(t.s3.objects.get(t.s3.keyFromUrl(file.variants.original.webpUrl)).body, { animated: true }).metadata();

            expect(original).toMatchObject({ format: 'gif', pages: 3 });
            expect(webp).toMatchObject({ format: 'webp', pages: 3 });
        });

        it('тип определяется по содержимому: текст под видом .png → 422', async () => {
            const res = await postComment(t, {}, { buffer: Buffer.from('not an image'), name: 'fake.png' }).expect(422);
            expect(res.body.code).toBe('file_image_invalid');
        });

        it('TXT до 100 КБ сохраняется как text/plain, больше — 400, бинарный — 422', async () => {
            const ok = await postComment(t, {}, { buffer: Buffer.from('Привет <script>x</script>'), name: 'note.txt' }).expect(201);
            expect(ok.body.file).toMatchObject({ type: 'TEXT', mimeType: 'text/plain', variants: null });
            expect(t.s3.objects.get(t.s3.keyFromUrl(ok.body.file.url)).contentType).toBe('text/plain; charset=utf-8');

            expect((await postComment(t, {}, { buffer: Buffer.alloc(101 * 1024, 97), name: 'big.txt' }).expect(400)).body.code).toBe(
                'file_text_too_large',
            );
            expect((await postComment(t, {}, { buffer: Buffer.from([0x48, 0x00, 0x49]), name: 'bin.txt' }).expect(422)).body.code).toBe(
                'file_text_invalid',
            );
        });

        it('недопустимый тип → 400 file_type_not_allowed', async () => {
            const res = await postComment(t, {}, { buffer: Buffer.from('MZ'), name: 'virus.exe' }).expect(400);
            expect(res.body.code).toBe('file_type_not_allowed');
        });

        it('файл больше 5 МБ в старом пути → 413', async () => {
            const res = await postComment(t, {}, { buffer: Buffer.alloc(5 * 1024 * 1024 + 1, 1), name: 'huge.png' }).expect(413);
            expect(res.body.code).toBe('file_too_large');
        });
    });

    describe('прямая multipart-загрузка в S3', () => {
        it('картинка 12 МБ → 3 куска по 5 МБ → READY → прикрепляется к комментарию один раз', async () => {
            const big = await sharp({
                create: {
                    width: 2200,
                    height: 1800,
                    channels: 3,
                    background: '#808080',
                    noise: { type: 'gaussian', mean: 128, sigma: 50 },
                },
            })
                .png({ compressionLevel: 0 })
                .toBuffer();
            const { init, status } = await directUpload(t, 'photo.png', big);

            expect(init.body.parts.map((p) => p.size)).toEqual([5 * 1024 * 1024, 5 * 1024 * 1024, big.length - 10 * 1024 * 1024]);
            expect(status).toMatchObject({ status: 'READY', file: { type: 'IMAGE', width: 293, height: 240 } });
            // исходник удалён, остались только 6 публичных вариантов
            expect([...t.s3.objects.keys()].filter((k) => k.includes('/uploads/'))).toEqual([]);

            const comment = await postComment(t, { uploadId: init.body.uploadId }).expect(201);
            expect(comment.body.file.variants.original.url).toBe(status.file.url);

            const reuse = await postComment(t, { uploadId: init.body.uploadId }).expect(404);
            expect(reuse.body.code).toBe('file_upload_not_found');
        });

        it('txt через прямую загрузку', async () => {
            const { status } = await directUpload(t, 'readme.txt', Buffer.from('hello'));
            expect(status).toMatchObject({ status: 'READY', file: { type: 'TEXT', size: 5 } });
        });

        it('подделка под картинку → FAILED file_image_invalid, прикрепить нельзя', async () => {
            const { init, status } = await directUpload(t, 'fake.jpg', Buffer.from('nope'));
            expect(status).toMatchObject({ status: 'FAILED', error: 'file_image_invalid' });
            expect((await postComment(t, { uploadId: init.body.uploadId }).expect(409)).body.code).toBe('file_upload_not_ready');
        });

        it('init: недопустимый тип и лимиты', async () => {
            expect((await api().post('/api/v1/uploads').send({ filename: 'a.exe', size: 10 }).expect(400)).body.code).toBe(
                'file_type_not_allowed',
            );
            expect(
                (
                    await api()
                        .post('/api/v1/uploads')
                        .send({ filename: 'a.txt', size: 200 * 1024 })
                        .expect(400)
                ).body.code,
            ).toBe('file_text_too_large');
            expect(
                (
                    await api()
                        .post('/api/v1/uploads')
                        .send({ filename: 'a.png', size: 21 * 1024 * 1024 })
                        .expect(400)
                ).body.code,
            ).toBe('file_image_too_large');
            await api().post('/api/v1/uploads').send({ filename: 'a.png', size: 0 }).expect(400);
        });

        it('complete без всех кусков → 409 file_upload_incomplete', async () => {
            const init = await api()
                .post('/api/v1/uploads')
                .send({ filename: 'p.png', size: 6 * 1024 * 1024 })
                .expect(201);
            t.s3.putPart(init.body.parts[0].url, Buffer.alloc(5 * 1024 * 1024));
            const res = await api().post(`/api/v1/uploads/${init.body.uploadId}/complete`).expect(409);
            expect(res.body.code).toBe('file_upload_incomplete');
        });

        it('parts переподписывает ссылки; abort удаляет сессию; неизвестный id → 404, не-uuid → 400', async () => {
            const init = await api().post('/api/v1/uploads').send({ filename: 'p.png', size: 100 }).expect(201);
            const parts = await api().post(`/api/v1/uploads/${init.body.uploadId}/parts`).expect(200);
            expect(parts.body.parts).toHaveLength(1);

            await api().delete(`/api/v1/uploads/${init.body.uploadId}`).expect(204);
            await api().get(`/api/v1/uploads/${init.body.uploadId}`).expect(404);
            await api().get('/api/v1/uploads/not-a-uuid').expect(400);
        });

        it('нельзя прислать одновременно file и uploadId', async () => {
            const { init } = await directUpload(t, 'n.txt', Buffer.from('x'));
            const res = await postComment(t, { uploadId: init.body.uploadId }, { buffer: Buffer.from('y'), name: 'y.txt' }).expect(400);
            expect(res.body.code).toBe('conflicting_file_sources');
        });
    });

    (hasFfmpeg ? describe : describe.skip)('видео → H.264/AAC MP4 для iOS/macOS', () => {
        const probeOutput = (url: string) => {
            const body = t.s3.objects.get(t.s3.keyFromUrl(url)).body;
            // faststart: атом moov идёт до mdat
            return { body, moovFirst: body.indexOf('moov') < body.indexOf('mdat') };
        };

        it('HEVC 10-бит в MKV перекодируется в MP4 (avc1, moov в начале) с постером jpg+webp', async () => {
            const source = video('hevc.mkv', [
                '-c:v',
                'libx265',
                '-pix_fmt',
                'yuv420p10le',
                '-x265-params',
                'log-level=error',
                '-c:a',
                'libopus',
            ]);
            const { init, status } = await directUpload(t, 'hevc.mkv', source, 120_000);

            expect(status).toMatchObject({ status: 'READY', file: { type: 'VIDEO', mimeType: 'video/mp4', width: 640, height: 360 } });
            const out = probeOutput(status.file.url);
            expect(out.body.includes(Buffer.from('avc1'))).toBe(true);
            expect(out.moovFirst).toBe(true);

            const comment = await postComment(t, { uploadId: init.body.uploadId }).expect(201);
            expect(comment.body.file.video).toMatchObject({ duration: expect.any(Number) });
            expect((await sharp(t.s3.objects.get(t.s3.keyFromUrl(comment.body.file.video.webpPosterUrl)).body).metadata()).format).toBe(
                'webp',
            );
            expect((await sharp(t.s3.objects.get(t.s3.keyFromUrl(comment.body.file.video.posterUrl)).body).metadata()).format).toBe('jpeg');
        });

        it('совместимое H.264/AAC MP4 только перепаковывается (размер почти не меняется)', async () => {
            const source = video('ok.mp4', ['-c:v', 'libx264', '-profile:v', 'main', '-pix_fmt', 'yuv420p', '-c:a', 'aac']);
            const { status } = await directUpload(t, 'ok.mp4', source);

            expect(status.status).toBe('READY');
            expect(Math.abs(status.file.size - source.length) / source.length).toBeLessThan(0.05);
        });

        it('не видео → FAILED file_video_invalid', async () => {
            const { status } = await directUpload(t, 'fake.mp4', Buffer.from('not a video'));
            expect(status).toMatchObject({ status: 'FAILED', error: 'file_video_invalid' });
        });

        it('видео в старом пути (в запросе комментария) не принимается', async () => {
            await postComment(t, {}, { buffer: Buffer.from('x'), name: 'clip.mp4' }).expect(400);
        });
    });
});
