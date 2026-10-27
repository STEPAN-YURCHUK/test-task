import { describe, expect, it } from 'vitest';
import { COMMENT_TEXT_MAX_LENGTH } from './comment-html';
import { TEXT_FILE_MAX_BYTES, UPLOAD_MAX_BYTES, VIDEO_MAX_BYTES, validateCommentForm, validateFile, validateText } from './validation';

const fileOf = (name: string, size: number) => {
  const file = new File(['x'], name);
  Object.defineProperty(file, 'size', { value: size });
  return file;
};

const valid = { userName: 'John1', email: 'john@example.com', homePage: '', text: 'Hello <i>w</i>', captcha: 'aB3' };

describe('validateText', () => {
  it('обязательное поле', () => {
    expect(validateText('')).toBe('Обязательное поле');
    expect(validateText('   ')).toBe('Обязательное поле');
  });

  it('граница длины', () => {
    expect(validateText('a'.repeat(COMMENT_TEXT_MAX_LENGTH))).toBeUndefined();
    expect(validateText('a'.repeat(COMMENT_TEXT_MAX_LENGTH + 1))).toBe(`Максимум ${COMMENT_TEXT_MAX_LENGTH} символов`);
  });

  it('текст только из тегов считается пустым', () => {
    expect(validateText('<i> </i>')).toBe('Текст сообщения пуст');
  });

  it('ошибки разметки отдаются сообщением санитайзера', () => {
    expect(validateText('<b>x</b>')).toBe('Тег запрещён (разрешены: a, code, i, strong): b');
    expect(validateText('<i>x')).toBe('Тег не закрыт: <i>');
  });

  it('валидный текст', () => {
    expect(validateText('ok <strong>bold</strong>')).toBeUndefined();
  });
});

describe('validateFile', () => {
  it('без файла — нет ошибки', () => {
    expect(validateFile(null)).toBeUndefined();
  });

  it.each([
    ['note.txt', TEXT_FILE_MAX_BYTES, undefined],
    ['NOTE.TXT', TEXT_FILE_MAX_BYTES + 1, 'Текстовый файл не должен превышать 100 КБ'],
    ['a.jpg', UPLOAD_MAX_BYTES, undefined],
    ['a.jpeg', 10, undefined],
    ['a.PNG', 10, undefined],
    ['a.gif', UPLOAD_MAX_BYTES + 1, 'Изображение слишком большое (максимум 20 МБ)'],
    ['v.mp4', VIDEO_MAX_BYTES, undefined],
    ['v.mov', 10, undefined],
    ['v.webm', 10, undefined],
    ['v.mkv', 10, undefined],
    ['v.avi', 10, undefined],
    ['v.m4v', VIDEO_MAX_BYTES + 1, 'Видео не должно превышать 200 МБ'],
    ['x.exe', 10, 'Допустимые файлы: JPG, GIF, PNG, TXT, MP4, MOV, WEBM, MKV, AVI'],
    ['x.webp', 10, 'Допустимые файлы: JPG, GIF, PNG, TXT, MP4, MOV, WEBM, MKV, AVI'],
    ['noext', 10, 'Допустимые файлы: JPG, GIF, PNG, TXT, MP4, MOV, WEBM, MKV, AVI'],
  ])('%s (%i байт) → %s', (name, size, expected) => {
    expect(validateFile(fileOf(name, size))).toBe(expected);
  });
});

describe('validateCommentForm', () => {
  it('валидная форма — без ошибок', () => {
    expect(validateCommentForm(valid, null)).toEqual({});
    expect(validateCommentForm({ ...valid, homePage: 'https://x.io' }, fileOf('a.png', 10))).toEqual({});
  });

  it('все поля пустые', () => {
    expect(validateCommentForm({ userName: '', email: '', homePage: '', text: '', captcha: '' }, null)).toEqual({
      userName: 'Обязательное поле',
      email: 'Обязательное поле',
      captcha: 'Обязательное поле',
      text: 'Обязательное поле',
    });
  });

  it.each([
    ['John Doe', 'Только латинские буквы и цифры'],
    ['Иван', 'Только латинские буквы и цифры'],
    ['a'.repeat(51), 'Максимум 50 символов'],
  ])('userName %s → %s', (userName, message) => {
    expect(validateCommentForm({ ...valid, userName }, null).userName).toBe(message);
  });

  it('userName из 50 символов и с пробелами по краям — валиден', () => {
    expect(validateCommentForm({ ...valid, userName: 'a'.repeat(50) }, null).userName).toBeUndefined();
    expect(validateCommentForm({ ...valid, userName: '  John1  ' }, null).userName).toBeUndefined();
  });

  it.each(['john', 'john@', 'john@ex', 'jo hn@ex.com', 'john@ex.c'])('email %s невалиден', (email) => {
    expect(validateCommentForm({ ...valid, email }, null).email).toBe('Неверный формат e-mail');
  });

  it.each(['ftp://x.io', 'javascript:alert(1)', 'not a url', 'x.io'])('homePage %s невалиден', (homePage) => {
    expect(validateCommentForm({ ...valid, homePage }, null).homePage).toBe('Неверный формат URL (http/https)');
  });

  it('homePage http и https валидны', () => {
    expect(validateCommentForm({ ...valid, homePage: 'http://x.io' }, null).homePage).toBeUndefined();
  });

  it('captcha только латиница и цифры', () => {
    expect(validateCommentForm({ ...valid, captcha: 'аб1' }, null).captcha).toBe('Только латинские буквы и цифры');
  });

  it('ошибки текста и файла попадают в результат', () => {
    const errors = validateCommentForm({ ...valid, text: '<b>x</b>' }, fileOf('x.exe', 1));
    expect(errors.text).toContain('Тег запрещён');
    expect(errors.file).toContain('Допустимые файлы');
  });
});
