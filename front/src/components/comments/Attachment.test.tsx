import { fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { imageFile } from '@/test-utils/fixtures';
import type { CommentFile } from '@/types/comment';
import { Attachment } from './Attachment';

const open = vi.fn();
vi.mock('@/components/lightbox/LightboxProvider', () => ({ useLightbox: () => ({ open }) }));

beforeEach(() => open.mockReset());

const mainImg = (alt: string) => screen.getByAltText(alt) as HTMLImageElement;

describe('Attachment — IMAGE', () => {
  it('picture: webp source + исходный формат, srcset с w-дескрипторами и sizes по ширине превью', () => {
    const { container } = render(<Attachment file={imageFile()} />);

    const source = container.querySelector('source')!;
    expect(source).toHaveAttribute('type', 'image/webp');
    expect(source).toHaveAttribute('srcset', 'https://cdn/webp-small/f1.webp 160w, https://cdn/webp-medium/f1.webp 240w, https://cdn/webp-original/f1.webp 320w');
    // 320x213 в кадре высотой 150 → ширина min(240, 320, 225) = 225
    expect(source).toHaveAttribute('sizes', '225px');

    const img = mainImg('photo.png');
    expect(img).toHaveAttribute('src', 'https://cdn/original/f1.png');
    expect(img).toHaveAttribute('srcset', 'https://cdn/small/f1.png 160w, https://cdn/medium/f1.png 240w, https://cdn/original/f1.png 320w');
    expect(img).toHaveAttribute('sizes', '225px');
    expect(img).toHaveAttribute('loading', 'lazy');

    // размытая подложка — самый маленький webp
    expect(container.querySelector('.mediaBackdrop')).toHaveAttribute('src', 'https://cdn/webp-small/f1.webp');
    expect(screen.getByText('320×213 · 6.7 КБ')).toBeInTheDocument();
  });

  it('вертикальная картинка: sizes по высоте кадра, aspect-ratio не меньше 1', () => {
    const { container } = render(<Attachment file={imageFile({ width: 107, height: 240 })} />);
    // 107/240*150 = 66.875 → 67px
    expect(container.querySelector('source')).toHaveAttribute('sizes', '67px');
    expect(screen.getByRole('button', { name: /Открыть изображение/ })).toHaveStyle({ aspectRatio: '1' });
  });

  it('широкая картинка: aspect-ratio ограничен 1.6, sizes не больше 240', () => {
    const { container } = render(<Attachment file={imageFile({ width: 320, height: 100 })} />);
    expect(container.querySelector('source')).toHaveAttribute('sizes', '240px');
    expect(screen.getByRole('button', { name: /Открыть изображение/ })).toHaveStyle({ aspectRatio: '1.6' });
  });

  it('клик открывает лайтбокс с webp-оригиналом', async () => {
    render(<Attachment file={imageFile()} />);
    await userEvent.click(screen.getByRole('button', { name: 'Открыть изображение photo.png' }));
    expect(open).toHaveBeenCalledWith({ type: 'IMAGE', url: 'https://cdn/webp-original/f1.webp', title: 'photo.png' });
  });

  it('без вариантов (старая картинка): один src, без srcset/source, лайтбокс с url', async () => {
    const { container } = render(<Attachment file={imageFile({ variants: null, width: null, height: null })} />);
    expect(container.querySelector('source')).toBeNull();
    const img = mainImg('photo.png');
    expect(img).not.toHaveAttribute('srcset');
    expect(img).not.toHaveAttribute('sizes');
    expect(container.querySelector('.mediaBackdrop')).toHaveAttribute('src', 'https://cdn/original/f1.png');
    expect(screen.getByText('320×240 · 6.7 КБ')).toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: /Открыть изображение/ }));
    expect(open).toHaveBeenCalledWith({ type: 'IMAGE', url: 'https://cdn/original/f1.png', title: 'photo.png' });
  });

  it('варианты без webp — без webp source', () => {
    const file = imageFile();
    const variants = Object.fromEntries(Object.entries(file.variants!).map(([k, v]) => [k, { ...v, webpUrl: null }])) as CommentFile['variants'];
    const { container } = render(<Attachment file={{ ...file, variants }} />);
    expect(container.querySelector('source')).toBeNull();
    expect(container.querySelector('.mediaBackdrop')).toHaveAttribute('src', 'https://cdn/original/f1.png');
  });

  it('после загрузки снимается заглушка, при ошибке — «недоступен»', () => {
    render(<Attachment file={imageFile()} />);
    const frame = screen.getByRole('button', { name: /Открыть изображение/ });
    expect(frame).not.toHaveClass('mediaLoaded');

    fireEvent.load(mainImg('photo.png'));
    expect(frame).toHaveClass('mediaLoaded');

    fireEvent.error(mainImg('photo.png'));
    expect(screen.getByText('Файл «photo.png» недоступен')).toBeInTheDocument();
  });
});

