// Нагрузочные сценарии против окружения load (1M комментариев):
//   :4200 — штатный бэкенд (список из Meilisearch), :4201 — тот же бэкенд с недоступным Meilisearch (фолбэк на Postgres).
// Результаты печатаются и пишутся в results.json; выводы — в README.md.
import autocannon from 'autocannon';
import { writeFileSync } from 'node:fs';
import { io } from 'socket.io-client';

const MAIN = process.env.LOAD_URL || 'http://localhost:4200';
const FALLBACK = process.env.LOAD_FALLBACK_URL || 'http://localhost:4201';
const DURATION = +(process.env.LOAD_DURATION || 20);
const CAPTCHA = process.env.CAPTCHA_FIXED_TEXT || 'e2e123';
const SORTS = ['createdAt', 'userName', 'email', 'rating'];
const results = {};

const pct = (arr, p) => arr.sort((a, b) => a - b)[Math.min(arr.length - 1, Math.floor((p / 100) * arr.length))];
const rnd = (n) => Math.floor(Math.random() * n);

function summarize(name, r) {
    const row = {
        rps: Math.round(r.requests.average),
        p50_ms: r.latency.p50,
        p97_5_ms: r.latency.p97_5,
        p99_ms: r.latency.p99,
        max_ms: r.latency.max,
        requests: r.requests.total,
        non2xx: r.non2xx,
        errors: r.errors + r.timeouts,
    };
    results[name] = row;
    console.log(`${name.padEnd(42)} ${String(row.rps).padStart(6)} rps  p50 ${row.p50_ms}ms  p97.5 ${row.p97_5_ms}ms  p99 ${row.p99_ms}ms  non2xx ${row.non2xx}  errors ${row.errors}`);
}

const cannon = (opts) => autocannon({ duration: DURATION, connections: 100, ...opts });

// реалистичное распределение: почти все смотрят первые страницы, глубоко листают единицы
const realisticPage = () => {
    const r = Math.random();
    return r < 0.9 ? 1 + rnd(3) : r < 0.99 ? 4 + rnd(47) : 51 + rnd(11950);
};

async function readScenarios(base, label) {
    summarize(`${label}: page 1, LIFO`, await cannon({ url: `${base}/api/v1/comments` }));
    summarize(
        `${label}: realistic mix (90% p1-3, 9% p4-50, 1% deep)`,
        await cannon({
            url: base,
            requests: [{ setupRequest: (req) => ({ ...req, path: `/api/v1/comments?page=${realisticPage()}&sortBy=${SORTS[rnd(4)]}&sortOrder=${rnd(2) ? 'ASC' : 'DESC'}` }) }],
        }),
    );
    summarize(
        `${label}: random page 1..12000 × random sort`,
        await cannon({
            url: base,
            requests: [{ setupRequest: (req) => ({ ...req, path: `/api/v1/comments?page=${1 + rnd(12000)}&sortBy=${SORTS[rnd(4)]}&sortOrder=${rnd(2) ? 'ASC' : 'DESC'}` }) }],
        }),
    );
}

async function captchaToken(base) {
    return (await (await fetch(`${base}/api/v1/captcha`)).json()).token;
}

// Запись: каждый «пользователь» берёт капчу и публикует комментарий (как в браузере)
async function writeScenario(base, concurrency = 25) {
    const latencies = [];
    let ok = 0;
    let failed = 0;
    const deadline = Date.now() + DURATION * 1000;
    const worker = async (w) => {
        for (let i = 0; Date.now() < deadline; i++) {
            const started = performance.now();
            const form = new FormData();
            form.append('userName', `LoadWriter${w}`);
            form.append('email', `writer${w}@load.test`);
            form.append('text', `Нагрузочная запись ${w}-${i} <strong>ok</strong>`);
            form.append('captchaToken', await captchaToken(base));
            form.append('captcha', CAPTCHA);
            const res = await fetch(`${base}/api/v1/comments`, { method: 'POST', body: form });
            await res.arrayBuffer();
            latencies.push(performance.now() - started);
            res.status === 201 ? ok++ : failed++;
        }
    };
    const t0 = Date.now();
    await Promise.all(Array.from({ length: concurrency }, (_, w) => worker(w)));
    const seconds = (Date.now() - t0) / 1000;
    const row = { rps: Math.round(ok / seconds), p50_ms: Math.round(pct(latencies, 50)), p95_ms: Math.round(pct(latencies, 95)), p99_ms: Math.round(pct(latencies, 99)), created: ok, failed };
    results[`write: captcha + POST comment (${concurrency} concurrent)`] = row;
    console.log(`write: captcha + POST (${concurrency} conc)`.padEnd(42), `${String(row.rps).padStart(6)} comments/s  p50 ${row.p50_ms}ms  p95 ${row.p95_ms}ms  p99 ${row.p99_ms}ms  failed ${failed}`);
}

