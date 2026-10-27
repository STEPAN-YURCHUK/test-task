import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { setLocale } from '@/lib/i18n';
import { LightboxProvider, useLightbox, type LightboxItem } from './LightboxProvider';

function Opener({ item }: { item: LightboxItem }) {
  const { open } = useLightbox();
  return <button onClick={() => open(item)}>open {item.type}</button>;
}

const setup = (item: LightboxItem) => {
  render(
    <LightboxProvider>
      <Opener item={item} />
    </LightboxProvider>,
  );
  fireEvent.click(screen.getByText(`open ${item.type}`));
};

const fetchMock = vi.fn();

beforeEach(() => {
  fetchMock.mockReset();
  vi.stubGlobal('fetch', fetchMock);
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('LightboxProvider', () => {
  it('useLightbox вне провайдера — понятная ошибка', () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    expect(() => render(<Opener item={{ type: 'IMAGE', url: 'x', title: 't' }} />)).toThrow('useLightbox must be used within LightboxProvider');
  });

  it('IMAGE: спиннер до загрузки, блокировка скролла, заголовок', () => {
    setup({ type: 'IMAGE', url: 'https://cdn/a.webp', title: 'photo.png' });

    const dialog = screen.getByRole('dialog');
    expect(dialog).toHaveAttribute('aria-modal', 'true');
    expect(screen.getByLabelText('Загрузка')).toBeInTheDocument();
    expect(document.body.style.overflow).toBe('hidden');
    expect(screen.getByText('photo.png', { selector: 'span' })).toBeInTheDocument();

    const img = screen.getByAltText('photo.png');
    expect(img).toHaveAttribute('src', 'https://cdn/a.webp');
    expect(img).not.toHaveClass('visible');
    fireEvent.load(img);
    expect(img).toHaveClass('visible');
    expect(screen.queryByLabelText('Загрузка')).not.toBeInTheDocument();
  });

  it('Escape: анимация закрытия, через 200 мс окно исчезает, скролл возвращается', () => {
    vi.useFakeTimers();
    setup({ type: 'IMAGE', url: 'u', title: 't' });

    fireEvent.keyDown(document, { key: 'Enter' });
    expect(screen.getByRole('dialog')).not.toHaveClass('closing');

    fireEvent.keyDown(document, { key: 'Escape' });
    expect(screen.getByRole('dialog')).toHaveClass('closing');
    act(() => vi.advanceTimersByTime(200));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(document.body.style.overflow).toBe('');
  });

  it('клик по фону закрывает, клик внутри — нет; кнопка «Закрыть»', () => {
    vi.useFakeTimers();
    setup({ type: 'IMAGE', url: 'u', title: 't' });

    fireEvent.click(screen.getByAltText('t'));
    expect(screen.getByRole('dialog')).not.toHaveClass('closing');

    fireEvent.click(screen.getByRole('dialog'));
    expect(screen.getByRole('dialog')).toHaveClass('closing');
    act(() => vi.advanceTimersByTime(200));

    fireEvent.click(screen.getByText('open IMAGE'));
    fireEvent.click(screen.getByRole('button', { name: 'Закрыть' }));
    act(() => vi.advanceTimersByTime(200));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('TEXT: загружает файл и показывает как текст (без интерпретации HTML)', async () => {
    fetchMock.mockResolvedValue({ ok: true, text: () => Promise.resolve('<b>не тег</b>') });
    setup({ type: 'TEXT', url: 'https://cdn/n.txt', title: 'n.txt' });

    expect(fetchMock).toHaveBeenCalledWith('https://cdn/n.txt');
    const pre = await screen.findByText('<b>не тег</b>');
    expect(pre.tagName).toBe('PRE');
    expect(document.querySelector('b')).toBeNull();
  });

  it.each([
    ['HTTP-ошибка', () => fetchMock.mockResolvedValue({ ok: false, text: () => Promise.resolve('') })],
    ['сетевая ошибка', () => fetchMock.mockRejectedValue(new Error('offline'))],
  ])('TEXT: %s → «Не удалось загрузить файл»', async (_name, arrange) => {
    arrange();
    setup({ type: 'TEXT', url: 'u', title: 't' });
    expect(await screen.findByText('Не удалось загрузить файл')).toBeInTheDocument();
    act(() => setLocale('en'));
    expect(screen.getByText('Could not load the file')).toBeInTheDocument();
    act(() => setLocale('ru'));
  });

  it('TEXT: ответ после закрытия окна игнорируется', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    let resolve!: (v: unknown) => void;
    fetchMock.mockReturnValue(new Promise((r) => (resolve = r)));
    setup({ type: 'TEXT', url: 'u', title: 't' });

    fireEvent.keyDown(document, { key: 'Escape' });
    act(() => vi.advanceTimersByTime(200));
    await act(async () => resolve({ ok: true, text: () => Promise.resolve('late') }));
    expect(screen.queryByText('late')).not.toBeInTheDocument();
  });

  it('VIDEO: плеер с playsInline, controls, autoplay, постером; спиннер до metadata', () => {
    setup({ type: 'VIDEO', url: 'https://cdn/v.mp4', title: 'clip', poster: 'https://cdn/p.webp' });

    const video = document.querySelector('video')!;
    expect(video).toHaveAttribute('src', 'https://cdn/v.mp4');
    expect(video).toHaveAttribute('poster', 'https://cdn/p.webp');
    expect(video).toHaveAttribute('playsinline');
    expect(video).toHaveAttribute('controls');
    expect(video.autoplay).toBe(true);
    expect(video).toHaveAttribute('preload', 'metadata');
    expect(screen.getByLabelText('Загрузка')).toBeInTheDocument();

    fireEvent.loadedMetadata(video);
    expect(video).toHaveClass('visible');
  });

  it('VIDEO: ошибка загрузки убирает спиннер', () => {
    setup({ type: 'VIDEO', url: 'bad', title: 'clip' });
    fireEvent.error(document.querySelector('video')!);
    expect(screen.queryByLabelText('Загрузка')).not.toBeInTheDocument();
  });

  it('повторное открытие сбрасывает состояние загрузки', async () => {
    render(
      <LightboxProvider>
        <Opener item={{ type: 'IMAGE', url: 'a', title: 'A' }} />
        <Opener item={{ type: 'VIDEO', url: 'b', title: 'B' }} />
      </LightboxProvider>,
    );
    fireEvent.click(screen.getByText('open IMAGE'));
    fireEvent.load(screen.getByAltText('A'));
    fireEvent.click(screen.getByText('open VIDEO'));
    await waitFor(() => expect(screen.getByLabelText('Загрузка')).toBeInTheDocument());
  });
});
