import request = require('supertest');
import { postComment } from './helpers/factories';
import { createTestApp, TestApp } from './helpers/test-app';

describe('Votes (e2e)', () => {
    let t: TestApp;
    const api = () => request(t.app.getHttpServer());
    const voter = async () => (await api().post('/api/v1/comments/voters').expect(201)).body.token as string;
    const vote = (token: string, uuid: string, value: number) =>
        api().put(`/api/v1/comments/${uuid}/vote`).set('Authorization', `Bearer ${token}`).send({ value });

    beforeAll(async () => {
        t = await createTestApp();
    });
    beforeEach(() => t.reset());
    afterAll(() => t.close());

    it('лайк, повтор (без изменений), смена на дизлайк, снятие голоса', async () => {
        const { uuid } = (await postComment(t)).body;
        const a = await voter();

        expect((await vote(a, uuid, 1).expect(200)).body).toEqual({ likesCount: 1, dislikesCount: 0, rating: 1, myVote: 1 });
        expect((await vote(a, uuid, 1).expect(200)).body).toMatchObject({ likesCount: 1, rating: 1 });
        expect((await vote(a, uuid, -1).expect(200)).body).toEqual({ likesCount: 0, dislikesCount: 1, rating: -1, myVote: -1 });
        expect((await vote(a, uuid, 0).expect(200)).body).toEqual({ likesCount: 0, dislikesCount: 0, rating: 0, myVote: 0 });
    });

    it('голоса разных людей суммируются; myVotes возвращает только свои', async () => {
        const c1 = (await postComment(t)).body.uuid;
        const c2 = (await postComment(t)).body.uuid;
        const [a, b] = [await voter(), await voter()];

        await vote(a, c1, 1);
        await vote(b, c1, 1);
        await vote(b, c2, -1);

        const mine = (
            await api()
                .post('/api/v1/comments/votes/my')
                .set('Authorization', `Bearer ${b}`)
                .send({ uuids: [c1, c2] })
                .expect(200)
        ).body;
        expect(mine).toEqual({ [c1]: 1, [c2]: -1 });
        expect((await api().get(`/api/v1/comments/${c1}`)).body.likesCount).toBe(2);
    });

    it('параллельные голоса не теряют счётчики (блокировка строки)', async () => {
        const { uuid } = (await postComment(t)).body;
        const tokens = await Promise.all(Array.from({ length: 15 }, voter));
        await Promise.all(tokens.map((token) => vote(token, uuid, 1).expect(200)));

        expect((await api().get(`/api/v1/comments/${uuid}`)).body.likesCount).toBe(15);
    });

    it('сортировка «Популярные» по рейтингу', async () => {
        const low = (await postComment(t, { text: 'low' })).body.uuid;
        const top = (await postComment(t, { text: 'top' })).body.uuid;
        const mid = (await postComment(t, { text: 'mid' })).body.uuid;
        const tokens = await Promise.all([voter(), voter(), voter()]);
        await Promise.all(tokens.map((token) => vote(token, top, 1)));
        await vote(tokens[0], mid, 1);
        await vote(tokens[0], low, -1);
        await t.waitForIndex();

        const { items } = (await api().get('/api/v1/comments?sortBy=rating&sortOrder=DESC').expect(200)).body;
        expect(items.map((i) => i.text)).toEqual(['top', 'mid', 'low']);
    });

    it.each([
        ['без токена', undefined, 401],
        ['чужой/битый токен', 'Bearer abc.def.ghi', 401],
        ['не Bearer', 'Basic abc', 401],
    ])('%s → %i', async (_name, header, status) => {
        const { uuid } = (await postComment(t)).body;
        const req = api().put(`/api/v1/comments/${uuid}/vote`).send({ value: 1 });
        if (header) req.set('Authorization', header);
        expect((await req.expect(status)).body.code).toBe('invalid_voter_token');
    });

    it('недопустимое значение → 400, несуществующий комментарий → 404', async () => {
        const token = await voter();
        const { uuid } = (await postComment(t)).body;
        await vote(token, uuid, 5).expect(400);
        await vote(token, '6f1c2c55-1111-4a4a-9b9b-1234567890ab', 1).expect(404);
    });
});
