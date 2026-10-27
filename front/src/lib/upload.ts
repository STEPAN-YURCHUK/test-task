import { api, ApiError } from './api';
import { messages } from './i18n';
import type { UploadStatus } from '@/types/comment';

// Прямая загрузка в S3 (multipart): init → PUT кусков по подписанным ссылкам → complete → ждём обработки.
// Сервер только выдаёт ссылки и потом обрабатывает файл; байты идут из браузера прямо в хранилище.

const PARALLEL_PARTS = 3;
const PART_RETRIES = 3;
const POLL_INTERVAL_MS = 700;
// видео перекодируется на сервере — ждём дольше
const POLL_TIMEOUT_MS = 120_000;
const VIDEO_POLL_TIMEOUT_MS = 15 * 60_000;
const VIDEO_EXT = /\.(mp4|m4v|mov|webm|mkv|avi)$/i;

export type UploadPhase = 'uploading' | 'processing';

type Options = {
  signal: AbortSignal;
  onProgress: (fraction: number) => void;
  onPhase: (phase: UploadPhase) => void;
};

const abortError = () => new DOMException('Aborted', 'AbortError');

// Отмена могла случиться, пока ждали ответа API (init / перевыпуск ссылок): событие abort уже не придёт
function putPart(url: string, body: Blob, signal: AbortSignal, onProgress: (loaded: number) => void): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) return reject(abortError());
    // XHR, а не fetch: только он отдаёт прогресс отправки
    const xhr = new XMLHttpRequest();
    xhr.open('PUT', url);
    xhr.upload.onprogress = (e) => onProgress(e.loaded);
    xhr.onload = () => (xhr.status >= 200 && xhr.status < 300 ? resolve() : reject(new Error(`part_http_${xhr.status}`)));
    xhr.onerror = () => reject(new Error('part_network'));
    xhr.onabort = () => reject(abortError());
    signal.addEventListener('abort', () => xhr.abort(), { once: true });
    xhr.send(body);
  });
}

const sleep = (ms: number, signal: AbortSignal) =>
  new Promise<void>((resolve, reject) => {
    if (signal.aborted) return reject(abortError());
    const timer = setTimeout(resolve, ms);
    signal.addEventListener('abort', () => (clearTimeout(timer), reject(abortError())), { once: true });
  });

export async function uploadFile(file: File, { signal, onProgress, onPhase }: Options): Promise<UploadStatus> {
  let init = await api.initUpload(file.name, file.size);
  const loadedByPart = new Map<number, number>();
  const report = () => onProgress([...loadedByPart.values()].reduce((a, b) => a + b, 0) / file.size);

  onPhase('uploading');
  const queue = [...init.parts];

  const worker = async () => {
    for (let part = queue.shift(); part; part = queue.shift()) {
      const start = (part.partNumber - 1) * init.partSize;
      const blob = file.slice(start, start + part.size);

      // упавший кусок повторяется отдельно; на повторе подписываем ссылки заново (могли истечь)
      for (let attempt = 1; ; attempt++) {
        try {
          await putPart(part.url, blob, signal, (loaded) => {
            loadedByPart.set(part!.partNumber, loaded);
            report();
          });
          loadedByPart.set(part.partNumber, part.size);
          report();
          break;
        } catch (e) {
          if (signal.aborted || attempt >= PART_RETRIES) throw e;
          await sleep(500 * attempt, signal);
          init = await api.refreshUploadParts(init.uploadId);
          const refreshed = init.parts.find((p) => p.partNumber === part!.partNumber);
          if (!refreshed) throw new ApiError(409, 'file_upload_incomplete', messages().file.resumeFailed);
          part = refreshed;
        }
      }
    }
  };

  try {
    if (signal.aborted) throw abortError();
    await Promise.all(Array.from({ length: Math.min(PARALLEL_PARTS, init.parts.length) }, worker));

    if (signal.aborted) throw abortError();
    onPhase('processing');
    let status = await api.completeUpload(init.uploadId);
    const deadline = Date.now() + (VIDEO_EXT.test(file.name) ? VIDEO_POLL_TIMEOUT_MS : POLL_TIMEOUT_MS);
    while (status.status === 'PROCESSING' && Date.now() < deadline) {
      await sleep(VIDEO_EXT.test(file.name) ? 1500 : POLL_INTERVAL_MS, signal);
      status = await api.getUpload(init.uploadId);
    }

    if (status.status !== 'READY') {
      const errors = messages().file.errors;
      throw new ApiError(422, status.error ?? 'file_processing_failed', errors[status.error ?? ''] ?? errors.file_processing_failed);
    }
    return status;
  } catch (e) {
    api.abortUpload(init.uploadId);
    throw e;
  }
}
