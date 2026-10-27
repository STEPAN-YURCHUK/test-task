import { TypeFileEnum } from '../enums/type-file.enum';

const MiB = 1024 * 1024;

export const FILE_UPLOAD_QUEUE = 'file-upload';

// Варианты картинки: small / medium / original + webp-копия каждого.
// original — лимит ТЗ 320x240; меньшие варианты — для превью в карточке и srcset.
export const IMAGE_VARIANTS = [
    { name: 'small', width: 160, height: 120 },
    { name: 'medium', width: 240, height: 180 },
    { name: 'original', width: 320, height: 240 },
] as const;
export const IMAGE_WEBP_QUALITY = 82;
export const IMAGE_SOURCE_MAX_BYTES = 20 * MiB;
export const TEXT_MAX_BYTES = 100 * 1024;

// Видео (сверх ТЗ): приводится к формату, который играет везде, включая iOS/macOS Safari —
// H.264 (8 бит, yuv420p) + AAC в MP4 с faststart. Уже совместимое только перепаковывается.
export const VIDEO_SOURCE_MAX_BYTES = 200 * MiB;
export const VIDEO_MAX_DURATION_SECONDS = 5 * 60;
export const VIDEO_MAX_WIDTH = 1280;
export const VIDEO_MAX_HEIGHT = 720;
export const VIDEO_PROCESS_TIMEOUT_MS = 15 * 60_000;
export const VIDEO_POSTER_MAX_WIDTH = 640;
export const VIDEO_POSTER_MAX_HEIGHT = 360;
// старый путь: файл прямо в multipart-запросе сущности
export const FILE_LEGACY_UPLOAD_LIMIT_BYTES = 5 * MiB;

// формат по содержимому (sharp) → расширение и mime результата
export const IMAGE_FORMATS: Record<string, { ext: string; mimeType: string }> = {
    jpeg: { ext: 'jpg', mimeType: 'image/jpeg' },
    png: { ext: 'png', mimeType: 'image/png' },
    gif: { ext: 'gif', mimeType: 'image/gif' },
};

// минимальный размер куска S3 multipart — 5 МиБ (кроме последнего)
export const UPLOAD_PART_SIZE = 5 * MiB;
export const UPLOAD_URL_TTL_SECONDS = 60 * 60;
export const UPLOAD_SESSION_TTL_SECONDS = 24 * 60 * 60;
export const UPLOAD_CLAIM_LOCK_MS = 30_000;

export const FILE_EXTENSIONS: Record<string, { type: TypeFileEnum; contentType: string; maxSize: number }> = {
    jpg: { type: TypeFileEnum.IMAGE, contentType: 'image/jpeg', maxSize: IMAGE_SOURCE_MAX_BYTES },
    jpeg: { type: TypeFileEnum.IMAGE, contentType: 'image/jpeg', maxSize: IMAGE_SOURCE_MAX_BYTES },
    png: { type: TypeFileEnum.IMAGE, contentType: 'image/png', maxSize: IMAGE_SOURCE_MAX_BYTES },
    gif: { type: TypeFileEnum.IMAGE, contentType: 'image/gif', maxSize: IMAGE_SOURCE_MAX_BYTES },
    txt: { type: TypeFileEnum.TEXT, contentType: 'text/plain', maxSize: TEXT_MAX_BYTES },
    mp4: { type: TypeFileEnum.VIDEO, contentType: 'video/mp4', maxSize: VIDEO_SOURCE_MAX_BYTES },
    m4v: { type: TypeFileEnum.VIDEO, contentType: 'video/mp4', maxSize: VIDEO_SOURCE_MAX_BYTES },
    mov: { type: TypeFileEnum.VIDEO, contentType: 'video/quicktime', maxSize: VIDEO_SOURCE_MAX_BYTES },
    webm: { type: TypeFileEnum.VIDEO, contentType: 'video/webm', maxSize: VIDEO_SOURCE_MAX_BYTES },
    mkv: { type: TypeFileEnum.VIDEO, contentType: 'video/x-matroska', maxSize: VIDEO_SOURCE_MAX_BYTES },
    avi: { type: TypeFileEnum.VIDEO, contentType: 'video/x-msvideo', maxSize: VIDEO_SOURCE_MAX_BYTES },
};
