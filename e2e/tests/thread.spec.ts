import { expect, test } from '@playwright/test';
import { CAPTCHA, gotoApp, resetData, seedComment, waitIndexed } from './helpers';

test.describe('Ответы, сортировка, пагинация', () => {
    test.beforeEach(async () => {
        await resetData();
    });

    test('ответ через форму под комментарием появляется в ветке', async ({ page, request }) => {
        await seedComment(request, { userName: 'Root1', text: 'корень' });
        await waitIndexed(1);
        await gotoApp(page);

        const card = page.locator('tbody').first();
        await card.getByRole('button', { name: 'Ответить' }).first().click();
        const reply = card.locator('form');
        await reply.getByPlaceholder('JohnDoe').fill('Replier1');
        await reply.getByPlaceholder('john@example.com').fill('reply@example.com');
        await reply.getByPlaceholder('Напишите комментарий…').fill('мой ответ');
        await reply.getByPlaceholder('Текст с картинки').fill(CAPTCHA);
        await reply.getByRole('button', { name: 'Ответить' }).click();

        await expect(card.getByText('мой ответ')).toBeVisible();
        await expect(card.getByText('1 ответ')).toBeVisible();
    });

    test('после 2 уровней ветка идёт плоским списком «в ответ …» с «Показать ещё»', async ({ page, request }) => {
        let parent = await seedComment(request, { userName: 'L0', text: 'level 0' });
        for (let i = 1; i <= 14; i++) parent = await seedComment(request, { userName: `L${i}`, text: `level ${i}`, parentUuid: parent.uuid });
        await waitIndexed(15);
        await gotoApp(page);

        const card = page.locator('tbody').first();
        await expect(card.getByText('level 1', { exact: true })).toBeVisible();
        await expect(card.getByText('в ответ').first()).toBeVisible();
        await expect(card.getByText('level 11', { exact: true })).toBeVisible();
        await expect(card.getByText('level 12', { exact: true })).toHaveCount(0);

        await card.getByRole('button', { name: /Показать все/ }).click();
        await expect(card.getByText('level 14', { exact: true })).toBeVisible();
    });

    test('сортировка через меню справа меняет порядок и URL', async ({ page, request }) => {
        for (const name of ['charlie', 'alice', 'bob']) await seedComment(request, { userName: name, email: `${name}@example.com`, text: name });
        await waitIndexed(3);
        await gotoApp(page);

        // в ячейке автора: буква аватара, затем имя
        const names = async () => (await page.locator('tbody tr:first-child td:first-child').allInnerTexts()).map((n) => n.split('\n')[1]);
        await expect.poll(names).toEqual(['bob', 'alice', 'charlie']);

        await page.getByRole('button', { name: /Сначала новые/ }).click();
        await page.getByRole('option', { name: 'User Name: A → Z' }).click();
        await expect(page).toHaveURL(/sortBy=userName&sortOrder=ASC/);
        await expect.poll(names).toEqual(['alice', 'bob', 'charlie']);

        await page.reload();
        await expect(page.getByRole('button', { name: /User Name: A → Z/ })).toBeVisible();
    });

    test('пагинация по 25', async ({ page, request }) => {
        for (let i = 0; i < 27; i++) await seedComment(request, { userName: `p${i}`, text: `page item ${i}` });
        await waitIndexed(27);
        await gotoApp(page);

        await expect(page.locator('tbody')).toHaveCount(25);
        await page.getByRole('navigation', { name: 'Страницы' }).getByRole('button', { name: '2' }).click();
        await expect(page).toHaveURL(/page=2/);
        await expect(page.locator('tbody')).toHaveCount(2);
        await expect(page.getByText('page item 0', { exact: true })).toBeVisible();
    });

    test('лайк сохраняется после перезагрузки, повторный клик снимает', async ({ page, request }) => {
        await seedComment(request);
        await waitIndexed(1);
        await gotoApp(page);

        const like = page.locator('tbody').first().getByTitle('Нравится').first();
        await like.click();
        await expect(like).toHaveAttribute('aria-pressed', 'true');
        await expect(like).toContainText('1');

        await page.reload();
        const likeAfter = page.locator('tbody').first().getByTitle('Нравится').first();
        await expect(likeAfter).toHaveAttribute('aria-pressed', 'true');
        await expect(likeAfter).toContainText('1');

        await likeAfter.click();
        await expect(likeAfter).toHaveAttribute('aria-pressed', 'false');
        await expect(likeAfter).toContainText('0');
    });
});
