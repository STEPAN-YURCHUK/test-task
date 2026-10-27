import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from 'vitest';
import type { UploadInit, UploadStatus } from '@/types/comment';
import { api, ApiError } from './api';
import { uploadFile } from './upload';

// Управляемый XHR: тест сам решает, когда кусок «долетел», упал или прервался
class FakeXHR {
  static instances: FakeXHR[] = [];
  method = '';
  url = '';
  body: Blob | null = null;
  status = 0;
  upload: { onprogress: ((e: { loaded: number }) => void) | null } = { onprogress: null };
  onload: (() => void) | null = null;
  onerror: (() => void) | null = null;
  onabort: (() => void) | null = null;
  aborted = false;

  open(method: string, url: string) {
    this.method = method;
    this.url = url;
  }
  send(body: Blob) {
    this.body = body;
    FakeXHR.instances.push(this);
  }
  abort() {
    this.aborted = true;
    this.onabort?.();
  }
  progress(loaded: number) {
    this.upload.onprogress?.({ loaded });
  }
  succeed() {
    this.status = 200;
    this.onload?.();
  }
  respond(status: number) {
    this.status = status;
    this.onload?.();
  }
  fail() {
    this.onerror?.();
  }
}

const flush = () => vi.advanceTimersByTimeAsync(0);

const makeInit = (sizes: number[], partSize = 5, uploadId = 'u1', urlPrefix = 'https://s3/part'): UploadInit => ({
  uploadId,
  partSize,
  expiresIn: 3600,
  parts: sizes.map((size, i) => ({ partNumber: i + 1, size, url: `${urlPrefix}${i + 1}` })),
});

const status = (s: UploadStatus['status'], error: string | null = null): UploadStatus => ({
  uploadId: 'u1',
  status: s,
  error,
  file: s === 'READY' ? { type: 'IMAGE', url: 'https://cdn/x.png', originalName: 'x.png', mimeType: 'image/png', size: 1, width: 1, height: 1 } : null,
});

const fileOf = (size: number, name = 'photo.png') => new File([new Uint8Array(size)], name);

let controller: AbortController;
let onProgress: Mock<(fraction: number) => void>;
let onPhase: Mock<(phase: 'uploading' | 'processing') => void>;
let abortUpload: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  vi.useFakeTimers();
  FakeXHR.instances = [];
  vi.stubGlobal('XMLHttpRequest', FakeXHR);
  controller = new AbortController();
  onProgress = vi.fn<(fraction: number) => void>();
  onPhase = vi.fn<(phase: 'uploading' | 'processing') => void>();
  abortUpload = vi.spyOn(api, 'abortUpload').mockResolvedValue(undefined);
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

const start = (file: File) => uploadFile(file, { signal: controller.signal, onProgress, onPhase });

