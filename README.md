# SPA «Комментарии»

Одностраничное приложение для комментариев с каскадными ответами, вложениями, CAPTCHA и обновлением в реальном времени.

- **back/**: NestJS 11, Sequelize (`sequelize-typescript`) + PostgreSQL, S3 (DigitalOcean Spaces) + CDN для файлов, Meilisearch (read-model списка), Redis (очередь Bull, сессии загрузок, токены капчи), socket.io
- **front/**: Next.js 16 (React 19), клиентское SPA, CSS Modules
- **docs/db-schema.sql**: схема БД для MySQL Workbench
- **docker-compose.yml**: весь стек (postgres, redis, meilisearch, back, front)

## Возможности

| Требование | Реализация |
|---|---|
| Форма: User Name, E-mail, Home page, CAPTCHA, Text | Валидация на клиенте (`front/src/lib/validation.ts`) и на сервере (`class-validator` DTO) |
| CAPTCHA (изображение, латиница и цифры) | SVG-картинка + подписанный JWT с HMAC ответа; токен одноразовый (использованные `jti` хранятся в Redis) |
| Разрешённые теги `<a href title>`, `<code>`, `<i>`, `<strong>`, проверка закрытия, валидный XHTML | Парсер на регулярных выражениях со стеком тегов (`back/src/shared/utils/comment-html.util.ts`), его копия на фронте |
| Панель кнопок `[i] [strong] [code] [a]` | Оборачивает выделенный текст в textarea |
| Предпросмотр без перезагрузки | `POST /comments/preview`: сервер возвращает текст ровно в том виде, в каком он будет сохранён |
| Каскадные ответы любой вложенности | `parent_uuid` + `root_uuid`: вся ветка достаётся одним запросом |
| Таблица заглавных комментариев, сортировка по User Name / E-mail / дате в обе стороны | `<table>`, где каждый комментарий — карточка-`<tbody>`; сортировка выбирается в меню. Поле сортировки принимается только из enum и не подставляется в SQL |
| 25 на страницу, по умолчанию LIFO | `?page=&sortBy=&sortOrder=`, состояние хранится в URL |
| Картинка JPG/GIF/PNG ≤ 320×240 с пропорциональным уменьшением | `sharp`: тип определяется по содержимому, создаются варианты `small` (≤160×120), `medium` (≤240×180), `original` (≤320×240) и WebP-копия каждого (GIF остаётся анимированным и в WebP). Фронт выводит `<picture>` с `srcset`, браузер сам берёт WebP нужного размера под плотность экрана |
| Видео (сверх ТЗ) | MP4, MOV, WEBM, MKV, AVI до 200 МБ и 5 минут, только прямой загрузкой. `ffprobe` проверяет содержимое: уже совместимое с iOS/macOS видео (H.264 8 бит 4:2:0 + AAC в MP4/MOV, ≤ 1280×720) только перепаковывается без потери качества, остальное (HEVC/10 бит, VP9, AV1, WebM/MKV/AVI, большие разрешения) перекодируется в H.264 High + AAC, `yuv420p`, тег `avc1`, `+faststart`. Поворот видео с телефона сохраняется. Постер — кадр в JPG и WebP; в карточке постер с ▶ и длительностью, в лайтбоксе — `<video playsInline>` |
| Хранение файлов | S3 (DigitalOcean Spaces), раздача через CDN. **Прямая multipart-загрузка**: браузер получает подписанные ссылки и кладёт куски по 5 МБ прямо в S3 (с прогрессом и повтором упавших кусков), сервер после `complete` сверяет куски, обрабатывает файл в очереди и отдаёт `uploadId`; комментарий прикрепляет его одноразово. Старый путь (файл в multipart-запросе комментария) тоже работает через S3. Вся работа с файлами — отдельный модуль `back/src/shared/file` |
| TXT ≤ 100 КБ | Проверка размера и бинарного содержимого; отдаётся как `text/plain` + `nosniff` |
| Просмотр файлов с визуальными эффектами | Свой lightbox: затемнение, zoom-in, Esc и клик вне окна закрывают его |
| Защита от XSS | Сохраняется только пересобранный разрешённый XHTML, `href` допускает только http(s), на фронте перед выводом ещё одна проверка |
| Защита от SQL-инъекций | Только параметризованные запросы ORM, нет сырого SQL с пользовательскими данными |
| WebSocket | Namespace `/comments`: события `comment_created`, `comment_file_updated` и `comment_voted` |
| Лайки / дизлайки | Голос без регистрации: сервер выдаёт браузеру JWT со случайным `voterId`, один голос на комментарий, повторный клик снимает голос. Счётчики обновляются у всех по WebSocket |
| Сортировка «Популярные» | По рейтингу `likes − dislikes`, меню сортировки справа над списком |
| Queue / Cache / Events / JWT (Junior+) | Bull (ресайз картинок) / Meilisearch как кеширующий read-model списка / `@nestjs/event-emitter` / JWT капчи и голосующего |
| Meilisearch | Комментарии денормализуются в индекс `comments` по доменным событиям (создание, обработка файла, голос), список и все сортировки читаются из индекса. Если Meilisearch недоступен, данные читаются из Postgres. Пустой индекс заполняется из БД при старте |

Данные для идентификации клиента: `users` (user name, e-mail, home page), а в каждом комментарии хранятся IP и User-Agent.

## Как запустить

### Вариант 1. Docker — всё одной командой (рекомендуется)

Нужен только **Docker с Compose v2**. Ни Node.js, ни ключи от облака не нужны: S3 поднимается локально в LocalStack.

```bash
git clone <repo> && cd <repo>
docker compose up -d --build
```

Первая сборка занимает 3–6 минут. Готовность можно проверить командой `docker compose ps`: все сервисы должны стать `healthy`. После этого открывайте:

| Что | Адрес |
|---|---|
| Приложение | http://localhost:3001 |
| API | http://localhost:4000/api/v1 |
| Документация API (Scalar) | http://localhost:4000/api/docs — описание, примеры запросов/ответов/ошибок, WebSocket-события, «Test Request»; сырой OpenAPI: `/api/docs-json` |
| Meilisearch | http://localhost:7702 |
| S3 (LocalStack) | http://localhost:4566 |

Что запускается:

| Сервис | Образ | Зачем |
|---|---|---|
| `front` | сборка `front/` (Next.js standalone) | интерфейс |
| `back` | сборка `back/` (NestJS + ffmpeg) | API, WebSocket, очередь обработки файлов |
| `postgres` | `postgres:17-alpine` | основная БД |
| `redis` | `redis:7-alpine` | очередь Bull, сессии загрузок, токены капчи |
| `meilisearch` | `getmeili/meilisearch:v1.11` | список комментариев, сортировки (read-model) |
| `s3` | `localstack/localstack:3.8` | S3-хранилище файлов; бакет и CORS создаёт `docker/localstack/init-s3.sh` |

Таблицы создаются сами при первом старте бэкенда, индекс Meilisearch заполняется из БД тоже автоматически.

Полезные команды:

```bash
docker compose ps                    # статус и healthcheck
docker compose logs -f back          # логи бэкенда
docker compose down                  # остановить (данные сохраняются в томах)
docker compose down -v               # остановить и удалить все данные
docker compose up -d --build front   # пересобрать один сервис
```

> LocalStack в бесплатной версии хранит файлы до перезапуска контейнера `s3`. Для демо и проверки этого хватает. Для постоянного хранения подключите настоящий S3 (вариант 3).

Если порт занят, переопределите его в `.env`: `FRONT_HOST_PORT`, `BACK_HOST_PORT`, `POSTGRES_HOST_PORT`, `REDIS_HOST_PORT`, `MEILI_HOST_PORT`, `S3_HOST_PORT` (см. `.env.example`). Если меняете порт API, поменяйте и `API_URL`: он вшивается в сборку фронта.

### Тесты в Docker

```bash
docker compose --profile test run --rm back-test    # unit (405) + e2e (82) бэкенда
docker compose --profile test run --rm front-test   # unit фронтенда (268)
```

`back-test` сам создаёт базу `comments_test` и работает с отдельной Redis DB и отдельным индексом Meilisearch, рабочие данные не трогает. Браузерные e2e (Playwright) и нагрузочные тесты запускаются локально — см. раздел «Тесты» ниже.

### Вариант 2. Локальная разработка (код на хосте, инфраструктура в Docker)

Нужны Node.js 22+ и Docker. Для видео — `ffmpeg`/`ffprobe` с `libx264` (`brew install ffmpeg` / `apt install ffmpeg`; пути можно задать через `FFMPEG_PATH`/`FFPROBE_PATH`).

```bash
docker compose up -d postgres redis meilisearch s3   # инфраструктура: :5434, :6381, :7702, :4566

cd back
cp .env.example .development.env   # по умолчанию S3 = LocalStack, ничего менять не нужно
npm install
npm run start:dev                  # http://localhost:4000, hot reload

cd ../front                        # во втором терминале
cp .env.example .env.local
npm install
npm run dev -- -p 3001             # http://localhost:3001
```

Дозаполнить варианты (small/medium/webp) для картинок, загруженных до их появления: `cd back && npm run script:backfill-images` (`-- --dry-run` — только посчитать).

### Вариант 3. Внешнее S3 (DigitalOcean Spaces, AWS)

Раскомментируйте блок `S3_*` в `.env` (docker) или пропишите те же переменные в `back/.development.env` (локально). В CORS бакета разрешите `PUT`, `GET`, `HEAD` с адреса фронта и откройте заголовок `ETag`, иначе браузер не сможет класть куски файла напрямую. Готовые файлы публичные (`public-read`) и раздаются через `S3_CDN_URL`. Временные объекты лежат под `<S3_FOLDER>/uploads/`; на этот префикс стоит повесить lifecycle-правило: удалять незавершённые multipart-загрузки и объекты старше суток.

### Деплой на сервер

1. Скопируйте `.env.example` в `.env` и задайте публичные адреса: `FRONT_URL` (для CORS) и `API_URL` (вшивается в сборку фронта). Задайте свои секреты `JWT_*`, `MEILI_MASTER_KEY`, `POSTGRES_PASSWORD` и подключите внешнее S3 (вариант 3).
2. `docker compose up -d --build`.
3. Поставьте перед `front` и `back` reverse proxy с HTTPS (nginx, Caddy, Traefik). Бэкенд доверяет `X-Forwarded-For` от локальных и приватных адресов, поэтому IP пользователей в комментариях будут настоящими.
4. `API_DOCS_ENABLED=false`, если Swagger на сервере не нужен.

### Деплой на Laravel Forge (без Docker)

Приложение работает на одном домене. nginx отправляет `/api` и `/socket.io` бэкенду (PM2, порт 4009), всё остальное — фронту (PM2, порт 4008). Готовые конфиги лежат в `deploy/forge/`.

**Один раз на сервере** (по SSH под пользователем `forge`):

1. Node.js ≥ 22.13: проверьте `node -v`; если версия старее — обновите через `nvm install 22` (или `sudo npm i -g n && sudo n 22`).
2. ffmpeg для перекодирования видео: `sudo apt-get update && sudo apt-get install -y ffmpeg`.
3. PostgreSQL: Forge → Databases → создать базу `comments`. Таблицы создаются сами при первом старте.
4. Redis ставится Forge по умолчанию (`127.0.0.1:6379`).
5. Meilisearch как демон:
   ```bash
   mkdir -p ~/bin ~/meili-data && cd ~/bin && curl -L https://install.meilisearch.com | sh
   ```
   Затем Forge → Server → Daemons → New Daemon:
   `/home/forge/bin/meilisearch --env production --master-key <MEILI_MASTER_KEY> --db-path /home/forge/meili-data --http-addr 127.0.0.1:7700`,
   пользователь `forge`. Ключ — не короче 16 символов, тот же, что в env. Без Meilisearch список читается из Postgres.
6. S3-бакет: в CORS разрешите `PUT`, `GET`, `HEAD` с `https://test-task.pp.ua`, откройте заголовок `ETag`.

**В панели сайта:**

1. Environment — заполнить по шаблону `deploy/forge/forge.env.example` (секреты: `openssl rand -hex 32`).
2. Deployments → Deploy script — содержимое `deploy/forge/deploy.sh`.
3. Edit Nginx Configuration — заменить блок от `ssl_protocols` до конца на `deploy/forge/nginx.conf`. Строки `listen`, `server_name` и `ssl_*` оставить как есть.
4. SSL → Let's Encrypt, затем Deploy Now.

Проверка: `pm2 ls` (процессы `site-3464767` и `site-3464767-api` в статусе online), `pm2 logs site-3464767-api`, `https://test-task.pp.ua/api/docs`.

## Тесты

| Вид | Где | Команда | Что внутри |
|---|---|---|---|
| Unit бэкенда | `back/src/**/*.spec.ts` | `cd back && npm test` (`npm run test:cov` — покрытие) | 405 тестов, покрытие 100% строк/веток/функций; внешние сервисы замоканы, `sharp` и `ffmpeg` настоящие |
| Unit фронтенда | `front/src/**/*.test.ts(x)` | `cd front && npm test` (`npm run test:cov`) | 268 тестов (Vitest + Testing Library), покрытие ~99% |
| E2E бэкенда | `back/test/*.e2e-spec.ts` | `cd back && npm run test:e2e` | 82 теста: всё приложение против настоящих Postgres/Redis/Meilisearch, S3 в памяти; капча, валидация, XSS, SQL-инъекции, каскад, пагинация, сортировки, фолбэк на Postgres, файлы и видео, голоса, socket.io |
| E2E в браузере | `e2e/tests/*.spec.ts` | `cd e2e && npm install && npm test` | 22 сценария Playwright (системный Chrome, десктоп + мобильный): форма, редактор, предпросмотр, ответы, сортировка, пагинация, лайки, загрузка в настоящий S3 (картинка, txt, видео), realtime между вкладками, XSS |
| Нагрузочные | `load/` | см. [`load/README.md`](load/README.md) | 1M комментариев: чтение, запись, голоса, WebSocket fan-out, результаты и выводы |

Тесты изолированы от dev-данных: `NODE_ENV=test` → `back/.test.env` (скопируйте из `.test.env.example`) — отдельная БД `comments_test`, Redis DB 1, индекс Meilisearch `test_comments`, фиксированный текст капчи и отключённые лимиты запросов. Две последние настройки работают **только вне production**. Перед деструктивными операциями e2e проверяют, что подключены именно к тестовым ресурсам. Для e2e и нагрузки нужны контейнеры: `docker compose up -d postgres redis meilisearch`.

## API

| Метод | Путь | Описание |
|---|---|---|
| GET | `/api/v1/captcha` | `{ token, image }`: image в виде data URI SVG |
| GET | `/api/v1/comments?page=1&sortBy=createdAt\|userName\|email\|rating&sortOrder=DESC\|ASC` | Страница заглавных комментариев, у каждого массив `replies` (плоский, дерево строится по `parentUuid`) |
| GET | `/api/v1/comments/:uuid` | Один комментарий |
| POST | `/api/v1/comments/preview` | `{ text }` → `{ html }` или ошибка валидации |
| POST | `/api/v1/comments` | `multipart/form-data`: `userName, email, homePage?, text, parentUuid?, captchaToken, captcha` + `uploadId?` (готовая прямая загрузка) **или** `file?` (старый путь) |
| POST | `/api/v1/comments/voters` | `{ token }`: анонимный JWT голосующего |
| PUT | `/api/v1/comments/:uuid/vote` | `Authorization: Bearer <token>`, `{ value: 1 \| -1 \| 0 }` → новые счётчики |
| POST | `/api/v1/comments/votes/my` | `{ uuids }` → `{ [uuid]: 1 \| -1 }`: свои голоса |
| POST | `/api/v1/uploads` | `{ filename, size }` → `{ uploadId, partSize, parts: [{ partNumber, size, url }] }`: подписанные `PUT`-ссылки на куски |
| POST | `/api/v1/uploads/:id/parts` | Подписать ссылки заново (живут час) |
| POST | `/api/v1/uploads/:id/complete` | Все куски в S3: сверить, склеить, поставить на обработку |
| GET | `/api/v1/uploads/:id` | Статус `UPLOADING → PROCESSING → READY \| FAILED` + готовый файл (CDN url) |
| DELETE | `/api/v1/uploads/:id` | Отменить загрузку и удалить объекты |

Ошибки возвращаются в формате `{ status, code, message, errors? }`. `code` — ключ i18n, `message` локализован по `Accept-Language` (en/ru).

## Структура БД

`users` 1—N `comments` (с self-reference: `parent_uuid`, `root_uuid`); `comments` 1—N `comment_votes`; файлы — общая полиморфная таблица `files` (`model_type` + `model_uuid`, у комментария 0..1 файл).
Полное описание с индексами в `docs/db-schema.sql`. Файл открывается в MySQL Workbench через *File → Import → Reverse Engineer MySQL Create Script*.
