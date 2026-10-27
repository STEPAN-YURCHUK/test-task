import * as dotenv from 'dotenv';
import { resolve } from 'path';

// E2E всегда в тестовом окружении: своя БД, Redis DB 1, индекс test_comments, фиксированная капча
process.env.NODE_ENV = 'test';
dotenv.config({ path: resolve(__dirname, '../../.test.env'), override: true, quiet: true });

// защита от случайного запуска против dev/prod данных — тесты чистят БД, Redis и индекс
const safe = process.env.POSTGRES_DB?.endsWith('_test') && process.env.REDIS_DB === '1' && !!process.env.MEILI_INDEX_PREFIX;
if (!safe) {
    throw new Error('E2E: refusing to run — .test.env must set POSTGRES_DB=*_test, REDIS_DB=1 and MEILI_INDEX_PREFIX');
}