describe('uploadFile', () => {
  it('куски уходят параллельно (до 3), с прогрессом, затем complete → READY', async () => {
    vi.spyOn(api, 'initUpload').mockResolvedValue(makeInit([5, 5, 2]));
    const complete = vi.spyOn(api, 'completeUpload').mockResolvedValue(status('READY'));

    const promise = start(fileOf(12));
    await flush();

    expect(FakeXHR.instances).toHaveLength(3);
    expect(FakeXHR.instances.map((x) => [x.method, x.url, x.body?.size])).toEqual([
      ['PUT', 'https://s3/part1', 5],
      ['PUT', 'https://s3/part2', 5],
      ['PUT', 'https://s3/part3', 2],
    ]);
    expect(onPhase).toHaveBeenCalledWith('uploading');

    FakeXHR.instances[0].progress(3);
    expect(onProgress).toHaveBeenLastCalledWith(3 / 12);

    FakeXHR.instances.forEach((x) => x.succeed());
    await expect(promise).resolves.toMatchObject({ status: 'READY' });

    expect(onProgress).toHaveBeenLastCalledWith(1);
    expect(onPhase).toHaveBeenLastCalledWith('processing');
    expect(complete).toHaveBeenCalledWith('u1');
    expect(abortUpload).not.toHaveBeenCalled();
  });

  it('4-й кусок ждёт освобождения одного из трёх воркеров', async () => {
    vi.spyOn(api, 'initUpload').mockResolvedValue(makeInit([5, 5, 5, 1]));
    vi.spyOn(api, 'completeUpload').mockResolvedValue(status('READY'));

    const promise = start(fileOf(16));
    await flush();
    expect(FakeXHR.instances).toHaveLength(3);

    FakeXHR.instances[1].succeed();
    await flush();
    expect(FakeXHR.instances).toHaveLength(4);
    expect(FakeXHR.instances[3].url).toBe('https://s3/part4');

    [0, 2, 3].forEach((i) => FakeXHR.instances[i].succeed());
    await expect(promise).resolves.toMatchObject({ status: 'READY' });
  });

  it('упавший кусок повторяется с новой подписанной ссылкой', async () => {
    vi.spyOn(api, 'initUpload').mockResolvedValue(makeInit([3]));
    const refresh = vi.spyOn(api, 'refreshUploadParts').mockResolvedValue(makeInit([3], 5, 'u1', 'https://s3/fresh'));
    vi.spyOn(api, 'completeUpload').mockResolvedValue(status('READY'));

    const promise = start(fileOf(3));
    await flush();
    FakeXHR.instances[0].respond(403);
    await flush();
    expect(refresh).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(500);
    expect(refresh).toHaveBeenCalledWith('u1');
    expect(FakeXHR.instances).toHaveLength(2);
    expect(FakeXHR.instances[1].url).toBe('https://s3/fresh1');

    FakeXHR.instances[1].succeed();
    await expect(promise).resolves.toMatchObject({ status: 'READY' });
  });

  it('если переподписанные ссылки не содержат упавший кусок — понятная ошибка, а не TypeError', async () => {
    vi.spyOn(api, 'initUpload').mockResolvedValue(makeInit([3]));
    vi.spyOn(api, 'refreshUploadParts').mockResolvedValue({ ...makeInit([3]), parts: [] });

    const promise = start(fileOf(3));
    const settled = promise.catch((e) => e);
    await flush();
    FakeXHR.instances[0].fail();
    await vi.advanceTimersByTimeAsync(500);

    const error = await settled;
    expect(error).toBeInstanceOf(ApiError);
    expect(error).toMatchObject({ code: 'file_upload_incomplete', message: 'Не удалось продолжить загрузку, выберите файл заново' });
    expect(abortUpload).toHaveBeenCalledWith('u1');
  });

  it('после 3 неудачных попыток — ошибка и отмена загрузки на сервере', async () => {
    vi.spyOn(api, 'initUpload').mockResolvedValue(makeInit([3]));
    vi.spyOn(api, 'refreshUploadParts').mockResolvedValue(makeInit([3]));

    const promise = start(fileOf(3));
    const settled = promise.catch((e) => e);
    await flush();
    FakeXHR.instances[0].fail();
    await vi.advanceTimersByTimeAsync(500);
    FakeXHR.instances[1].fail();
    await vi.advanceTimersByTimeAsync(1000);
    FakeXHR.instances[2].fail();

    expect(await settled).toMatchObject({ message: 'part_network' });
    expect(FakeXHR.instances).toHaveLength(3);
    expect(abortUpload).toHaveBeenCalledWith('u1');
  });

  it('abort во время загрузки куска — без повторов, AbortError, отмена на сервере', async () => {
    vi.spyOn(api, 'initUpload').mockResolvedValue(makeInit([3]));
    const refresh = vi.spyOn(api, 'refreshUploadParts');

    const settled = start(fileOf(3)).catch((e) => e);
    await flush();
    controller.abort();

    expect(await settled).toMatchObject({ name: 'AbortError' });
    expect(FakeXHR.instances[0].aborted).toBe(true);
    expect(refresh).not.toHaveBeenCalled();
    expect(abortUpload).toHaveBeenCalledWith('u1');
  });

  it('отмена, пока ждали init: куски не отправляются, загрузка отменяется на сервере', async () => {
    let resolveInit!: (value: ReturnType<typeof makeInit>) => void;
    vi.spyOn(api, 'initUpload').mockReturnValue(new Promise((r) => (resolveInit = r)));
    const complete = vi.spyOn(api, 'completeUpload');

    const settled = start(fileOf(3)).catch((e) => e);
    controller.abort();
    resolveInit(makeInit([3]));

    expect(await settled).toMatchObject({ name: 'AbortError' });
    expect(FakeXHR.instances).toHaveLength(0);
    expect(complete).not.toHaveBeenCalled();
    expect(abortUpload).toHaveBeenCalledWith('u1');
  });

  it('отмена, пока перевыпускали ссылки после ошибки куска: повтор не отправляется', async () => {
    vi.spyOn(api, 'initUpload').mockResolvedValue(makeInit([3]));
    let resolveRefresh!: (value: ReturnType<typeof makeInit>) => void;
    vi.spyOn(api, 'refreshUploadParts').mockReturnValue(new Promise((r) => (resolveRefresh = r)));

    const settled = start(fileOf(3)).catch((e) => e);
    await flush();
    FakeXHR.instances[0].fail();
    await vi.advanceTimersByTimeAsync(500);
    controller.abort();
    resolveRefresh(makeInit([3]));

    expect(await settled).toMatchObject({ name: 'AbortError' });
    expect(FakeXHR.instances).toHaveLength(1);
    expect(abortUpload).toHaveBeenCalledWith('u1');
  });

  it('отмена до вызова sleep: поллинг сразу прерывается', async () => {
    vi.spyOn(api, 'initUpload').mockResolvedValue(makeInit([3]));
    vi.spyOn(api, 'completeUpload').mockImplementation(async () => {
      controller.abort();
      return status('PROCESSING');
    });
    const getUpload = vi.spyOn(api, 'getUpload');

    const settled = start(fileOf(3)).catch((e) => e);
    await flush();
    FakeXHR.instances[0].succeed();

    expect(await settled).toMatchObject({ name: 'AbortError' });
    expect(getUpload).not.toHaveBeenCalled();
  });

  it('PROCESSING → поллинг каждые 700 мс до READY', async () => {
    vi.spyOn(api, 'initUpload').mockResolvedValue(makeInit([1]));
    vi.spyOn(api, 'completeUpload').mockResolvedValue(status('PROCESSING'));
    const get = vi.spyOn(api, 'getUpload').mockResolvedValueOnce(status('PROCESSING')).mockResolvedValueOnce(status('READY'));

    const promise = start(fileOf(1));
    await flush();
    FakeXHR.instances[0].succeed();
    await flush();

    await vi.advanceTimersByTimeAsync(699);
    expect(get).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(get).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(700);

    await expect(promise).resolves.toMatchObject({ status: 'READY' });
    expect(get).toHaveBeenCalledTimes(2);
  });

  it('видео опрашивается реже — раз в 1.5 с', async () => {
    vi.spyOn(api, 'initUpload').mockResolvedValue(makeInit([1]));
    vi.spyOn(api, 'completeUpload').mockResolvedValue(status('PROCESSING'));
    const get = vi.spyOn(api, 'getUpload').mockResolvedValue(status('READY'));

    const promise = start(fileOf(1, 'clip.MOV'));
    await flush();
    FakeXHR.instances[0].succeed();
    await flush();

    await vi.advanceTimersByTimeAsync(1000);
    expect(get).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(500);
    await expect(promise).resolves.toMatchObject({ status: 'READY' });
  });

  it.each([
    ['file_image_invalid', 'Файл не является корректным изображением JPG, GIF или PNG'],
    ['file_video_too_long', 'Видео не должно быть длиннее 5 минут'],
    ['unknown_code', 'Не удалось обработать файл, попробуйте ещё раз'],
    [null, 'Не удалось обработать файл, попробуйте ещё раз'],
  ])('FAILED (%s) → ApiError 422 с русским сообщением', async (code, message) => {
    vi.spyOn(api, 'initUpload').mockResolvedValue(makeInit([1]));
    vi.spyOn(api, 'completeUpload').mockResolvedValue(status('FAILED', code));

    const settled = start(fileOf(1)).catch((e) => e);
    await flush();
    FakeXHR.instances[0].succeed();

    const error = await settled;
    expect(error).toBeInstanceOf(ApiError);
    expect(error).toMatchObject({ status: 422, code: code ?? 'file_processing_failed', message });
    expect(abortUpload).toHaveBeenCalledWith('u1');
  });

  it('обработка картинки дольше 2 минут — таймаут', async () => {
    vi.spyOn(api, 'initUpload').mockResolvedValue(makeInit([1]));
    vi.spyOn(api, 'completeUpload').mockResolvedValue(status('PROCESSING'));
    vi.spyOn(api, 'getUpload').mockResolvedValue(status('PROCESSING'));

    const settled = start(fileOf(1)).catch((e) => e);
    await flush();
    FakeXHR.instances[0].succeed();
    await vi.advanceTimersByTimeAsync(121_000);

    expect(await settled).toMatchObject({ code: 'file_processing_failed' });
  });

  it('для видео таймаут обработки — 15 минут', async () => {
    vi.spyOn(api, 'initUpload').mockResolvedValue(makeInit([1]));
    vi.spyOn(api, 'completeUpload').mockResolvedValue(status('PROCESSING'));
    const get = vi.spyOn(api, 'getUpload').mockResolvedValue(status('PROCESSING'));

    let result: unknown = 'pending';
    start(fileOf(1, 'clip.mp4')).then(
      (r) => (result = r),
      (e) => (result = e),
    );
    await flush();
    FakeXHR.instances[0].succeed();

    await vi.advanceTimersByTimeAsync(5 * 60_000);
    expect(result).toBe('pending');
    get.mockResolvedValue(status('READY'));
    await vi.advanceTimersByTimeAsync(1500);
    expect(result).toMatchObject({ status: 'READY' });
  });

  it('abort во время ожидания обработки', async () => {
    vi.spyOn(api, 'initUpload').mockResolvedValue(makeInit([1]));
    vi.spyOn(api, 'completeUpload').mockResolvedValue(status('PROCESSING'));

    const settled = start(fileOf(1)).catch((e) => e);
    await flush();
    FakeXHR.instances[0].succeed();
    await flush();
    controller.abort();

    expect(await settled).toMatchObject({ name: 'AbortError' });
    expect(abortUpload).toHaveBeenCalled();
  });

  it('ошибка init пробрасывается без отмены (сессии ещё нет)', async () => {
    vi.spyOn(api, 'initUpload').mockRejectedValue(new ApiError(400, 'file_type_not_allowed', 'bad'));
    await expect(start(fileOf(1))).rejects.toMatchObject({ code: 'file_type_not_allowed' });
    expect(abortUpload).not.toHaveBeenCalled();
  });
});
