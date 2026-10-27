'use client';

import { useCallback, useEffect, useState } from 'react';
import { api, ApiError } from '@/lib/api';
import { toSafeHtml } from '@/lib/comment-html';
import { useI18n } from '@/lib/i18n';
import { type CommentFormValues, type FormErrors, validateCommentForm, validateText } from '@/lib/validation';
import type { Comment } from '@/types/comment';
import { CaptchaField } from './CaptchaField';
import { CommentEditor } from './CommentEditor';
import { FileDrop } from './FileDrop';
import { useDirectUpload } from './useDirectUpload';
import styles from './comments.module.css';

type Props = {
  parentUuid?: string;
  onCreated: (comment: Comment) => void;
  onCancel?: () => void;
};

const PROFILE_KEY = 'comments.profile';

// true — ошибка клиентской проверки: текст собирается в рендере и переводится при смене языка.
// Строка — сообщение сервера (уже на языке запроса)
type ShownErrors = Partial<Record<keyof FormErrors, string | true>>;
type Preview = { html?: string; error?: string; local?: boolean; failed?: boolean };

const markClientErrors = (errors: FormErrors): ShownErrors =>
  Object.fromEntries(Object.entries(errors).filter(([, message]) => message).map(([field]) => [field, true]));
const EMPTY: CommentFormValues = { userName: '', email: '', homePage: '', text: '', captcha: '' };

function loadProfile(): Partial<CommentFormValues> {
  try {
    return JSON.parse(localStorage.getItem(PROFILE_KEY) ?? '{}');
  } catch {
    return {};
  }
}

function saveProfile(values: CommentFormValues) {
  try {
    const { userName, email, homePage } = values;
    localStorage.setItem(PROFILE_KEY, JSON.stringify({ userName, email, homePage }));
  } catch {
    // приватный режим / запрещённое хранилище — просто не запоминаем
  }
}

