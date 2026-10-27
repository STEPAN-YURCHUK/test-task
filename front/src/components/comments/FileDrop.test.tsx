import { fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { FileDrop } from './FileDrop';
import type { DirectUploadState } from './useDirectUpload';

const png = new File([new Uint8Array(2048)], 'photo.png', { type: 'image/png' });
const txt = new File(['hello'], 'note.txt', { type: 'text/plain' });
const mov = new File([new Uint8Array(10)], 'clip.mov', { type: '' });

const setup = (state: DirectUploadState) => {
  const onSelect = vi.fn();
  const onRetry = vi.fn();
  const view = render(<FileDrop state={state} onSelect={onSelect} onRetry={onRetry} />);
  return { onSelect, onRetry, ...view };
};

beforeEach(() => {
  URL.createObjectURL = vi.fn(() => 'blob:preview');
  URL.revokeObjectURL = vi.fn();
});

describe('FileDrop', () => {
  it('idle: dropzone, выбор через input', async () => {
    const { onSelect, container } = setup({ status: 'idle' });
    expect(screen.getByText('Перетащите файл')).toBeInTheDocument();

    const input = container.querySelector('input[type=file]') as HTMLInputElement;
    expect(input.accept).toContain('video/*');
    await userEvent.upload(input, png);
    expect(onSelect).toHaveBeenCalledWith(png);
  });

  it('drag&drop: подсветка при dragover, сброс при dragleave, файл при drop', () => {
    const { onSelect, container } = setup({ status: 'idle' });
    const zone = container.querySelector('label')!;

    fireEvent.dragOver(zone);
    expect(zone).toHaveClass('dropzoneActive');
    fireEvent.dragLeave(zone);
    expect(zone).not.toHaveClass('dropzoneActive');

    fireEvent.dragOver(zone);
    fireEvent.drop(zone, { dataTransfer: { files: [txt] } });
    expect(zone).not.toHaveClass('dropzoneActive');
    expect(onSelect).toHaveBeenCalledWith(txt);

    fireEvent.drop(zone, { dataTransfer: { files: [] } });
    expect(onSelect).toHaveBeenLastCalledWith(null);
  });

  it('uploading: имя, размер, процент, превью картинки, кнопка отмены', async () => {
    const { onSelect } = setup({ status: 'uploading', file: png, progress: 0.456 });

    expect(screen.getByText('photo.png')).toBeInTheDocument();
    expect(screen.getByText(/2\.0 КБ · Загрузка в хранилище · 46%/)).toBeInTheDocument();
    expect(document.querySelector('img')).toHaveAttribute('src', 'blob:preview');
    expect(document.querySelector('.progressBar')).toHaveStyle({ width: '45.6%' });

    await userEvent.click(screen.getByRole('button', { name: 'Отменить загрузку' }));
    expect(onSelect).toHaveBeenCalledWith(null);
  });

  it('полоса прогресса не уже 4%', () => {
    setup({ status: 'uploading', file: png, progress: 0 });
    expect(document.querySelector('.progressBar')).toHaveStyle({ width: '4%' });
  });

  it('processing: обычный файл и видео (по расширению и по mime)', () => {
    const { rerender } = setup({ status: 'processing', file: txt, progress: 1 });
    expect(screen.getByText(/Обработка…/)).toBeInTheDocument();
    expect(screen.getByText('TXT')).toBeInTheDocument();
    expect(document.querySelector('.progressBar')).toHaveClass('progressIndeterminate');

    rerender(<FileDrop state={{ status: 'processing', file: mov, progress: 1 }} onSelect={vi.fn()} onRetry={vi.fn()} />);
    expect(screen.getByText(/Конвертация видео для всех устройств…/)).toBeInTheDocument();
    expect(screen.getByText('VIDEO')).toBeInTheDocument();

    const mp4ByMime = new File(['x'], 'clip', { type: 'video/mp4' });
    rerender(<FileDrop state={{ status: 'processing', file: mp4ByMime, progress: 1 }} onSelect={vi.fn()} onRetry={vi.fn()} />);
    expect(screen.getByText(/Конвертация видео/)).toBeInTheDocument();
  });

  it('ready: «Готово», убрать файл', async () => {
    const { onSelect } = setup({ status: 'ready', file: txt, uploadId: 'u1' });
    expect(screen.getByText(/Готово/)).toBeInTheDocument();
    expect(document.querySelector('.fileChip')).toHaveClass('fileChipReady');

    await userEvent.click(screen.getByRole('button', { name: 'Убрать файл' }));
    expect(onSelect).toHaveBeenCalledWith(null);
  });

  it('error: текст ошибки и «Повторить»', async () => {
    const { onRetry } = setup({ status: 'error', file: png, error: 'Не удалось загрузить файл' });
    expect(screen.getByText('Не удалось загрузить файл')).toBeInTheDocument();
    expect(document.querySelector('.fileChip')).toHaveClass('fileChipInvalid');
    expect(document.querySelector('.progressTrack')).toBeNull();

    await userEvent.click(screen.getByRole('button', { name: 'Повторить' }));
    expect(onRetry).toHaveBeenCalled();
  });

  it('error без файла — показывает dropzone и ошибку', () => {
    setup({ status: 'error', file: null, error: 'Ошибка' });
    expect(screen.getByText('Перетащите файл')).toBeInTheDocument();
    expect(screen.getByText('Ошибка')).toBeInTheDocument();
  });

  it('освобождает object URL превью при размонтировании', () => {
    const { unmount } = setup({ status: 'ready', file: png, uploadId: 'u1' });
    unmount();
    expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:preview');
  });
});
