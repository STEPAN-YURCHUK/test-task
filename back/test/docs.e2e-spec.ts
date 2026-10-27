import request = require('supertest');
import { createTestApp, TestApp } from './helpers/test-app';

// документация API: Scalar на /api/docs и OpenAPI на /api/docs-json (включается API_DOCS_ENABLED=true)
describe('API docs (e2e)', () => {
    let t: TestApp;
    let spec: any;

    beforeAll(async () => {
        process.env.API_DOCS_ENABLED = 'true';
        t = await createTestApp();
        spec = (await request(t.app.getHttpServer()).get('/api/docs-json').expect(200)).body;
    });
    afterAll(async () => {
        delete process.env.API_DOCS_ENABLED;
        await t.close();
    });

    const operations = () =>
        Object.entries(spec.paths).flatMap(([path, item]: [string, any]) =>
            Object.entries(item).map(([method, op]: [string, any]) => ({ path, method, op })),
        );

    it('/api/docs отдаёт HTML-страницу документации', async () => {
        const res = await request(t.app.getHttpServer()).get('/api/docs').expect(200);
        expect(res.headers['content-type']).toContain('text/html');
        expect(res.text).toContain('Comments API');
    });

    it('описаны все 13 ручек, у каждой — summary, тег [Client] и успешный ответ', () => {
        const ops = operations();
        expect(ops).toHaveLength(13);
        for (const { path, method, op } of ops) {
            expect({ path, method, summary: op.summary }).toEqual({ path, method, summary: expect.any(String) });
            expect(op.tags[0]).toMatch(/^\[Client\] /);
            expect(Object.keys(op.responses).some((code) => code.startsWith('2'))).toBe(true);
        }
    });

    it('сайдбар Scalar: каждый использованный тег входит ровно в одну группу', () => {
        const used = new Set(operations().map(({ op }) => op.tags[0]));
        const grouped = spec['x-tagGroups'].flatMap((group) => group.tags);
        expect(spec['x-tagGroups'].map((g) => g.name)).toEqual(['Captcha', 'Comment', 'File']);
        expect(new Set(grouped)).toEqual(used);
        expect(grouped).toHaveLength(used.size);
    });

    it('примеры ошибок совпадают с реальными ответами API (code + локализованный message)', async () => {
        const example = spec.paths['/api/v1/comments/{commentUuid}'].get.responses['404'].content['application/json'].schema.example;
        const real = (await request(t.app.getHttpServer()).get('/api/v1/comments/6f1c2c55-1111-4a4a-9b9b-1234567890ab').expect(404)).body;
        expect(real).toEqual(example);
    });

    it('голосование требует схему voter, создание комментария — multipart с полями формы', () => {
        expect(spec.components.securitySchemes.voter).toMatchObject({ type: 'http', scheme: 'bearer' });
        expect(spec.paths['/api/v1/comments/{commentUuid}/vote'].put.security).toEqual([{ voter: [] }]);

        const body = spec.paths['/api/v1/comments'].post.requestBody.content['multipart/form-data'].schema;
        const ref = body.$ref ? spec.components.schemas[body.$ref.split('/').pop()] : body;
        expect(Object.keys(ref.properties)).toEqual(
            expect.arrayContaining(['userName', 'email', 'homePage', 'text', 'parentUuid', 'uploadId', 'captchaToken', 'captcha', 'file']),
        );
    });

    it('в описании есть разделы про поток публикации, загрузку файлов и WebSocket', () => {
        for (const section of [
            'Posting a comment',
            'Attachments',
            'Votes',
            'Errors and language',
            'WebSocket',
            'comment_created',
            'comment_voted',
        ]) {
            expect(spec.info.description).toContain(section);
        }
    });
});
