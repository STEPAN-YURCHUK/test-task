import { expect, test } from '@playwright/test';
import { resetData, seedComment, waitIndexed } from './helpers';

test.describe('Realtime между вкладками (socket.io)', () => {
    test.beforeEach(async () => {
        await resetData();
    });

    test('новый комментарий и ответ появляются у другого пользователя без перезагрузки', async ({ browser, request }) => {
        const viewer = await (await browser.newContext()).newPage();
        await viewer.goto('/');
        await expect(viewer.getByText('Live')).toBeVisible();

        const root = await seedComment(request, { userName: 'Writer1', text: 'пишу в реальном времени' });
        await expect(viewer.getByText('пишу в реальном времени')).toBeVisible();

        await seedComment(request, { userName: 'Writer2', text: 'и отвечаю', parentUuid: root.uuid });
        await expect(viewer.getByText('и отвечаю')).toBeVisible();
    });

    test('голос другого пользователя обновляет счётчик', async ({ browser, request }) => {
        const c = await seedComment(request);
        await waitIndexed(1);
        const viewer = await (await browser.newContext()).newPage();
        await viewer.goto('/');

        const { token } = await (await request.post('http://localhost:4100/api/v1/comments/voters')).json();
        await request.put(`http://localhost:4100/api/v1/comments/${c.uuid}/vote`, { headers: { Authorization: `Bearer ${token}` }, data: { value: 1 } });

        await expect(viewer.locator('tbody').first().getByTitle('Нравится').first()).toContainText('1');
    });

    test('при не-LIFO сортировке новый заглавный комментарий — баннером', async ({ browser, request }) => {
        await seedComment(request, { userName: 'alice' });
        await waitIndexed(1);
        const viewer = await (await browser.newContext()).newPage();
        await viewer.goto('/?sortBy=userName&sortOrder=ASC');
        await expect(viewer.getByText('Live')).toBeVisible();

        await seedComment(request, { userName: 'zed' });
        await expect(viewer.getByRole('button', { name: /Новых комментариев: 1/ })).toBeVisible();
    });
});
