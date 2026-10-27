'use client';

import { useEffect, useMemo, useState } from 'react';
import { formatSize } from '@/lib/format';
import { type Messages, useI18n } from '@/lib/i18n';
import { type DirectUploadState, uploadErrorText } from './useDirectUpload';
import styles from './comments.module.css';

type Props = {
  state: DirectUploadState;
  onSelect: (file: File | null) => void;
  onRetry: () => void;
};

const ACCEPT = '.jpg,.jpeg,.png,.gif,.txt,.mp4,.m4v,.mov,.webm,.mkv,.avi,image/jpeg,image/png,image/gif,text/plain,video/*';

function statusLabel(state: DirectUploadState, t: Messages['file']): string {
  switch (state.status) {
    case 'uploading':
      return t.uploading(Math.round(state.progress * 100));
    case 'processing':
      return state.file.type.startsWith('video/') || /\.(mp4|m4v|mov|webm|mkv|avi)$/i.test(state.file.name)
        ? t.converting
        : t.processing;
    case 'ready':
      return t.ready;
    default:
      return '';
  }
}

export function FileDrop({ state, onSelect, onRetry }: Props) {
  const [dragging, setDragging] = useState(false);
  const { t } = useI18n();
  const file = state.status === 'idle' ? null : state.file;
  const previewUrl = useMemo(() => (file && file.type.startsWith('image/') ? URL.createObjectURL(file) : null), [file]);

  useEffect(() => () => void (previewUrl && URL.revokeObjectURL(previewUrl)), [previewUrl]);

  const error = state.status === 'error' ? uploadErrorText(state, t) : undefined;
  const busy = state.status === 'uploading' || state.status === 'processing';
  const progress = state.status === 'uploading' ? state.progress : state.status === 'idle' || state.status === 'error' ? 0 : 1;

  return (
    <div className={styles.field}>
      <span className={styles.label}>{t.file.label}</span>

      {file ? (
        <div className={`${styles.fileChip} ${error ? styles.fileChipInvalid : ''} ${state.status === 'ready' ? styles.fileChipReady : ''}`}>
          {previewUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={previewUrl} alt="" className={styles.fileChipPreview} />
          ) : (
            <span className={styles.fileChipIcon}>{/\.txt$/i.test(file.name) ? 'TXT' : 'VIDEO'}</span>
          )}
          <span className={styles.fileChipMeta}>
            <span className={styles.fileChipName}>{file.name}</span>
            <span className={styles.fileChipStatus}>
              {formatSize(file.size, t.format)}
              {statusLabel(state, t.file) && <> · {statusLabel(state, t.file)}</>}
              {state.status === 'ready' && (
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" aria-hidden>
                  <path d="m5 12 5 5 9-10" />
                </svg>
              )}
            </span>
            {(busy || state.status === 'ready') && (
              <span className={styles.progressTrack} aria-hidden>
                <span
                  className={`${styles.progressBar} ${state.status === 'processing' ? styles.progressIndeterminate : ''}`}
                  style={{ width: `${Math.max(4, progress * 100)}%` }}
                />
              </span>
            )}
          </span>
          {error && (
            <button type="button" className={styles.link} onClick={onRetry}>
              {t.file.retry}
            </button>
          )}
          <button type="button" className={styles.fileChipRemove} onClick={() => onSelect(null)} aria-label={busy ? t.file.cancelUpload : t.file.remove}>
            ×
          </button>
        </div>
      ) : (
        <label
          className={`${styles.dropzone} ${dragging ? styles.dropzoneActive : ''}`}
          onDragOver={(e) => {
            e.preventDefault();
            setDragging(true);
          }}
          onDragLeave={() => setDragging(false)}
          onDrop={(e) => {
            e.preventDefault();
            setDragging(false);
            onSelect(e.dataTransfer.files?.[0] ?? null);
          }}
        >
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" aria-hidden>
            <path d="M12 16V4m0 0-4 4m4-4 4 4" />
            <path d="M4 16v2a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-2" />
          </svg>
          <span>
            <strong>{t.file.dropTitle}</strong> {t.file.dropOr}
          </span>
          <span className={styles.muted}>{t.file.dropHint}</span>
          <input type="file" accept={ACCEPT} className={styles.visuallyHidden} onChange={(e) => onSelect(e.target.files?.[0] ?? null)} />
        </label>
      )}

      {error && <span className={styles.error}>{error}</span>}
    </div>
  );
}
