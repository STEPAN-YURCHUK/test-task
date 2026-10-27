import { act, renderHook, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { ApiError } from '@/lib/api';
import { MESSAGES } from '@/lib/i18n';
import * as uploadModule from '@/lib/upload';
import { type DirectUploadState, uploadErrorText, useDirectUpload } from './useDirectUpload';

type ErrorState = Extract<DirectUploadState, { status: 'error' }>;

const png = new File([new Uint8Array(10)], 'a.png', { type: 'image/png' });

describe('useDirectUpload', () => {
  it('idle → uploading (прогресс) → processing → ready', async () => {
    let finish!: (v: unknown) => void;
    let opts!: Parameters<typeof uploadModule.uploadFile>[1];
    vi.spyOn(uploadModule, 'uploadFile').mockImplementation((_file, o) => {
      opts = o;
      return new Promise((resolve) => (finish = resolve)) as never;
    });

    const { result } = renderHook(() => useDirectUpload());
    expect(result.current.state).toEqual({ status: 'idle' });

    act(() => void result.current.start(png));
    expect(result.current.state).toMatchObject({ status: 'uploading', progress: 0 });

    act(() => opts.onProgress(0.5));
    expect(result.current.state).toMatchObject({ status: 'uploading', progress: 0.5 });

    act(() => opts.onPhase('processing'));
    expect(result.current.state).toMatchObject({ status: 'processing', progress: 1 });
    act(() => opts.onProgress(0.9));
    expect(result.current.state).toMatchObject({ status: 'processing' });
    act(() => opts.onPhase('uploading'));
    expect(result.current.state).toMatchObject({ status: 'processing' });

    await act(async () => finish({ uploadId: 'u1', status: 'READY' }));
    expect(result.current.state).toEqual({ status: 'ready', file: png, uploadId: 'u1' });
  });

  it('локальная валидация: недопустимый файл — сразу error без запроса', () => {
    const spy = vi.spyOn(uploadModule, 'uploadFile');
    const { result } = renderHook(() => useDirectUpload());
    const exe = new File(['x'], 'a.exe');

    act(() => void result.current.start(exe));
    expect(result.current.state).toMatchObject({ status: 'error', file: exe, local: true });
    expect(uploadErrorText(result.current.state as ErrorState, MESSAGES.ru)).toContain('Допустимые файлы');
    expect(spy).not.toHaveBeenCalled();
  });

  it('ошибка с известным кодом — переводимый текст, прочая ApiError — сообщение сервера, остальное — общее', async () => {
    const spy = vi.spyOn(uploadModule, 'uploadFile').mockRejectedValueOnce(new ApiError(422, 'file_image_invalid', 'Битая картинка'));
    const { result } = renderHook(() => useDirectUpload());
    const text = (t = MESSAGES.ru) => uploadErrorText(result.current.state as ErrorState, t);

    await act(() => result.current.start(png));
    expect(result.current.state).toMatchObject({ status: 'error', code: 'file_image_invalid', error: 'Битая картинка' });
    expect(text()).toBe('Файл не является корректным изображением JPG, GIF или PNG');
    expect(text(MESSAGES.en)).toBe('The file is not a valid JPG, GIF or PNG image');

    spy.mockRejectedValueOnce(new ApiError(400, 'file_type_not_allowed', 'Тип запрещён'));
    await act(() => result.current.start(png));
    expect(text()).toBe('Тип запрещён');

    spy.mockRejectedValueOnce(new Error('boom'));
    await act(() => result.current.start(png));
    expect(text()).toBe('Не удалось загрузить файл');
    expect(text(MESSAGES.en)).toBe('Could not upload the file');
  });

  it('clear отменяет текущую загрузку и игнорирует её результат', async () => {
    let signal!: AbortSignal;
    let finish!: (v: unknown) => void;
    vi.spyOn(uploadModule, 'uploadFile').mockImplementation((_f, o) => {
      signal = o.signal;
      return new Promise((resolve) => (finish = resolve)) as never;
    });
    const { result } = renderHook(() => useDirectUpload());

    act(() => void result.current.start(png));
    act(() => result.current.clear());
    expect(signal.aborted).toBe(true);
    expect(result.current.state).toEqual({ status: 'idle' });

    await act(async () => finish({ uploadId: 'late' }));
    expect(result.current.state).toEqual({ status: 'idle' });
  });

  it('ошибка отменённой загрузки игнорируется', async () => {
    let fail!: (e: unknown) => void;
    vi.spyOn(uploadModule, 'uploadFile').mockImplementation(() => new Promise((_r, reject) => (fail = reject)) as never);
    const { result } = renderHook(() => useDirectUpload());

    act(() => void result.current.start(png));
    act(() => result.current.clear());
    await act(async () => fail(new DOMException('Aborted', 'AbortError')));
    expect(result.current.state).toEqual({ status: 'idle' });
  });

  it('start(null) просто сбрасывает; новый файл отменяет предыдущую загрузку', async () => {
    const signals: AbortSignal[] = [];
    vi.spyOn(uploadModule, 'uploadFile').mockImplementation((_f, o) => {
      signals.push(o.signal);
      return new Promise(() => {}) as never;
    });
    const { result } = renderHook(() => useDirectUpload());

    act(() => void result.current.start(png));
    act(() => void result.current.start(png));
    expect(signals[0].aborted).toBe(true);
    expect(signals[1].aborted).toBe(false);

    act(() => void result.current.start(null));
    expect(signals[1].aborted).toBe(true);
    expect(result.current.state).toEqual({ status: 'idle' });
  });

  it('размонтирование отменяет загрузку', async () => {
    let signal!: AbortSignal;
    vi.spyOn(uploadModule, 'uploadFile').mockImplementation((_f, o) => {
      signal = o.signal;
      return new Promise(() => {}) as never;
    });
    const { result, unmount } = renderHook(() => useDirectUpload());
    act(() => void result.current.start(png));
    unmount();
    await waitFor(() => expect(signal.aborted).toBe(true));
  });
});
