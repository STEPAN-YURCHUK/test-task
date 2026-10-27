import { expect, test } from '@playwright/test';
import { gotoApp, resetData, seedComment, waitIndexed } from './helpers';

test('мобильная вёрстка: без горизонтального скролла, форма и список доступны', async ({ page, request }) => {
    await resetData();
    await seedComment(request, { userName: 'VeryLongUserNameForMobileCheck123', email: 'very.long.email.address@example-domain.com', text: 'x'.repeat(300) });
    await waitIndexed(1);
    await gotoApp(page);

    await expect(page.getByRole('heading', { name: 'Новый комментарий' })).toBeVisible();
    await expect(page.locator('tbody').first()).toBeVisible();
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(overflow).toBeLessThanOrEqual(0);
});
