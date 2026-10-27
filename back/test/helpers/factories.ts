import request = require('supertest');
import { TestApp } from './test-app';

export const CAPTCHA_TEXT = process.env.CAPTCHA_FIXED_TEXT;

// Капча одноразовая: на каждый POST — свой токен
export async function captcha(t: TestApp): Promise<string> {
    const res = await request(t.app.getHttpServer()).get('/api/v1/captcha').expect(200);
    return res.body.token;
}

export type CommentFields = Partial<{
    userName: string;
    email: string;
    homePage: string;
    text: string;
    parentUuid: string;
    uploadId: string;
}>;

type PendingResponse = PromiseLike<request.Response> & { expect: (status: number) => Promise<request.Response> };

// Капча берётся перед запросом, поэтому результат — «отложенный» supertest: await или .expect(status)
export function postComment(t: TestApp, fields: CommentFields = {}, file?: { buffer: Buffer; name: string }): PendingResponse {
    const ready = (async () => {
        const req = request(t.app.getHttpServer())
            .post('/api/v1/comments')
            .set('Accept-Language', 'en')
            .field('userName', fields.userName ?? 'Tester1')
            .field('email', fields.email ?? 'tester@example.com')
            .field('text', fields.text ?? 'Hello <strong>world</strong>')
            .field('captchaToken', await captcha(t))
            .field('captcha', CAPTCHA_TEXT);

        if (fields.homePage !== undefined) req.field('homePage', fields.homePage);
        if (fields.parentUuid) req.field('parentUuid', fields.parentUuid);
        if (fields.uploadId) req.field('uploadId', fields.uploadId);
        if (file) req.attach('file', file.buffer, file.name);

        return { req };
    })();

    return {
        expect: (status) => ready.then(({ req }) => req.expect(status)),
        then: (onFulfilled, onRejected) => ready.then(({ req }) => req.then((res) => res)).then(onFulfilled, onRejected),
    };
}

// Прямая загрузка через in-memory S3: init → куски → complete → ожидание READY/FAILED
export async function directUpload(t: TestApp, name: string, buffer: Buffer, timeoutMs = 60_000) {
    const server = t.app.getHttpServer();
    const init = await request(server).post('/api/v1/uploads').send({ filename: name, size: buffer.length });
    if (init.status !== 201) return { init, status: null };

    for (const part of init.body.parts) {
        const start = (part.partNumber - 1) * init.body.partSize;
        t.s3.putPart(part.url, buffer.subarray(start, start + part.size));
    }

    let status = (await request(server).post(`/api/v1/uploads/${init.body.uploadId}/complete`).expect(200)).body;
    const deadline = Date.now() + timeoutMs;
    while (status.status === 'PROCESSING' && Date.now() < deadline) {
        await new Promise((r) => setTimeout(r, 200));
        status = (await request(server).get(`/api/v1/uploads/${init.body.uploadId}`).expect(200)).body;
    }
    return { init, status };
}
