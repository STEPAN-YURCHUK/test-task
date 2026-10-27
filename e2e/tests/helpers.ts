import { APIRequestContext, expect, Page } from '@playwright/test';
import { execFileSync } from 'child_process';
import { API } from '../playwright.config';

export const CAPTCHA = 'e2e123'; // CAPTCHA_FIXED_TEXT из back/.test.env
const MEILI = 'http://localhost:7702';
const MEILI_KEY = process.env.MEILI_MASTER_KEY || 'change-me-meili-master-key';

const docker = (...args: string[]) => execFileSync('docker', args, { stdio: 'pipe' }).toString();

// Чистит ТОЛЬКО тестовые данные: БД comments_test, Redis DB 1, индекс test_comments
export async function resetData() {
    docker('exec', 'test-task-postgres-1', 'psql', '-U', 'comments', '-d', 'comments_test', '-c', 'TRUNCATE TABLE comment_votes, files, comments, users CASCADE');
    docker('exec', 'test-task-redis-1', 'redis-cli', '-n', '1', 'FLUSHDB');
    const task = await (await fetch(`${MEILI}/indexes/test_comments/documents`, { method: 'DELETE', headers: { Authorization: `Bearer ${MEILI_KEY}` } })).json();
    await waitMeiliTask(task.taskUid);
}

async function waitMeiliTask(uid: number) {
    for (let i = 0; i < 100; i++) {
        const task = await (await fetch(`${MEILI}/tasks/${uid}`, { headers: { Authorization: `Bearer ${MEILI_KEY}` } })).json();
        if (['succeeded', 'failed', 'canceled'].includes(task.status)) return;
        await new Promise((r) => setTimeout(r, 100));
    }
}

// индекс догоняет БД асинхронно — ждём нужное число документов
export async function waitIndexed(count: number) {
    for (let i = 0; i < 100; i++) {
        const stats = await (await fetch(`${MEILI}/indexes/test_comments/stats`, { headers: { Authorization: `Bearer ${MEILI_KEY}` } })).json();
        if (stats.numberOfDocuments === count && !stats.isIndexing) return;
        await new Promise((r) => setTimeout(r, 100));
    }
    throw new Error(`index did not reach ${count} docs`);
}

type Fields = { userName?: string; email?: string; text?: string; parentUuid?: string; homePage?: string };

export async function seedComment(request: APIRequestContext, fields: Fields = {}) {
    const { token } = await (await request.get(`${API}/captcha`)).json();
    const res = await request.post(`${API}/comments`, {
        multipart: {
            userName: fields.userName ?? 'Seed1',
            email: fields.email ?? 'seed@example.com',
            text: fields.text ?? 'seeded comment',
            captchaToken: token,
            captcha: CAPTCHA,
            ...(fields.parentUuid ? { parentUuid: fields.parentUuid } : {}),
            ...(fields.homePage ? { homePage: fields.homePage } : {}),
        },
    });
    expect(res.status(), await res.text()).toBe(201);
    return res.json();
}

// форма «Новый комментарий» (не формы ответов)
export const mainForm = (page: Page) => page.locator('section', { has: page.getByRole('heading', { name: 'Новый комментарий' }) });

export async function fillMainForm(page: Page, fields: { userName?: string; email?: string; homePage?: string; text?: string; captcha?: string }) {
    const form = mainForm(page);
    if (fields.userName !== undefined) await form.getByPlaceholder('JohnDoe').fill(fields.userName);
    if (fields.email !== undefined) await form.getByPlaceholder('john@example.com').fill(fields.email);
    if (fields.homePage !== undefined) await form.getByPlaceholder('https://example.com').fill(fields.homePage);
    if (fields.text !== undefined) await form.getByPlaceholder('Напишите комментарий…').fill(fields.text);
    if (fields.captcha !== undefined) await form.getByPlaceholder('Текст с картинки').fill(fields.captcha);
}

// После гидратации: картинка капчи загружается эффектом — значит React уже управляет формой
export async function gotoApp(page: Page, path = '/') {
    await page.goto(path);
    await expect(mainForm(page).getByAltText('CAPTCHA')).toBeVisible();
}
