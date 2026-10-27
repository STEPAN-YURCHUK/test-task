# Deploy-скрипт для Laravel Forge (Site → Deployments → Deploy script). Копия здесь — для истории изменений.
# Монорепо: back/ (NestJS, порт 4009) и front/ (Next.js, порт 4008) за одним доменом — см. nginx.conf.
# Переменные окружения — вкладка Environment сайта (шаблон: forge.env.example).

$CREATE_RELEASE()

cd $FORGE_RELEASE_DIRECTORY

# Общий env сайта: бэкенд читает back/.production.env (NODE_ENV=production), фронт — front/.env.production
ENV_FILE="$FORGE_RELEASE_DIRECTORY/.env"
[ -f "$ENV_FILE" ] || ENV_FILE="$FORGE_SITE_PATH/.env"
if [ ! -f "$ENV_FILE" ]; then
    echo "Env-файл не найден ($ENV_FILE): заполните вкладку Environment в Forge" >&2
    exit 1
fi
ln -sfn "$ENV_FILE" back/.production.env
ln -sfn "$ENV_FILE" front/.env.production

# Backend
cd back
npm ci
npm run build
cd ..

# Frontend: NEXT_PUBLIC_API_URL вшивается в сборку из front/.env.production
cd front
npm ci
npm run build
cd ..

$ACTIVATE_RELEASE()

# PM2: конфиги перезаписываются при каждом деплое. Если конфиг процесса изменился (cwd, порт и т.п.),
# процесс пересоздаётся — pm2 reload не подхватывает новые cwd/script.
PM2_DIR=/home/forge/.pm2-conf
SITE_DIR=/home/forge/test-task.pp.ua
mkdir -p "$PM2_DIR"

write_pm2_config() {
    local name="$1" content="$2" file="$PM2_DIR/$1.json"
    if [ -f "$file" ] && [ "$(cat "$file")" != "$content" ]; then
        pm2 delete "$name" 2>/dev/null || true
    fi
    printf '%s\n' "$content" > "$file"
}

# Фронт: next start из front/, слушает только localhost — наружу через nginx
write_pm2_config site-3464767 '{
    "name": "site-3464767",
    "cwd": "'"$SITE_DIR"'/current/front",
    "script": "./node_modules/next/dist/bin/next",
    "args": "start --hostname 127.0.0.1 --port 4008",
    "instances": 2,
    "exec_mode": "cluster",
    "env": { "NODE_ENV": "production" }
}'

# Бэкенд: один процесс (fork) — WebSocket без redis-адаптера и воркеры очереди Bull рассчитаны на один экземпляр
write_pm2_config site-3464767-api '{
    "name": "site-3464767-api",
    "cwd": "'"$SITE_DIR"'/current/back",
    "script": "dist/main.js",
    "instances": 1,
    "exec_mode": "fork",
    "kill_timeout": 10000,
    "env": { "NODE_ENV": "production" }
}'

pm2 startOrReload "$PM2_DIR/site-3464767-api.json" --update-env
pm2 startOrReload "$PM2_DIR/site-3464767.json" --update-env
pm2 save
