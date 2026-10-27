// Заливает 1M комментариев в comments_load и переиндексирует Meilisearch (load_comments), замеряя время.
// Требует запущенный бэкенд нагрузочного окружения: cd back && npm run build:e2e && npm run start:load
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

const MEILI = 'http://localhost:7702';
const KEY = process.env.MEILI_MASTER_KEY || 'change-me-meili-master-key';
const meili = (path, init = {}) => fetch(`${MEILI}${path}`, { ...init, headers: { Authorization: `Bearer ${KEY}`, ...init.headers } }).then((r) => r.json());

// база создаётся при первом запуске; таблицы и индексы — Sequelize при старте бэкенда (npm run start:load)
const exists = execFileSync('docker', ['exec', 'test-task-postgres-1', 'psql', '-U', 'comments', '-d', 'postgres', '-tAc', "SELECT 1 FROM pg_database WHERE datname='comments_load'"]).toString().trim();
if (!exists) {
    execFileSync('docker', ['exec', 'test-task-postgres-1', 'psql', '-U', 'comments', '-d', 'postgres', '-c', 'CREATE DATABASE comments_load']);
    console.log('Database comments_load created. Start the load backend once (cd back && npm run start:load) to create tables, then rerun npm run seed.');
    process.exit(0);
}

let t = Date.now();
console.log(execFileSync('docker', ['exec', '-i', 'test-task-postgres-1', 'psql', '-U', 'comments', '-d', 'comments_load', '-v', 'ON_ERROR_STOP=1'], { input: readFileSync(new URL('./seed.sql', import.meta.url)) }).toString());
console.log(`Postgres seed: ${((Date.now() - t) / 1000).toFixed(1)}s`);

// очистка индекса → бэкенд при перезапуске сам переиндексирует пустой индекс; здесь запускаем вручную через тот же механизм
await meili('/indexes/load_comments/documents', { method: 'DELETE' });
console.log('Index cleared. Restart the load backend (it reindexes an empty index on bootstrap), then wait…');
