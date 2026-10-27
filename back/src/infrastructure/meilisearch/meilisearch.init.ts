import { Logger } from '@nestjs/common';
import { MeiliSearch, Settings } from 'meilisearch';
import { MeiliIndexEnum } from './enums/meili-index.enum';

const PRIMARY_KEY = 'uuid';

// Задачи Meilisearch асинхронные: ждём применения настроек, иначе первые запросы после старта
// получат invalid_search_sort / invalid_search_filter
const WAIT_OPTIONS = { timeout: 120000, interval: 200 };

const INDEX_SETTINGS: Record<MeiliIndexEnum, Settings> = {
    // Один документ на комментарий (и заглавный, и ответ). Список = filter isRoot + sort,
    // ответы ветки = filter rootUuid IN [...]
    [MeiliIndexEnum.COMMENT]: {
        searchableAttributes: ['text', 'user.userName', 'user.email'],
        // userUuid — найти документы автора, когда у него меняется Home page
        filterableAttributes: ['isRoot', 'rootUuid', 'userUuid'],
        sortableAttributes: ['createdAtTs', 'userNameSort', 'emailSort', 'rating'],
        // по умолчанию Meilisearch не отдаёт дальше 1000 результатов — с ним не долистать до старых страниц
        pagination: { maxTotalHits: 1_000_000 },
    },
};

// MEILI_INDEX_PREFIX разделяет индексы окружений в одном Meilisearch (тесты пишут в test_comments)
export const meiliIndexUid = (index: MeiliIndexEnum) => `${process.env.MEILI_INDEX_PREFIX ?? ''}${index}`;

export async function initMeili(meili: MeiliSearch) {
    const logger = new Logger('MeiliSearchInit');

    for (const index of Object.values(MeiliIndexEnum)) {
        try {
            await reconfigureMeiliIndex(meili, index);
            logger.log(`✅ MeiliSearch index ${index} configured`);
        } catch (err) {
            // не роняем приложение: без Meilisearch список читается из Postgres
            logger.error(`❌ MeiliSearch index ${index} was not configured: ${err?.message ?? err}`);
        }
    }
}

export async function reconfigureMeiliIndex(meili: MeiliSearch, index: MeiliIndexEnum) {
    const uid = meiliIndexUid(index);
    await ensureIndex(meili, uid);
    await waitSucceeded(meili.index(uid).updateSettings(INDEX_SETTINGS[index]).waitTask(WAIT_OPTIONS), `settings ${uid}`);
}

async function ensureIndex(meili: MeiliSearch, uid: string) {
    try {
        const { primaryKey } = await meili.getIndex(uid);
        if (primaryKey === PRIMARY_KEY) return;
        await waitSucceeded(meili.deleteIndex(uid).waitTask(WAIT_OPTIONS), `delete ${uid}`);
    } catch {
        // индекса нет — создаём ниже
    }
    await waitSucceeded(meili.createIndex(uid, { primaryKey: PRIMARY_KEY }).waitTask(WAIT_OPTIONS), `create ${uid}`);
}

async function waitSucceeded(taskPromise: Promise<{ uid: number; status: string; error?: { message?: string } | null }>, label: string) {
    const task = await taskPromise;
    if (task.status !== 'succeeded') {
        throw new Error(`${label} task ${task.uid} ${task.status}: ${task.error?.message ?? 'unknown error'}`);
    }
}
