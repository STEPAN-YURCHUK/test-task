'use client';

import { useCallback, useEffect, useState } from 'react';
import { api } from '@/lib/api';
import { useI18n } from '@/lib/i18n';
import styles from './comments.module.css';

type Props = {
  value: string;
  error?: string;
  refreshKey: number;
  onChange: (value: string) => void;
  onToken: (token: string) => void;
};

export function CaptchaField({ value, error, refreshKey, onChange, onToken }: Props) {
  const { t } = useI18n();
  const [image, setImage] = useState<string | null>(null);
  const [loadError, setLoadError] = useState(false);

  const reload = useCallback(async () => {
    setLoadError(false);
    try {
      const captcha = await api.getCaptcha();
      setImage(captcha.image);
      onToken(captcha.token);
    } catch {
      setLoadError(true);
    }
  }, [onToken]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- загрузка капчи при монтировании и после каждой отправки
    reload();
  }, [reload, refreshKey]);

  return (
    <label className={styles.field}>
      <span className={styles.label}>
        CAPTCHA <em>*</em>
      </span>
      <div className={styles.captchaRow}>
        <div className={styles.captchaImage}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          {image ? <img src={image} alt="CAPTCHA" width={180} height={56} /> : <span>{loadError ? t.captcha.loadFailed : '…'}</span>}
        </div>
        <button type="button" className={styles.iconButton} onClick={reload} title={t.captcha.reloadTitle} aria-label={t.captcha.reload}>
          ↻
        </button>
        <input
          className={`${styles.input} ${error ? styles.invalid : ''}`}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={t.captcha.placeholder}
          autoComplete="off"
          maxLength={10}
        />
      </div>
      {error && <span className={styles.error}>{error}</span>}
    </label>
  );
}