export function CommentForm({ parentUuid, onCreated, onCancel }: Props) {
  const { t } = useI18n();
  const [values, setValues] = useState<CommentFormValues>(EMPTY);
  const upload = useDirectUpload();
  const [errors, setErrors] = useState<ShownErrors>({});
  const [serverError, setServerError] = useState<string | true | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [captchaToken, setCaptchaToken] = useState('');
  const [captchaKey, setCaptchaKey] = useState(0);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [success, setSuccess] = useState(false);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- профиль из localStorage доступен только на клиенте
    setValues((prev) => ({ ...prev, ...loadProfile() }));
  }, []);

  const setField = (field: keyof CommentFormValues) => (value: string) => {
    setValues((prev) => ({ ...prev, [field]: value }));
    setErrors((prev) => ({ ...prev, [field]: undefined }));
  };

  // Предпросмотр рендерит сервер — ровно так, как текст будет сохранён
  const refreshPreview = useCallback(async (text: string) => {
    if (validateText(text)) return setPreview({ local: true });
    try {
      const { html } = await api.preview(text);
      setPreview({ html });
    } catch (e) {
      setPreview(e instanceof ApiError ? { error: e.errors.text?.[0] ?? e.message } : { failed: true });
    }
  }, []);

  const previewOpen = preview !== null;
  useEffect(() => {
    if (!previewOpen) return;
    const timer = setTimeout(() => refreshPreview(values.text), 350);
    return () => clearTimeout(timer);
  }, [values.text, previewOpen, refreshPreview]);

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setServerError(null);
    setSuccess(false);

    const nextErrors = markClientErrors(validateCommentForm(values, null));
    if (['uploading', 'processing', 'error'].includes(upload.state.status)) nextErrors.file = true;
    setErrors(nextErrors);
    if (Object.keys(nextErrors).length) return;

    const form = new FormData();
    form.append('userName', values.userName.trim());
    form.append('email', values.email.trim());
    if (values.homePage.trim()) form.append('homePage', values.homePage.trim());
    form.append('text', values.text);
    form.append('captchaToken', captchaToken);
    form.append('captcha', values.captcha.trim());
    if (parentUuid) form.append('parentUuid', parentUuid);
    // файл уже лежит в S3 — передаём только id готовой загрузки
    if (upload.state.status === 'ready') form.append('uploadId', upload.state.uploadId);

    setSubmitting(true);
    try {
      const comment = await api.createComment(form);
      saveProfile(values);
      setValues((prev) => ({ ...prev, text: '', captcha: '' }));
      upload.clear();
      setPreview(null);
      setSuccess(true);
      onCreated(comment);
    } catch (err) {
      if (err instanceof ApiError) {
        const fieldErrors: ShownErrors = {};
        for (const [field, messages] of Object.entries(err.errors)) {
          fieldErrors[field as keyof FormErrors] = messages[0];
        }
        if (err.code === 'captcha_invalid' || err.code === 'captcha_expired') fieldErrors.captcha = err.message;
        if (err.code === 'disposable_email_not_allowed') fieldErrors.email = err.message;
        if (err.code?.startsWith('file_')) {
          fieldErrors.file = err.message;
          // одноразовая загрузка потеряна (истекла / уже использована) — файл нужно загрузить заново
          upload.clear();
        }
        setErrors(fieldErrors);
        if (!Object.keys(fieldErrors).length) setServerError(err.message);
      } else {
        setServerError(true);
      }
    } finally {
      // токен капчи одноразовый — после любой попытки нужна новая картинка
      setValues((prev) => ({ ...prev, captcha: '' }));
      setCaptchaKey((key) => key + 1);
      setSubmitting(false);
    }
  };

  const errorText = (name: keyof FormErrors): string | undefined => {
    const error = errors[name];
    if (error !== true) return error;
    if (name === 'file') {
      if (upload.state.status === 'uploading' || upload.state.status === 'processing') return t.form.waitUpload;
      return upload.state.status === 'error' ? t.form.removeFailedFile : undefined;
    }
    return validateCommentForm(values, null)[name];
  };

  const previewError = preview && (preview.local ? validateText(values.text) : preview.failed ? t.form.previewFailed : preview.error);

  const field = (name: 'userName' | 'email' | 'homePage', label: string, props: React.InputHTMLAttributes<HTMLInputElement>) => (
    <label className={styles.field}>
      <span className={styles.label}>
        {label} {name !== 'homePage' && <em>*</em>}
      </span>
      <input
        className={`${styles.input} ${errorText(name) ? styles.invalid : ''}`}
        value={values[name]}
        onChange={(e) => setField(name)(e.target.value)}
        {...props}
      />
      {errorText(name) && <span className={styles.error}>{errorText(name)}</span>}
    </label>
  );

  return (
    <form className={`${styles.form} ${parentUuid ? styles.replyForm : ''}`} onSubmit={onSubmit} noValidate>
      <div className={styles.grid}>
        {field('userName', 'User Name', { placeholder: 'JohnDoe', autoComplete: 'nickname', maxLength: 50 })}
        {field('email', 'E-mail', { type: 'email', placeholder: 'john@example.com', autoComplete: 'email', maxLength: 255 })}
        {field('homePage', 'Home page', { type: 'url', placeholder: 'https://example.com', autoComplete: 'url', maxLength: 2048 })}
      </div>

      <CommentEditor value={values.text} error={errorText('text')} rows={parentUuid ? 3 : 5} onChange={setField('text')} />

      <FileDrop
        state={upload.state}
        onSelect={(next) => {
          setErrors((prev) => ({ ...prev, file: undefined }));
          upload.start(next);
        }}
        onRetry={() => upload.state.status === 'error' && upload.state.file && upload.start(upload.state.file)}
      />
      {errorText('file') && upload.state.status !== 'error' && <span className={styles.error}>{errorText('file')}</span>}

      <CaptchaField
        value={values.captcha}
        error={errorText('captcha')}
        refreshKey={captchaKey}
        onChange={setField('captcha')}
        onToken={setCaptchaToken}
      />

      {preview && (
        <div className={styles.preview}>
          <div className={styles.previewTitle}>{t.form.preview}</div>
          {previewError ? (
            <span className={styles.error}>{previewError}</span>
          ) : (
            <div className={styles.text} dangerouslySetInnerHTML={{ __html: toSafeHtml(preview.html ?? '') }} />
          )}
        </div>
      )}

      {serverError && <div className={styles.alert}>{serverError === true ? t.form.submitFailed : serverError}</div>}
      {success && !parentUuid && <div className={styles.successMessage}>{t.form.published}</div>}

      <div className={styles.actions}>
        <button
          type="submit"
          className={styles.primary}
          disabled={submitting || upload.state.status === 'uploading' || upload.state.status === 'processing'}
        >
          {submitting ? t.form.sending : parentUuid ? t.form.reply : t.form.submit}
        </button>
        <button
          type="button"
          className={styles.secondary}
          onClick={() => (preview ? setPreview(null) : refreshPreview(values.text))}
        >
          {preview ? t.form.hidePreview : t.form.preview}
        </button>
        {onCancel && (
          <button type="button" className={styles.link} onClick={onCancel}>
            {t.form.cancel}
          </button>
        )}
      </div>
    </form>
  );
}
