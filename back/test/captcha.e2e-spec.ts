import request = require('supertest');
import { CAPTCHA_TEXT } from './helpers/factories';
import { createTestApp, TestApp } from './helpers/test-app';

describe('CAPTCHA (e2e)', () => {
    let t: TestApp;

    beforeAll(async () => {
        t = await createTestApp();
    });
    beforeEach(() => t.reset());
    afterAll(() => t.close());

    const post = (token: string, answer: string) =>
        request(t.app.getHttpServer())
            .post('/api/v1/comments')
            .field('userName', 'Cap1')
            .field('email', 'cap@example.com')
            .field('text', 'captcha check')
            .field('captchaToken', token)
            .field('captcha', answer);

    it('GET /captcha — SVG картинка (data URI) и подписанный токен, без кеширования', async () => {
        const res = await request(t.app.getHttpServer()).get('/api/v1/captcha').expect(200);

        expect(res.headers['cache-control']).toBe('no-store');
        expect(res.body.image).toMatch(/^data:image\/svg\+xml;base64,/);
        expect(Buffer.from(res.body.image.split(',')[1], 'base64').toString()).toContain('<svg');
        expect(res.body.token.split('.')).toHaveLength(3);
    });

    it('верный ответ принимается без учёта регистра', async () => {
        const { body } = await request(t.app.getHttpServer()).get('/api/v1/captcha');
        await post(body.token, CAPTCHA_TEXT.toUpperCase()).expect(201);
    });

    it('неверный ответ → 400 captcha_invalid', async () => {
        const { body } = await request(t.app.getHttpServer()).get('/api/v1/captcha');
        const res = await post(body.token, 'wrong1').expect(400);
        expect(res.body.code).toBe('captcha_invalid');
    });

    it('токен одноразовый: повтор после успеха и после ошибки → captcha_expired', async () => {
        const first = (await request(t.app.getHttpServer()).get('/api/v1/captcha')).body.token;
        await post(first, CAPTCHA_TEXT).expect(201);
        expect((await post(first, CAPTCHA_TEXT).expect(400)).body.code).toBe('captcha_expired');

        const second = (await request(t.app.getHttpServer()).get('/api/v1/captcha')).body.token;
        await post(second, 'wrong1').expect(400);
        expect((await post(second, CAPTCHA_TEXT).expect(400)).body.code).toBe('captcha_expired');
    });

    it('одна решённая капча при параллельной отправке создаёт ровно один комментарий', async () => {
        const { token } = (await request(t.app.getHttpServer()).get('/api/v1/captcha')).body;
        const results = await Promise.all(Array.from({ length: 5 }, () => post(token, CAPTCHA_TEXT)));

        expect(results.map((r) => r.status).sort()).toEqual([201, 400, 400, 400, 400]);
        expect(results.filter((r) => r.status === 400).every((r) => r.body.code === 'captcha_expired')).toBe(true);
    });

    it('подделанный токен → captcha_expired', async () => {
        const res = await post('eyJhbGciOiJIUzI1NiJ9.eyJqdGkiOiJ4In0.forged', CAPTCHA_TEXT).expect(400);
        expect(res.body.code).toBe('captcha_expired');
    });

    it('ответ не из латиницы/цифр → ошибка валидации поля captcha', async () => {
        const { body } = await request(t.app.getHttpServer()).get('/api/v1/captcha');
        const res = await post(body.token, 'абв!').expect(400);
        expect(res.body.errors.captcha).toBeDefined();
    });
});
