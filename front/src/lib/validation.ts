import { COMMENT_TEXT_MAX_LENGTH, CommentHtmlError, sanitizeCommentHtml } from './comment-html';
import { messages } from './i18n';

export const TEXT_FILE_MAX_BYTES = 100 * 1024;
export const UPLOAD_MAX_BYTES = 20 * 1024 * 1024;
const IMAGE_EXT = /\.(jpe?g|png|gif)$/i;
const VIDEO_EXT = /\.(mp4|m4v|mov|webm|mkv|avi)$/i;
export const VIDEO_MAX_BYTES = 200 * 1024 * 1024;

export type CommentFormValues = {
  userName: string;
  email: string;
  homePage: string;
  text: string;
  captcha: string;
};

export type FormErrors = Partial<Record<keyof CommentFormValues | 'file', string>>;

export function validateText(text: string): string | undefined {
  const t = messages().validation;
  if (!text.trim()) return t.required;
  if (text.length > COMMENT_TEXT_MAX_LENGTH) return t.maxChars(COMMENT_TEXT_MAX_LENGTH);
  try {
    const html = sanitizeCommentHtml(text);
    if (!html.replace(/<[^>]+>/g, '').trim()) return t.textEmpty;
  } catch (e) {
    if (e instanceof CommentHtmlError) return e.message;
    throw e;
  }
}

export function validateFile(file: File | null): string | undefined {
  if (!file) return;
  const t = messages().validation;
  if (/\.txt$/i.test(file.name)) {
    return file.size > TEXT_FILE_MAX_BYTES ? t.textFileTooLarge : undefined;
  }
  if (IMAGE_EXT.test(file.name)) {
    return file.size > UPLOAD_MAX_BYTES ? t.imageTooLarge : undefined;
  }
  if (VIDEO_EXT.test(file.name)) {
    return file.size > VIDEO_MAX_BYTES ? t.videoTooLarge : undefined;
  }
  return t.fileTypes;
}

export function validateCommentForm(values: CommentFormValues, file: File | null): FormErrors {
  const errors: FormErrors = {};
  const t = messages().validation;

  if (!values.userName.trim()) errors.userName = t.required;
  else if (!/^[A-Za-z0-9]+$/.test(values.userName.trim())) errors.userName = t.latinOnly;
  else if (values.userName.trim().length > 50) errors.userName = t.maxChars(50);

  if (!values.email.trim()) errors.email = t.required;
  else if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(values.email.trim())) errors.email = t.invalidEmail;

  if (values.homePage.trim()) {
    try {
      const url = new URL(values.homePage.trim());
      if (!['http:', 'https:'].includes(url.protocol)) throw new Error();
    } catch {
      errors.homePage = t.invalidUrl;
    }
  }

  if (!values.captcha.trim()) errors.captcha = t.required;
  else if (!/^[A-Za-z0-9]+$/.test(values.captcha.trim())) errors.captcha = t.latinOnly;

  const textError = validateText(values.text);
  if (textError) errors.text = textError;

  const fileError = validateFile(file);
  if (fileError) errors.file = fileError;

  return errors;
}