async function voteScenario(base) {
    const uuids = (await (await fetch(`${base}/api/v1/comments?sortBy=rating&sortOrder=DESC`)).json()).items.map((i) => i.uuid);
    const tokens = await Promise.all(Array.from({ length: 300 }, async () => (await (await fetch(`${base}/api/v1/comments/voters`, { method: 'POST' })).json()).token));
    summarize(
        'votes: PUT like/dislike (300 voters × top comments)',
        await cannon({
            url: base,
            connections: 50,
            requests: [
                {
                    method: 'PUT',
                    setupRequest: (req) => ({
                        ...req,
                        path: `/api/v1/comments/${uuids[rnd(uuids.length)]}/vote`,
                        headers: { 'content-type': 'application/json', authorization: `Bearer ${tokens[rnd(tokens.length)]}` },
                        body: JSON.stringify({ value: [1, -1, 0][rnd(3)] }),
                    }),
                },
            ],
        }),
    );
}

// Fan-out: N подключённых клиентов, задержка доставки comment_created от отправки POST до получения
async function websocketScenario(base, clients = 1000, messages = 20) {
    // подключаем пачками по 100, как приходили бы реальные пользователи; неудачные подключения считаем
    const sockets = [];
    let connectFailed = 0;
    for (let batch = 0; batch < clients / 100; batch++) {
        const connected = await Promise.all(
            Array.from({ length: 100 }, () => new Promise((resolve) => {
                const s = io(`${base}/comments`, { transports: ['websocket'], forceNew: true, reconnection: false, timeout: 10_000 });
                s.once('connect', () => resolve(s));
                s.once('connect_error', () => (connectFailed++, s.close(), resolve(null)));
            })),
        );
        sockets.push(...connected.filter(Boolean));
    }
    const delays = [];
    let delivered = 0;
    for (let m = 0; m < messages; m++) {
        const marker = `ws-fanout-${Date.now()}-${m}`;
        const sent = performance.now();
        const received = Promise.all(sockets.map((s) => new Promise((resolve) => {
            const handler = (c) => {
                if (!c.text.includes(marker)) return;
                s.off('comment_created', handler);
                delays.push(performance.now() - sent);
                delivered++;
                resolve();
            };
            s.on('comment_created', handler);
        })));
        const form = new FormData();
        Object.entries({ userName: 'WsLoad', email: 'ws@load.test', text: marker, captchaToken: await captchaToken(base), captcha: CAPTCHA }).forEach(([k, v]) => form.append(k, v));
        await fetch(`${base}/api/v1/comments`, { method: 'POST', body: form });
        await Promise.race([received, new Promise((r) => setTimeout(r, 10_000))]);
    }
    sockets.forEach((s) => s.close());
    const row = { clients, connected: sockets.length, connect_failed: connectFailed, messages, delivered_pct: +((100 * delivered) / (sockets.length * messages)).toFixed(2), p50_ms: Math.round(pct(delays, 50)), p95_ms: Math.round(pct(delays, 95)), p99_ms: Math.round(pct(delays, 99)) };
    results[`websocket fan-out: ${clients} clients × ${messages} comments`] = row;
    console.log(`websocket fan-out ${clients}×${messages}`.padEnd(42), `connected ${sockets.length}/${clients}  delivered ${row.delivered_pct}%  p50 ${row.p50_ms}ms  p95 ${row.p95_ms}ms  p99 ${row.p99_ms}ms (POST → получение)`);
}

const only = process.argv[2];
const run = (name) => !only || only === name;
console.log(`Load test, ${DURATION}s per scenario\n`);
if (run('read')) await readScenarios(MAIN, 'read via Meilisearch');
if (run('fallback')) await readScenarios(FALLBACK, 'read via Postgres (Meili down)');
if (run('write')) await writeScenario(MAIN);
if (run('votes')) await voteScenario(MAIN);
if (run('ws')) await websocketScenario(MAIN);
writeFileSync(new URL(`./results${only ? '-' + only : ''}.json`, import.meta.url), JSON.stringify({ date: new Date().toISOString(), duration_s: DURATION, results }, null, 2));
