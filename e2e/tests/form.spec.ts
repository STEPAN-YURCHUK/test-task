import { expect, test } from '@playwright/test';
import { CAPTCHA, fillMainForm, gotoApp, mainForm, resetData } from './helpers';

test.describe('Форма комментария', () => {
    test.beforeEach(async ({ page }) => {
        await resetData();
        await gotoApp(page);
    });

    test('страница загружается: заголовок, форма, пустой список, Live', async ({ page }) => {
        await expect(page.getByRole('heading', { name: 'Комментарии', level: 1 })).toBeVisible();
        await expect(page.getByText('Комментариев пока нет — станьте первым.')).toBeVisible();
        await expect(page.getByText('Live')).toBeVisible();
        await expect(mainForm(page).getByAltText('CAPTCHA')).toBeVisible();
    });

    test('клиентская валидация всех обязательных полей', async ({ page }) => {
        await mainForm(page).getByRole('button', { name: 'Отправить' }).click();
        await expect(mainForm(page).getByText('Обязательное поле')).toHaveCount(4);

        await fillMainForm(page, { userName: 'Иван Петров', email: 'bad@', homePage: 'ftp://x', text: '<b>x</b>', captcha: 'абв' });
        await mainForm(page).getByRole('button', { name: 'Отправить' }).click();

        const form = mainForm(page);
        await expect(form.getByText('Только латинские буквы и цифры')).toHaveCount(2);
        await expect(form.getByText('Неверный формат e-mail')).toBeVisible();
        await expect(form.getByText('Неверный формат URL (http/https)')).toBeVisible();
        await expect(form.getByText(/Тег запрещён/)).toBeVisible();
    });

    test('панель тегов оборачивает выделение, ссылка вставляется через панель', async ({ page }) => {
        const textarea = mainForm(page).getByPlaceholder('Напишите комментарий…');
        await textarea.fill('hello world');
        await textarea.evaluate((el: HTMLTextAreaElement) => el.setSelectionRange(6, 11));
        await mainForm(page).getByRole('button', { name: 'Жирный <strong>' }).click();
        await expect(textarea).toHaveValue('hello <strong>world</strong>');

        // редактор восстанавливает выделение в следующем кадре — выделяем своё уже после него
        await textarea.evaluate((el: HTMLTextAreaElement) => new Promise((r) => requestAnimationFrame(() => r(el.setSelectionRange(0, 5)))));
        await mainForm(page).getByRole('button', { name: 'Ссылка <a href title>' }).click();
        await page.getByLabel('Адрес ссылки').fill('https://example.com');
        await page.getByLabel('Заголовок ссылки').fill('Пример');
        await page.getByRole('button', { name: 'Вставить' }).click();
        await expect(textarea).toHaveValue('<a href="https://example.com" title="Пример">hello</a> <strong>world</strong>');
    });

    test('горячие клавиши Ctrl/⌘+I оборачивают в <i>', async ({ page }) => {
        const textarea = mainForm(page).getByPlaceholder('Напишите комментарий…');
        await textarea.fill('abc');
        await textarea.evaluate((el: HTMLTextAreaElement) => el.setSelectionRange(0, 3));
        await textarea.press('ControlOrMeta+i');
        await expect(textarea).toHaveValue('<i>abc</i>');
    });

    test('предпросмотр без перезагрузки показывает серверный рендер и ошибки', async ({ page }) => {
        await fillMainForm(page, { text: 'a < b <code>x</code>' });
        await mainForm(page).getByRole('button', { name: 'Предпросмотр' }).click();
        // <code> в форме есть только в отрендеренном предпросмотре (в textarea это текст)
        const rendered = mainForm(page).locator('code');
        await expect(rendered).toHaveText('x');
        await expect(rendered.locator('..')).toContainText('a < b');

        await fillMainForm(page, { text: '<i>не закрыт' });
        await expect(mainForm(page).getByText(/Тег не закрыт/)).toBeVisible();
    });

    test('публикация: комментарий появляется сверху, капча обновляется, профиль запоминается', async ({ page }) => {
        const captchaBefore = await mainForm(page).getByAltText('CAPTCHA').getAttribute('src');
        await fillMainForm(page, { userName: 'Browser1', email: 'browser@example.com', homePage: 'https://browser.dev', text: 'Первый <strong>комментарий</strong>', captcha: CAPTCHA });
        await mainForm(page).getByRole('button', { name: 'Отправить' }).click();

        await expect(page.getByText('Комментарий опубликован')).toBeVisible();
        const card = page.locator('tbody').first();
        await expect(card.getByText('Browser1')).toBeVisible();
        await expect(card.locator('strong', { hasText: 'комментарий' })).toBeVisible();
        await expect(card.getByRole('link', { name: /browser\.dev/ })).toHaveAttribute('href', 'https://browser.dev');
        await expect(mainForm(page).getByAltText('CAPTCHA')).not.toHaveAttribute('src', captchaBefore);

        await page.reload();
        await expect(mainForm(page).getByPlaceholder('JohnDoe')).toHaveValue('Browser1');
    });

    test('неверная капча → ошибка у поля и новая картинка', async ({ page }) => {
        await fillMainForm(page, { userName: 'Cap1', email: 'cap@example.com', text: 'x', captcha: 'wrong1' });
        await mainForm(page).getByRole('button', { name: 'Отправить' }).click();
        await expect(mainForm(page).getByText('Неверная CAPTCHA')).toBeVisible();
        await expect(mainForm(page).getByPlaceholder('Текст с картинки')).toHaveValue('');
    });
});
