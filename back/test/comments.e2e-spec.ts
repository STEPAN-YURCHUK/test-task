import request = require('supertest');
import { Sequelize } from 'sequelize-typescript';
import { MeiliIndexEnum } from 'src/infrastructure/meilisearch/enums/meili-index.enum';
import { MeiliSearchService } from 'src/infrastructure/meilisearch/services/meilisearch.service';
import { DisposableEmailService } from 'src/infrastructure/disposable-email/services/disposable-email.service';
import { CommentMeilisearchService } from 'src/modules/comment-manager/comment/services/comment-meilisearch.service';
import { postComment } from './helpers/factories';
import { createTestApp, TestApp } from './helpers/test-app';

// eslint-disable-next-line @typescript-eslint/no-require-imports
const errorsEn: Record<string, string> = require('src/shared/localization/locales/en/errors.json');

describe('Comments (e2e)', () => {
    let t: TestApp;
    const api = () => request(t.app.getHttpServer());

    beforeAll(async () => {
        t = await createTestApp();
    });
    beforeEach(() => t.reset());
    afterAll(() => t.close());

    describe('создание', () => {
        it('создаёт заглавный комментарий и отдаёт публичную форму без ip/userAgent', async () => {
            const res = await postComment(t, { userName: 'John2024', email: 'John@Example.com', homePage: 'https://john.dev' }).expect(201);

            expect(res.body).toMatchObject({
                parentUuid: null,
                rootUuid: null,
                text: 'Hello <strong>world</strong>',
                likesCount: 0,
                dislikesCount: 0,
                user: { userName: 'John2024', email: 'john@example.com', homePage: 'https://john.dev' },
                file: null,
            });
            expect(res.body).not.toHaveProperty('ipAddress');
            expect(res.body).not.toHaveProperty('userAgent');
        });

        it('один и тот же автор (email + userName) переиспользуется, homePage не затирается', async () => {
            await postComment(t, { userName: 'Same1', email: 'same@example.com', homePage: 'https://same.dev' }).expect(201);
            const second = await postComment(t, { userName: 'Same1', email: 'same@example.com' }).expect(201);

            expect(second.body.user.homePage).toBe('https://same.dev');
        });

        it('временный e-mail (в том числе поддомен сервиса) → 400 disposable_email_not_allowed, комментарий не создаётся', async () => {
            const fetchSpy = jest
                .spyOn(globalThis, 'fetch')
                .mockImplementation(async () => new Response('mailinator.com\nyopmail.com\n', { status: 200 }));
            await t.app.get(DisposableEmailService).refresh();
            fetchSpy.mockRestore();

            for (const email of ['spam@mailinator.com', 'spam@eu.yopmail.com']) {
                const res = await postComment(t, { email }).expect(400);
                expect(res.body).toMatchObject({
                    status: 400,
                    code: 'disposable_email_not_allowed',
                    message: expect.stringContaining('Temporary email'),
                });
            }
            await postComment(t, { email: 'real@gmail.com' }).expect(201);
            await t.waitForIndex();
            expect((await api().get('/api/v1/comments')).body.items.map((i: any) => i.user.email)).toEqual(['real@gmail.com']);
        });

        it('новая Home page автора видна во всех его комментариях — и из Meilisearch, и из Postgres', async () => {
            await postComment(t, { userName: 'Move1', email: 'move@example.com', homePage: 'https://old.dev' }).expect(201);
            await postComment(t, { userName: 'Move1', email: 'move@example.com', homePage: 'https://new.dev' }).expect(201);
            await t.waitForIndex();
            await t.app.get(MeiliSearchService).waitForPendingTasks(MeiliIndexEnum.COMMENT);

            const homePages = (body: any) => body.items.map((i: any) => i.user.homePage);
            expect(homePages((await api().get('/api/v1/comments')).body)).toEqual(['https://new.dev', 'https://new.dev']);

            const spy = jest.spyOn(t.app.get(MeiliSearchService), 'search').mockRejectedValue(new Error('meili down'));
            expect(homePages((await api().get('/api/v1/comments')).body)).toEqual(['https://new.dev', 'https://new.dev']);
            spy.mockRestore();
        });

        it.each([
            ['userName пустой', { userName: '' }, 'userName'],
            ['userName с пробелом и кириллицей', { userName: 'Иван Петров' }, 'userName'],
            ['userName длиннее 50', { userName: 'a'.repeat(51) }, 'userName'],
            ['email без домена', { email: 'john@' }, 'email'],
            ['homePage не http(s)', { homePage: 'ftp://site.com' }, 'homePage'],
            ['homePage без протокола', { homePage: 'site.com' }, 'homePage'],
            ['text пустой', { text: '' }, 'text'],
            ['text из одних тегов', { text: '<i></i>' }, 'text'],
            ['text длиннее 5000', { text: 'x'.repeat(5001) }, 'text'],
            ['parentUuid не uuid', { parentUuid: '123' }, 'parentUuid'],
        ])('валидация: %s → 400 с ошибкой поля', async (_name, fields, field) => {
            const res = await postComment(t, fields).expect(400);
            expect(res.body.code).toBe('not_valid_data');
            expect(res.body.errors[field]).toBeDefined();
        });

        it('сообщения ошибок локализуются по Accept-Language', async () => {
            const res = await api()
                .post('/api/v1/comments')
                .set('Accept-Language', 'ru')
                .field('userName', 'bad name')
                .field('email', 'x')
                .field('text', 'ok')
                .field('captchaToken', 't')
                .field('captcha', 'abc')
                .expect(400);

            expect(res.body.message).toBe('Ошибка валидации');
            expect(res.body.errors.userName[0]).toBe('Только латинские буквы и цифры');
        });

        it('ответ на несуществующий комментарий → 422 parent_comment_not_found', async () => {
            const res = await postComment(t, { parentUuid: '6f1c2c55-1111-4a4a-9b9b-1234567890ab' }).expect(422);
            expect(res.body.code).toBe('parent_comment_not_found');
        });
    });

    describe('XSS: разрешены только a[href,title], code, i, strong', () => {
        it.each([
            ['<script>alert(1)</script>', 'text_tag_not_allowed'],
            ['<img src=x onerror=alert(1)>', 'text_malformed_tag'],
            ['<a href="javascript:alert(1)">x</a>', 'text_unsafe_url'],
            ['<i onclick="steal()">x</i>', 'text_attribute_not_allowed'],
            ['<strong><i>x</strong></i>', 'text_unexpected_closing_tag'],
            ['<code>не закрыт', 'text_tag_not_closed'],
            ['<iframe src="https://evil"></iframe>', 'text_tag_not_allowed'],
            ['<svg onload=alert(1)>', 'text_malformed_tag'],
            ['<svg onload="alert(1)">', 'text_tag_not_allowed'],
        ])('%s отклоняется', async (text, key) => {
            const res = await postComment(t, { text }).expect(400);
            expect(res.body.errors.text[0]).toBe(errorsEn[key]);
        });

        it('сохраняется канонический XHTML: текст экранирован, атрибуты в кавычках', async () => {
            const res = await postComment(t, {
                text: `a < b & "q" <A HREF='https://x.io/?a=1&b=2' title="t">l</A> <code>if (a < b)</code>`,
            });
            // одиночный "<" и спецсимволы экранируются, тег ссылки нормализуется
            expect(res.status).toBe(201);
            expect(res.body.text).toBe(
                'a &lt; b &amp; &quot;q&quot; <a href="https://x.io/?a=1&amp;b=2" title="t">l</a> <code>if (a &lt; b)</code>',
            );
        });

        it('preview рендерит ровно то, что будет сохранено, и валидирует так же', async () => {
            const ok = await api().post('/api/v1/comments/preview').send({ text: '<i>hi</i> & <a href="https://a.b">l</a>' }).expect(200);
            expect(ok.body.html).toBe('<i>hi</i> &amp; <a href="https://a.b">l</a>');

            const bad = await api().post('/api/v1/comments/preview').send({ text: '<b>no</b>' }).expect(400);
            expect(bad.body.errors.text).toBeDefined();
        });
    });

    describe('каскад ответов', () => {
        it('rootUuid указывает на заглавный комментарий на любой глубине; replies приходят в списке', async () => {
            const root = (await postComment(t, { text: 'root' })).body;
            const r1 = (await postComment(t, { text: 'r1', parentUuid: root.uuid })).body;
            const r2 = (await postComment(t, { text: 'r2', parentUuid: r1.uuid })).body;
            const r3 = (await postComment(t, { text: 'r3', parentUuid: r2.uuid })).body;

            expect([r1.rootUuid, r2.rootUuid, r3.rootUuid]).toEqual([root.uuid, root.uuid, root.uuid]);
            expect(r3.parentUuid).toBe(r2.uuid);

            await t.waitForIndex();
            const list = (await api().get('/api/v1/comments').expect(200)).body;
            expect(list.total).toBe(1);
            expect(list.items[0].replies.map((r) => r.text)).toEqual(['r1', 'r2', 'r3']);
        });
    });

    describe('список: пагинация 25, сортировки, LIFO по умолчанию', () => {
        beforeEach(async () => {
            const users = ['charlie', 'alice', 'bob'];
            for (let i = 0; i < 30; i++) {
                await postComment(t, { userName: `${users[i % 3]}${i}`, email: `${users[(i + 1) % 3]}${i}@example.com`, text: `c${i}` });
            }
            await t.waitForIndex();
        });

        it('по умолчанию LIFO и 25 на странице', async () => {
            const page1 = (await api().get('/api/v1/comments').expect(200)).body;
            expect(page1).toMatchObject({ total: 30, page: 1, pageSize: 25, totalPages: 2 });
            expect(page1.items).toHaveLength(25);
            expect(page1.items[0].text).toBe('c29');

            const page2 = (await api().get('/api/v1/comments?page=2').expect(200)).body;
            expect(page2.items.map((i) => i.text)).toEqual(['c4', 'c3', 'c2', 'c1', 'c0']);
        });

        // побайтовое сравнение — так сортируют и Postgres (C-collation для ascii), и Meilisearch
        const cmp = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);
        const sortedBy = (items: any[], pick: (i: any) => string, dir: 1 | -1) =>
            items.every((item, i) => i === 0 || dir * cmp(pick(items[i - 1]), pick(item)) <= 0);

        it.each([
            ['createdAt', 'ASC', (i) => i.createdAt, 1],
            ['createdAt', 'DESC', (i) => i.createdAt, -1],
            ['userName', 'ASC', (i) => i.user.userName.toLowerCase(), 1],
            ['userName', 'DESC', (i) => i.user.userName.toLowerCase(), -1],
            ['email', 'ASC', (i) => i.user.email, 1],
            ['email', 'DESC', (i) => i.user.email, -1],
        ] as const)('sortBy=%s&sortOrder=%s', async (sortBy, sortOrder, pick, dir) => {
            const { items } = (await api().get(`/api/v1/comments?sortBy=${sortBy}&sortOrder=${sortOrder}`).expect(200)).body;
            expect(sortedBy(items, pick, dir)).toBe(true);
        });

        it('полная переиндексация (keyset-пагинация батчами) восстанавливает пустой индекс', async () => {
            const before = (await api().get('/api/v1/comments?sortBy=email&sortOrder=ASC')).body;
            await t.app.get(MeiliSearchService).clear(MeiliIndexEnum.COMMENT);
            expect((await api().get('/api/v1/comments')).body.total).toBe(0);
            // регрессия: даты с микросекундами (как у данных из SQL) раньше зацикливали курсор переиндексации
            await t.app.get(Sequelize).query("UPDATE comments SET created_at = created_at + random() * interval '0.9 millisecond'");

            await t.app.get(CommentMeilisearchService).reindexAll();
            await t.waitForIndex();

            const after = (await api().get('/api/v1/comments?sortBy=email&sortOrder=ASC')).body;
            expect(after.total).toBe(30);
            expect(after.items.map((i) => i.uuid)).toEqual(before.items.map((i) => i.uuid));
        });

        it('при недоступном Meilisearch список читается из Postgres с тем же результатом', async () => {
            const fromMeili = (await api().get('/api/v1/comments?sortBy=userName&sortOrder=ASC')).body;
            const spy = jest.spyOn(t.app.get(MeiliSearchService), 'search').mockRejectedValue(new Error('meili down'));

            const fromPostgres = (await api().get('/api/v1/comments?sortBy=userName&sortOrder=ASC').expect(200)).body;
            spy.mockRestore();

            expect(fromPostgres.total).toBe(fromMeili.total);
            expect(fromPostgres.items.map((i) => i.uuid)).toEqual(fromMeili.items.map((i) => i.uuid));
        });
    });

    describe('защита от SQL-инъекций и мусорных параметров', () => {
        it.each([
            'sortBy=userName;DROP TABLE comments',
            'sortBy=createdAt&sortOrder=ASC;--',
            'sortBy=(SELECT 1)',
            'page=0',
            'page=-1',
            'page=1 OR 1=1',
            'page=abc',
        ])('%s → 400', async (query) => {
            await api().get(`/api/v1/comments?${query}`).expect(400);
        });

        it('после попыток таблица на месте', async () => {
            await postComment(t).expect(201);
            await api().get("/api/v1/comments?sortBy=userName';DROP TABLE comments;--").expect(400);
            await t.waitForIndex();
            expect((await api().get('/api/v1/comments').expect(200)).body.total).toBe(1);
        });

        it('GET /comments/:uuid — 400 на не-uuid и 404 на несуществующий', async () => {
            await api().get('/api/v1/comments/1%20OR%201=1').expect(400);
            const res = await api().get('/api/v1/comments/6f1c2c55-1111-4a4a-9b9b-1234567890ab').expect(404);
            expect(res.body.code).toBe('comment_not_found');
        });

        it('GET /comments/:uuid отдаёт комментарий', async () => {
            const created = (await postComment(t)).body;
            const res = await api().get(`/api/v1/comments/${created.uuid}`).expect(200);
            expect(res.body.uuid).toBe(created.uuid);
        });
    });
});
