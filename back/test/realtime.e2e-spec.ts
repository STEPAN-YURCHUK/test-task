import request = require('supertest');
import { io, Socket } from 'socket.io-client';
import { postComment } from './helpers/factories';
import { createTestApp, TestApp } from './helpers/test-app';

describe('Realtime: socket.io /comments (e2e)', () => {
    let t: TestApp;
    let socket: Socket;

    const next = <T>(event: string) => new Promise<T>((resolve) => socket.once(event, resolve));

    beforeAll(async () => {
        t = await createTestApp();
        socket = io(`${t.baseUrl}/comments`, { transports: ['websocket'] });
        await new Promise<void>((resolve) => socket.on('connect', () => resolve()));
    });
    beforeEach(() => t.reset());
    afterAll(async () => {
        socket.close();
        await t.close();
    });

    it('новый комментарий рассылается всем в публичной форме', async () => {
        const event = next<any>('comment_created');
        const created = (await postComment(t, { text: 'live <i>now</i>' }).expect(201)).body;
        const pushed = await event;

        expect(pushed).toMatchObject({ uuid: created.uuid, text: 'live <i>now</i>', user: { userName: 'Tester1' } });
        expect(pushed).not.toHaveProperty('ipAddress');
    });

    it('ответ рассылается с parentUuid/rootUuid', async () => {
        const root = (await postComment(t)).body;
        const event = next<any>('comment_created');
        await postComment(t, { parentUuid: root.uuid });
        expect(await event).toMatchObject({ parentUuid: root.uuid, rootUuid: root.uuid });
    });

    it('голос рассылается новыми счётчиками', async () => {
        const { uuid } = (await postComment(t)).body;
        const token = (await request(t.app.getHttpServer()).post('/api/v1/comments/voters')).body.token;
        const event = next<any>('comment_voted');

        await request(t.app.getHttpServer())
            .put(`/api/v1/comments/${uuid}/vote`)
            .set('Authorization', `Bearer ${token}`)
            .send({ value: -1 });
        expect(await event).toEqual({ commentUuid: uuid, likesCount: 0, dislikesCount: 1, rating: -1 });
    });

    it('несколько клиентов получают одно и то же событие', async () => {
        const other = io(`${t.baseUrl}/comments`, { transports: ['websocket'] });
        await new Promise<void>((resolve) => other.on('connect', () => resolve()));

        const both = Promise.all([next<any>('comment_created'), new Promise<any>((r) => other.once('comment_created', r))]);
        await postComment(t);
        const [a, b] = await both;
        other.close();

        expect(a.uuid).toBe(b.uuid);
    });
});