describe('Attachment — VIDEO', () => {
  const video = (overrides: Partial<CommentFile> = {}): CommentFile => ({
    ...imageFile(),
    type: 'VIDEO',
    url: 'https://cdn/videos/v.mp4',
    originalName: 'clip.mkv',
    mimeType: 'video/mp4',
    size: 666217,
    width: 1280,
    height: 720,
    variants: null,
    video: { duration: 64.6, posterUrl: 'https://cdn/posters/v.jpg', webpPosterUrl: 'https://cdn/posters/v.webp' },
    ...overrides,
  });

  it('постер (webp + jpg), длительность m:ss, подпись', () => {
    const { container } = render(<Attachment file={video()} />);
    expect(container.querySelector('source')).toHaveAttribute('srcset', 'https://cdn/posters/v.webp');
    expect(mainImg('clip.mkv')).toHaveAttribute('src', 'https://cdn/posters/v.jpg');
    expect(screen.getByText('1:05')).toBeInTheDocument();
    expect(screen.getByText('1280×720 · 650.6 КБ')).toBeInTheDocument();
  });

  it('клик открывает плеер с webp-постером', async () => {
    render(<Attachment file={video()} />);
    await userEvent.click(screen.getByRole('button', { name: 'Смотреть видео clip.mkv' }));
    expect(open).toHaveBeenCalledWith({ type: 'VIDEO', url: 'https://cdn/videos/v.mp4', title: 'clip.mkv', poster: 'https://cdn/posters/v.webp' });
  });

  it.each([
    [59.6, '1:00'],
    [119.5, '2:00'],
    [3.4, '0:03'],
    [600, '10:00'],
  ])('длительность %s с → %s (регрессия: раньше 59.6 с показывалось как 0:60)', (duration, label) => {
    render(<Attachment file={video({ video: { duration, posterUrl: 'https://cdn/p.jpg', webpPosterUrl: null } })} />);
    expect(screen.getByText(label)).toBeInTheDocument();
  });

  it('без webp-постера, длительности и размеров — фолбэки', async () => {
    const { container } = render(
      <Attachment file={video({ width: null, height: null, video: { duration: null, posterUrl: 'https://cdn/p.jpg', webpPosterUrl: null } })} />,
    );
    expect(container.querySelector('source')).toBeNull();
    expect(screen.getByText('0:00')).toBeInTheDocument();
    expect(screen.getByText(/320×180/)).toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: /Смотреть видео/ }));
    expect(open).toHaveBeenCalledWith(expect.objectContaining({ poster: 'https://cdn/p.jpg' }));
  });

  it('загрузка и ошибка постера', () => {
    render(<Attachment file={video()} />);
    fireEvent.load(mainImg('clip.mkv'));
    expect(screen.getByRole('button', { name: /Смотреть видео/ })).toHaveClass('mediaLoaded');
    fireEvent.error(mainImg('clip.mkv'));
    expect(screen.getByText('Файл «clip.mkv» недоступен')).toBeInTheDocument();
  });
});

describe('Attachment — TEXT', () => {
  it('карточка текстового файла открывает лайтбокс', async () => {
    render(<Attachment file={{ ...imageFile(), type: 'TEXT', url: 'https://cdn/t.txt', originalName: 'note.txt', size: 28, variants: null }} />);
    expect(screen.getByText('Текстовый файл · 28 Б')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: /note\.txt/ }));
    expect(open).toHaveBeenCalledWith({ type: 'TEXT', url: 'https://cdn/t.txt', title: 'note.txt' });
  });
});
