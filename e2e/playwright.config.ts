import { defineConfig, devices } from '@playwright/test';

export const API = 'http://localhost:4100/api/v1';
export const APP = 'http://localhost:3101';

// Изолированный стек: back :4100 (NODE_ENV=test → .test.env: БД comments_test, Redis DB 1, индекс test_comments,
// фиксированная капча, настоящий S3 в папке comments/e2e) + front :3101, собранный против :4100.
// Postgres/Redis/Meilisearch — контейнеры из docker compose (docker compose up -d postgres redis meilisearch).
export default defineConfig({
    testDir: './tests',
    fullyParallel: false,
    workers: 1, // общая тестовая БД
    retries: 0,
    timeout: 60_000,
    expect: { timeout: 10_000 },
    reporter: [['list'], ['html', { open: 'never' }]],
    use: {
        baseURL: APP,
        channel: 'chrome', // системный Chrome, без скачивания браузеров
        trace: 'retain-on-failure',
        screenshot: 'only-on-failure',
        locale: 'ru-RU',
    },
    projects: [
        { name: 'desktop', use: { ...devices['Desktop Chrome'], channel: 'chrome' } },
        { name: 'mobile', use: { ...devices['Pixel 7'], channel: 'chrome' }, testMatch: /responsive\.spec\.ts/ },
    ],
    webServer: [
        {
            command: 'npm --prefix ../back run build:e2e && npm --prefix ../back run start:e2e',
            url: `${API}/captcha`,
            timeout: 180_000,
            reuseExistingServer: true,
        },
        {
            command: 'cd ../front && NEXT_DIST_DIR=.next-e2e NEXT_PUBLIC_API_URL=http://localhost:4100 npx next build && NEXT_DIST_DIR=.next-e2e npx next start -p 3101',
            url: APP,
            timeout: 300_000,
            reuseExistingServer: true,
        },
    ],
});
