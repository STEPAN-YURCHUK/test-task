import { expect, test } from '@playwright/test';
import { API } from '../playwright.config';
import { CAPTCHA, gotoApp, resetData, seedComment, waitIndexed } from './helpers';

test.describe('XSS в браузере', () => {
    test.beforeEach(async () => {
        await resetData();
    });

    test('разрешённые теги рендерятся, скрипты не исполняются ни при каких вариантах', async ({ page, request }) => {
        let alerted = false;
        page.on('dialog', async (d) => {
            alerted = true;
            await d.dismiss();
        });

        await seedComment(request, { text: 'ok <a href="https://example.com" title="t">link</a> <i>it</i> 5 < 6 & "quotes" \'x\'' });
        for (const text of ['<script>alert(1)</script>', '<img src=x onerror=alert(1)>', '<a href="javascript:alert(1)">x</a>', '<i onmouseover="alert(1)">x</i>']) {
            const { token } = await (await request.get(`${API}/captcha`)).json();
            const res = await request.post(`${API}/comments`, { multipart: { userName: 'Hacker', email: 'h@example.com', text, captchaToken: token, captcha: CAPTCHA } });
            expect(res.status()).toBe(400);
        }
        await waitIndexed(1);
        await gotoApp(page);

        const body = page.locator('tbody').first();
        await expect(body.getByRole('link', { name: 'link' })).toHaveAttribute('href', 'https://example.com');
        await expect(body.locator('i', { hasText: 'it' })).toBeVisible();
        await expect(body).toContainText(`5 < 6 & "quotes" 'x'`); // спецсимволы экранированы и показаны текстом
        await expect(body.locator('img[src="x"], script')).toHaveCount(0);
        await page.mouse.move(10, 10);
        expect(alerted).toBe(false);
    });
});
