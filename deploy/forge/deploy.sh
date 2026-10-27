# Deploy-скрипт для Laravel Forge (Site → Deployments → Deploy script). Копия здесь — для истории изменений.
# Макросы Forge (создание и активация релиза) встречаются в файле ровно по одному разу — Forge подставляет только первое
# вхождение, поэтому их нельзя упоминать в комментариях.
# Всё приложение — в Docker: postgres, redis, meilisearch, storage (S3), back, front (docker-compose.yml + docker-compose.prod.yml).
# nginx Forge проксирует на контейнеры: фронт 127.0.0.1:4008, API и WebSocket 127.0.0.1:4009, файлы 127.0.0.1:4010 (см. nginx.conf).
# Файлы — в локальном S3 (SeaweedFS) в том же compose. Переменные — вкладка Environment сайта (шаблон: forge.env.example).
# Пароли и ключи генерируются сами при первом деплое — заполнять их не нужно.

$CREATE_RELEASE()

cd $FORGE_RELEASE_DIRECTORY

fail() { echo "ОШИБКА: $*" >&2; exit 1; }

command -v docker >/dev/null 2>&1 || fail "Docker не установлен: curl -fsSL https://get.docker.com | sudo sh"
docker info >/dev/null 2>&1 || fail "у пользователя $(whoami) нет доступа к Docker: sudo usermod -aG docker $(whoami), затем перезапустить сервер или сессию"
COMPOSE_VERSION=$(docker compose version --short 2>/dev/null | sed 's/^v//')
[ -n "$COMPOSE_VERSION" ] || fail "нет плагина docker compose: sudo apt-get install -y docker-compose-plugin"
printf '%s\n2.24.0\n' "$COMPOSE_VERSION" | sort -V -C 2>/dev/null && [ "$COMPOSE_VERSION" != "2.24.0" ] \
    && fail "нужен Docker Compose ≥ 2.24, установлен $COMPOSE_VERSION: sudo apt-get install -y docker-compose-plugin"

# Корень сайта (/home/forge/<домен>) — где лежат releases/ и current. Секреты храним там, а не в current/:
# current — ссылка на релиз, после активации она указывает на новую папку без файла
case "$FORGE_RELEASE_DIRECTORY" in
    */releases/*) SITE_ROOT="${FORGE_RELEASE_DIRECTORY%%/releases/*}" ;;
    *) SITE_ROOT="${FORGE_SITE_PATH%/}"; SITE_ROOT="${SITE_ROOT%/current}" ;;
esac
[ -d "$SITE_ROOT" ] || fail "не удалось определить папку сайта ($SITE_ROOT)"
echo "Папка сайта: $SITE_ROOT"

# Env сайта из вкладки Environment (Forge линкует его в релиз)
ENV_FILE="$FORGE_RELEASE_DIRECTORY/.env"
[ -f "$ENV_FILE" ] || ENV_FILE="$SITE_ROOT/.env"
[ -f "$ENV_FILE" ] || fail "env-файл не найден: заполните вкладку Environment в Forge"

# Секреты создаются один раз и хранятся вне релизов: пароли Postgres и хранилища должны совпадать с уже созданными данными.
# Недостающие дописываются. Значение, заданное в Environment, важнее сгенерированного (--env-file подключается позже)
SECRETS_FILE="$SITE_ROOT/.docker-secrets.env"
ensure_secret() {
    grep -q "^$1=" "$SECRETS_FILE" 2>/dev/null && return
    (umask 077; echo "$1=$(openssl rand -hex "$2")" >> "$SECRETS_FILE")
    echo "Сгенерирован $1 → $SECRETS_FILE"
}
ensure_secret POSTGRES_PASSWORD 24
ensure_secret JWT_CAPTCHA_SECRET 32
ensure_secret JWT_VOTER_SECRET 32
ensure_secret MEILI_MASTER_KEY 32
ensure_secret S3_ACCESS_KEY_ID 10
ensure_secret S3_SECRET_ACCESS_KEY 32

# Имя проекта фиксировано: каждый релиз в своей папке, а контейнеры и тома (данные БД) — одни и те же
compose() {
    docker compose -p test-task --env-file "$SECRETS_FILE" --env-file "$ENV_FILE" -f docker-compose.yml -f docker-compose.prod.yml "$@"
}

# Образы собираются до переключения релиза: при ошибке сборки продолжает работать прежняя версия
compose build

$ACTIVATE_RELEASE()

# Остатки запуска через PM2 (если сайт раньше деплоился без Docker) заняли бы порты 4008/4009
if command -v pm2 >/dev/null 2>&1; then
    pm2 delete site-3464767 site-3464767-api >/dev/null 2>&1 && pm2 save --force >/dev/null 2>&1 || true
fi

# Пересоздаются только изменившиеся контейнеры; --wait — деплой падает, если сервис не стал healthy
compose up -d --remove-orphans --wait --wait-timeout 300 || { compose ps; compose logs --tail 80 back; fail "сервисы не поднялись"; }

compose ps

# старые образы после пересборки
docker image prune -f >/dev/null
