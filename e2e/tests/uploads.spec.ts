import { expect, test } from '@playwright/test';
import { join } from 'path';
import { CAPTCHA, fillMainForm, gotoApp, mainForm, resetData } from './helpers';

const fixture = (name: string) => join(__dirname, '..', 'fixtures', name);

// Настоящий S3 (DigitalOcean Spaces, папка comments/e2e): куски летят из браузера по presigned PUT, файлы — через CDN
test.describe('Загрузка файлов напрямую в S3', () => {
    test.beforeEach(async ({ page }) => {
        await resetData();
        await gotoApp(page);
    });

    const submit = async (page) => {
        await fillMainForm(page, { userName: 'Uploader1', email: 'up@example.com', text: 'с вложением', captcha: CAPTCHA });
        await mainForm(page).getByRole('button', { name: 'Отправить' }).click();
        await expect(page.getByText('Комментарий опубликован')).toBeVisible();
    };

    test('картинка: прогресс → «Готово» → в карточке <picture> с webp-вариантами → лайтбокс', async ({ page }) => {
        const s3Puts: string[] = [];
        page.on('request', (r) => r.method() === 'PUT' && r.url().includes('digitaloceanspaces.com') && s3Puts.push(r.url()));

        await mainForm(page).locator('input[type=file]').setInputFiles(fixture('photo.png'));
        await expect(mainForm(page).getByText(/Готово/)).toBeVisible({ timeout: 30_000 });
        expect(s3Puts.length).toBeGreaterThan(0); // байты ушли прямо в хранилище

        await submit(page);
        const card = page.locator('tbody').first();
        const img = card.locator('picture img');
        await expect(img).toBeVisible();
        await expect(card.locator('picture source[type="image/webp"]')).toHaveAttribute('srcset', /webp-small.*160w.*webp-medium.*240w.*webp-original.*320w/);
        await expect.poll(() => img.evaluate((el: HTMLImageElement) => el.currentSrc)).toMatch(/\/webp-(small|medium|original)\/.*\.webp$/);
        await expect(card.getByText('320×213')).toBeVisible();

        await card.getByRole('button', { name: /Открыть изображение/ }).click();
        const dialogImg = page.getByRole('dialog').locator('img');
        await expect(dialogImg).toHaveAttribute('src', /webp-original/);
        await page.keyboard.press('Escape');
        await expect(page.getByRole('dialog')).toHaveCount(0);
    });

    test('txt: открывается в лайтбоксе текстом (CDN + CORS), HTML не исполняется', async ({ page }) => {
        await mainForm(page).locator('input[type=file]').setInputFiles(fixture('note.txt'));
        await expect(mainForm(page).getByText(/Готово/)).toBeVisible({ timeout: 30_000 });
        await submit(page);

        await page.locator('tbody').first().getByRole('button', { name: /note\.txt/ }).click();
        const pre = page.getByRole('dialog').locator('pre');
        await expect(pre).toContainText('Привет из e2e!');
        await expect(pre).toContainText('<script>alert(1)</script>');
    });

    test('видео HEVC 10-бит → конвертация → постер и плеер с playsInline, который реально играет', async ({ page }) => {
        await mainForm(page).locator('input[type=file]').setInputFiles(fixture('clip.mkv'));
        await expect(mainForm(page).getByText(/Готово/)).toBeVisible({ timeout: 90_000 });
        await submit(page);

        const card = page.locator('tbody').first();
        await expect(card.getByText('0:02')).toBeVisible();
        await card.getByRole('button', { name: /Смотреть видео/ }).click();

        const video = page.getByRole('dialog').locator('video');
        await expect(video).toHaveAttribute('playsinline', '');
        await expect.poll(() => video.evaluate((v: HTMLVideoElement) => v.readyState)).toBeGreaterThanOrEqual(2);
        expect(await video.evaluate((v: HTMLVideoElement) => v.canPlayType('video/mp4; codecs="avc1.640028, mp4a.40.2"'))).toBe('probably');
    });

    test('поддельная картинка → ошибка обработки, отправка с ней блокируется', async ({ page }) => {
        await mainForm(page).locator('input[type=file]').setInputFiles(fixture('fake.png'));
        await expect(mainForm(page).getByText('Файл не является корректным изображением JPG, GIF или PNG')).toBeVisible({ timeout: 30_000 });
        await expect(mainForm(page).getByRole('button', { name: 'Повторить' })).toBeVisible();

        await fillMainForm(page, { userName: 'Uploader1', email: 'up@example.com', text: 'x', captcha: CAPTCHA });
        await mainForm(page).getByRole('button', { name: 'Отправить' }).click();
        await expect(page.getByText('Комментарий опубликован')).toHaveCount(0);
    });
});
