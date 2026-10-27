-- 100 000 пользователей и 1 000 000 комментариев (300 000 заглавных + 700 000 ответов) за последние 30 дней.
-- Запускается против comments_load (см. seed.mjs). Индексы создал Sequelize при старте бэкенда.
\timing on
BEGIN;
TRUNCATE comment_votes, files, comments, users CASCADE;

INSERT INTO users (uuid, user_name, email, home_page, created_at, updated_at)
SELECT gen_random_uuid(),
       initcap(substr(md5(i::text), 1, 6)) || i,
       substr(md5((i * 7)::text), 1, 8) || i || '@load.test',
       CASE WHEN i % 5 = 0 THEN 'https://user' || i || '.example' END,
       now(), now()
FROM generate_series(1, 100000) AS i;

CREATE TEMP TABLE u AS SELECT row_number() OVER () AS n, uuid FROM users;
CREATE INDEX ON u (n);

CREATE TEMP TABLE top AS
SELECT row_number() OVER () AS n, gen_random_uuid() AS uuid,
       (SELECT uuid FROM u WHERE u.n = 1 + (g::bigint * 7919) % 100000) AS user_uuid,
       now() - (random() * interval '30 days') AS created_at,
       (random() * 60)::int AS likes, (random() * 15)::int AS dislikes
FROM generate_series(1, 300000) AS g;
CREATE INDEX ON top (n);

INSERT INTO comments (uuid, user_uuid, parent_uuid, root_uuid, text, likes_count, dislikes_count, rating, ip_address, user_agent, created_at, updated_at)
SELECT uuid, user_uuid, NULL, NULL,
       'Нагрузочный комментарий #' || n || ' с <strong>разметкой</strong> и <code>кодом</code>',
       likes, dislikes, likes - dislikes, '10.0.0.1', 'load-seed', created_at, created_at
FROM top;

INSERT INTO comments (uuid, user_uuid, parent_uuid, root_uuid, text, likes_count, dislikes_count, rating, ip_address, user_agent, created_at, updated_at)
SELECT gen_random_uuid(), (SELECT uuid FROM u WHERE u.n = 1 + (g::bigint * 104729) % 100000), t.uuid, t.uuid,
       'Ответ #' || g || ' на <i>комментарий</i> ' || t.n,
       0, 0, 0, '10.0.0.2', 'load-seed', t.created_at + (random() * interval '2 days'), now()
FROM generate_series(1, 700000) AS g
JOIN top t ON t.n = 1 + (g::bigint * 31337) % 300000;

COMMIT;
ANALYZE users; ANALYZE comments;
SELECT count(*) AS comments, count(*) FILTER (WHERE parent_uuid IS NULL) AS top_level, (SELECT count(*) FROM users) AS users FROM comments;
