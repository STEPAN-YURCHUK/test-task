'use client';

import { useState } from 'react';
import { useLightbox } from '@/components/lightbox/LightboxProvider';
import { formatSize } from '@/lib/format';
import { useI18n } from '@/lib/i18n';
import type { CommentFile } from '@/types/comment';
import styles from './comments.module.css';

const ZoomIcon = () => (
  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" aria-hidden>
    <circle cx="11" cy="11" r="7" />
    <path d="m20 20-3.5-3.5M11 8v6M8 11h6" />
  </svg>
);

export function Attachment({ file }: { file: CommentFile }) {
  const { open } = useLightbox();
  const { t } = useI18n();
  const [broken, setBroken] = useState(false);
  const [loaded, setLoaded] = useState(false);

  if (broken) {
    return <div className={`${styles.attachment} ${styles.failed}`}>{t.attachment.unavailable(file.originalName)}</div>;
  }

  const url = file.url;

  if (file.type === 'VIDEO' && file.video) {
    const width = file.width ?? 320;
    const height = file.height ?? 180;
    const duration = file.video.duration ?? 0;
    // округляем всю длительность, а не секунды отдельно: иначе 59.6 с → «0:60»
    const totalSeconds = Math.round(duration);
    const time = `${Math.floor(totalSeconds / 60)}:${String(totalSeconds % 60).padStart(2, '0')}`;

    return (
      <figure className={styles.media}>
        <button
          type="button"
          className={`${styles.mediaFrame} ${loaded ? styles.mediaLoaded : ''}`}
          style={{ aspectRatio: `${Math.min(Math.max(width / height, 1), 1.6)}` }}
          onClick={() => open({ type: 'VIDEO', url, title: file.originalName, poster: file.video?.webpPosterUrl ?? file.video?.posterUrl })}
          aria-label={t.attachment.watchVideo(file.originalName)}
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={file.video.webpPosterUrl ?? file.video.posterUrl} alt="" aria-hidden className={styles.mediaBackdrop} loading="lazy" />
          <picture>
            {file.video.webpPosterUrl && <source type="image/webp" srcSet={file.video.webpPosterUrl} />}
            <img
              src={file.video.posterUrl}
              alt={file.originalName}
              className={styles.mediaImage}
              loading="lazy"
              onLoad={() => setLoaded(true)}
              onError={() => setBroken(true)}
            />
          </picture>
          <span className={styles.playButton} aria-hidden>
            <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor">
              <path d="M8 5.14v13.72a1 1 0 0 0 1.52.85l10.9-6.86a1 1 0 0 0 0-1.7L9.52 4.29A1 1 0 0 0 8 5.14Z" />
            </svg>
          </span>
          <span className={styles.durationBadge}>{time}</span>
        </button>
        <figcaption className={styles.mediaCaption}>
          <span className={styles.mediaName}>{file.originalName}</span>
          <span>
            {width}×{height} · {formatSize(file.size, t.format)}
          </span>
        </figcaption>
      </figure>
    );
  }

  if (file.type === 'IMAGE') {
    const width = file.width ?? 320;
    const height = file.height ?? 240;
    const variants = file.variants ? [file.variants.small, file.variants.medium, file.variants.original] : [];
    // реальная ширина в превью (кадр 150px в высоту, не шире 240) — по ней браузер выбирает вариант под плотность экрана
    const displayWidth = Math.round(Math.min(240, width, (width / height) * 150));
    const sizes = `${displayWidth}px`;
    const srcSet = variants.map((v) => `${v.url} ${v.width}w`).join(', ');
    const webpSrcSet = variants.every((v) => v.webpUrl) ? variants.map((v) => `${v.webpUrl} ${v.width}w`).join(', ') : '';
    const lightboxUrl = file.variants?.original.webpUrl ?? url;

    return (
      <figure className={styles.media}>
        <button
          type="button"
          className={`${styles.mediaFrame} ${loaded ? styles.mediaLoaded : ''}`}
          // кадр повторяет пропорции картинки; слишком узкие/высокие добирает размытая подложка
          style={{ aspectRatio: `${Math.min(Math.max(width / height, 1), 1.6)}` }}
          onClick={() => open({ type: 'IMAGE', url: lightboxUrl, title: file.originalName })}
          aria-label={t.attachment.openImage(file.originalName)}
        >
          {/* подложке хватает самого маленького варианта — она всё равно размыта */}
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={file.variants?.small.webpUrl ?? url} alt="" aria-hidden className={styles.mediaBackdrop} loading="lazy" />
          <picture>
            {webpSrcSet && <source type="image/webp" srcSet={webpSrcSet} sizes={sizes} />}
            <img
              src={url}
              srcSet={srcSet || undefined}
              sizes={srcSet ? sizes : undefined}
              alt={file.originalName}
              width={width}
              height={height}
              className={styles.mediaImage}
              loading="lazy"
              onLoad={() => setLoaded(true)}
              onError={() => setBroken(true)}
            />
          </picture>
          <span className={styles.mediaOverlay} aria-hidden>
            <ZoomIcon />
          </span>
        </button>
        <figcaption className={styles.mediaCaption}>
          <span className={styles.mediaName}>{file.originalName}</span>
          <span>
            {width}×{height} · {formatSize(file.size, t.format)}
          </span>
        </figcaption>
      </figure>
    );
  }

  return (
    <button type="button" className={styles.textCard} onClick={() => open({ type: 'TEXT', url, title: file.originalName })}>
      <span className={styles.textCardIcon} aria-hidden>
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round">
          <path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8l-5-5Z" />
          <path d="M14 3v5h5M9 13h6M9 17h4" />
        </svg>
      </span>
      <span className={styles.textCardMeta}>
        <span className={styles.mediaName}>{file.originalName}</span>
        <span className={styles.muted}>{t.attachment.textFile} · {formatSize(file.size, t.format)}</span>
      </span>
      <span className={styles.textCardAction}>{t.attachment.open}</span>
    </button>
  );
}
