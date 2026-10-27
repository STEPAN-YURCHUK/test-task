-- ============================================================================
-- SPA Comments — схема БД
--
-- Рабочая СУБД проекта — PostgreSQL (таблицы создаёт Sequelize из моделей в
-- back/src/**/models/*.model.ts). Этот файл — та же схема в диалекте MySQL,
-- чтобы открыть её в MySQL Workbench:
--   File → Import → Reverse Engineer MySQL Create Script… → выбрать этот файл
--   (или Database → Reverse Engineer, предварительно выполнив скрипт).
-- Соответствие типов: UUID → CHAR(36), TIMESTAMPTZ → DATETIME(3), ENUM → ENUM.
-- Частичный индекс PostgreSQL (WHERE parent_uuid IS NULL) в MySQL не
-- поддерживается — здесь он заменён составным (parent_uuid, created_at).
-- ============================================================================

CREATE SCHEMA IF NOT EXISTS `comments` DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
USE `comments`;

-- Автор комментариев. Клиент идентифицируется парой (email, user_name);
-- повторный комментарий с той же парой переиспользует запись (upsert).
CREATE TABLE `users` (
  `uuid`        CHAR(36)      NOT NULL,
  `user_name`   VARCHAR(50)   NOT NULL COMMENT 'Только латиница и цифры',
  `email`       VARCHAR(255)  NOT NULL COMMENT 'Хранится в нижнем регистре',
  `home_page`   VARCHAR(2048) NULL     COMMENT 'http/https URL',
  `created_at`  DATETIME(3)   NOT NULL,
  `updated_at`  DATETIME(3)   NOT NULL,
  PRIMARY KEY (`uuid`),
  UNIQUE INDEX `users_email_user_name_uq` (`email`, `user_name`),
  INDEX `users_user_name_idx` (`user_name`)
) ENGINE = InnoDB;

-- Комментарии. Дерево ответов хранится списком смежности (parent_uuid) +
-- ссылкой на заглавный комментарий ветки (root_uuid), чтобы одной выборкой
-- получать всю ветку. У заглавных комментариев parent_uuid и root_uuid = NULL.
CREATE TABLE `comments` (
  `uuid`        CHAR(36)     NOT NULL,
  `user_uuid`   CHAR(36)     NOT NULL,
  `parent_uuid` CHAR(36)     NULL COMMENT 'Прямой родитель (NULL — заглавный)',
  `root_uuid`   CHAR(36)     NULL COMMENT 'Заглавный комментарий ветки',
  `text`        TEXT         NOT NULL COMMENT 'Очищенный XHTML: a[href,title], code, i, strong',
  `likes_count`    INT       NOT NULL DEFAULT 0 COMMENT 'Денормализованный счётчик из comment_votes',
  `dislikes_count` INT       NOT NULL DEFAULT 0,
  `rating`         INT       NOT NULL DEFAULT 0 COMMENT 'likes - dislikes, сортировка «Популярные»',
  `ip_address`  VARCHAR(45)  NULL COMMENT 'IP клиента (IPv4/IPv6)',
  `user_agent`  VARCHAR(512) NULL COMMENT 'User-Agent клиента',
  `created_at`  DATETIME(3)  NOT NULL,
  `updated_at`  DATETIME(3)  NOT NULL,
  PRIMARY KEY (`uuid`),
  INDEX `comments_top_level_created_at_idx` (`parent_uuid`, `created_at`),
  INDEX `comments_top_level_rating_idx` (`parent_uuid`, `rating`, `created_at`),
  INDEX `comments_root_uuid_created_at_idx` (`root_uuid`, `created_at`),
  INDEX `comments_user_uuid_idx` (`user_uuid`),
  CONSTRAINT `comments_user_uuid_fk` FOREIGN KEY (`user_uuid`) REFERENCES `users` (`uuid`)
    ON UPDATE CASCADE ON DELETE NO ACTION,
  CONSTRAINT `comments_parent_uuid_fk` FOREIGN KEY (`parent_uuid`) REFERENCES `comments` (`uuid`)
    ON UPDATE CASCADE ON DELETE CASCADE,
  CONSTRAINT `comments_root_uuid_fk` FOREIGN KEY (`root_uuid`) REFERENCES `comments` (`uuid`)
    ON UPDATE CASCADE ON DELETE CASCADE
) ENGINE = InnoDB;

-- Файлы (общая полиморфная таблица): владелец = model_type + model_uuid,
-- model_column — «поле» сущности. Комментарий: model_type='comments', model_column='file'.
-- FK нет (связь полиморфная), целостность держит ClientFileService. Сами файлы — в S3, раздача через CDN.
CREATE TABLE `files` (
  `uuid`          CHAR(36)     NOT NULL,
  `type`          ENUM('IMAGE', 'TEXT', 'VIDEO') NOT NULL,
  `path`          VARCHAR(255) NOT NULL COMMENT 'Ключ объекта в S3 (у картинки — вариант original ≤ 320x240); URL = S3_CDN_URL + path',
  `original_name` VARCHAR(255) NOT NULL,
  `mime_type`     VARCHAR(100) NOT NULL,
  `size`          INT          NOT NULL COMMENT 'Байты (после обработки)',
  `width`         SMALLINT     NULL,
  `height`        SMALLINT     NULL,
  -- варианты картинки: small ≤160x120, medium ≤240x180 + webp-копии всех трёх
  `small_path`         VARCHAR(255) NULL,
  `medium_path`        VARCHAR(255) NULL,
  `webp_small_path`    VARCHAR(255) NULL,
  `webp_medium_path`   VARCHAR(255) NULL,
  `webp_original_path` VARCHAR(255) NULL,
  `small_width`   SMALLINT     NULL,
  `small_height`  SMALLINT     NULL,
  `medium_width`  SMALLINT     NULL,
  `medium_height` SMALLINT     NULL,
  -- видео (сверх ТЗ): H.264/AAC MP4 + постер-кадр в jpg/webp
  `duration`         DECIMAL(10,2) NULL COMMENT 'Секунды',
  `poster_path`      VARCHAR(255) NULL,
  `webp_poster_path` VARCHAR(255) NULL,
  `model_uuid`    CHAR(36)     NOT NULL,
  `model_type`    VARCHAR(50)  NOT NULL,
  `model_column`  VARCHAR(50)  NOT NULL,
  `created_at`    DATETIME(3)  NOT NULL,
  `updated_at`    DATETIME(3)  NOT NULL,
  PRIMARY KEY (`uuid`),
  UNIQUE INDEX `files_path_key` (`path`),
  INDEX `files_model_idx` (`model_type`, `model_uuid`, `model_column`)
) ENGINE = InnoDB;

-- Голоса (лайк / дизлайк). Регистрации нет: voter_id — случайный id из JWT,
-- который сервер выдаёт браузеру (POST /comments/voters). Один голос на пару.
CREATE TABLE `comment_votes` (
  `uuid`          CHAR(36)    NOT NULL,
  `comment_uuid`  CHAR(36)    NOT NULL,
  `voter_id`      CHAR(36)    NOT NULL,
  `value`         SMALLINT    NOT NULL COMMENT '1 — like, -1 — dislike',
  `created_at`    DATETIME(3) NOT NULL,
  `updated_at`    DATETIME(3) NOT NULL,
  PRIMARY KEY (`uuid`),
  UNIQUE INDEX `comment_votes_comment_uuid_voter_id_uq` (`comment_uuid`, `voter_id`),
  INDEX `comment_votes_voter_id_idx` (`voter_id`),
  CONSTRAINT `comment_votes_comment_uuid_fk` FOREIGN KEY (`comment_uuid`) REFERENCES `comments` (`uuid`)
    ON UPDATE CASCADE ON DELETE CASCADE
) ENGINE = InnoDB;
