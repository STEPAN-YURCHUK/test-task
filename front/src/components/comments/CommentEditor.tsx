'use client';

import { useId, useRef, useState, useSyncExternalStore } from 'react';
import { COMMENT_TEXT_MAX_LENGTH } from '@/lib/comment-html';
import { type Messages, useI18n } from '@/lib/i18n';
import styles from './comments.module.css';

type Tag = 'i' | 'strong' | 'code' | 'a';

type Props = {
  value: string;
  error?: string;
  rows: number;
  onChange: (value: string) => void;
};

// На сервере платформа неизвестна — рендерим 'Ctrl', после гидрации подставляем '⌘' на macOS
const subscribeNoop = () => () => {};
const getModKey = () => (/Mac|iPhone|iPad/.test(navigator.platform) ? '⌘' : 'Ctrl');
const getServerModKey = () => 'Ctrl';

const BUTTONS: { tag: Tag; title: keyof Messages['editor']; key: string; icon: React.ReactNode }[] = [
  { tag: 'i', title: 'italic', key: 'I', icon: <span className={styles.iconItalic}>I</span> },
  { tag: 'strong', title: 'bold', key: 'B', icon: <span className={styles.iconBold}>B</span> },
  { tag: 'code', title: 'code', key: 'E', icon: <span className={styles.iconCode}>{'</>'}</span> },
  {
    tag: 'a',
    title: 'link',
    key: 'K',
    icon: (
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" aria-hidden>
        <path d="M10 13a5 5 0 0 0 7.5.5l3-3a5 5 0 0 0-7-7l-1.7 1.7" />
        <path d="M14 11a5 5 0 0 0-7.5-.5l-3 3a5 5 0 0 0 7 7l1.7-1.7" />
      </svg>
    ),
  },
];

const SHORTCUTS: Record<string, Tag> = { i: 'i', b: 'strong', e: 'code', k: 'a' };

const escapeAttr = (value: string) => value.trim().replace(/"/g, '&quot;');

// Textarea + панель разрешённых тегов: оборачивает выделение, ссылку вставляет через встроенную форму
export function CommentEditor({ value, error, rows, onChange }: Props) {
  const id = useId();
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const selectionRef = useRef<[number, number]>([0, 0]);
  const [link, setLink] = useState<{ href: string; title: string } | null>(null);
  const MOD = useSyncExternalStore(subscribeNoop, getModKey, getServerModKey);
  const { t } = useI18n();

  const insert = (open: string, close: string, range: [number, number]) => {
    const [start, end] = range;
    const selected = value.slice(start, end);
    onChange(value.slice(0, start) + open + selected + close + value.slice(end));

    requestAnimationFrame(() => {
      const textarea = textareaRef.current;
      if (!textarea) return;
      textarea.focus();
      const cursor = start + open.length;
      textarea.setSelectionRange(cursor, cursor + selected.length);
    });
  };

  const apply = (tag: Tag) => {
    const textarea = textareaRef.current;
    if (!textarea) return;
    const range: [number, number] = [textarea.selectionStart, textarea.selectionEnd];

    if (tag === 'a') {
      selectionRef.current = range;
      setLink({ href: 'https://', title: '' });
      return;
    }
    insert(`<${tag}>`, `</${tag}>`, range);
  };

  const insertLink = () => {
    if (!link) return;
    const href = escapeAttr(link.href);
    if (!/^https?:\/\/\S+$/i.test(href)) return;
    const title = escapeAttr(link.title);
    setLink(null);
    insert(`<a href="${href}"${title ? ` title="${title}"` : ''}>`, '</a>', selectionRef.current);
  };

  const onLinkKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      insertLink();
    }
    if (e.key === 'Escape') setLink(null);
  };

  const onKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (!(e.metaKey || e.ctrlKey)) return;
    const tag = SHORTCUTS[e.key.toLowerCase()];
    if (!tag) return;
    e.preventDefault();
    apply(tag);
  };

  const linkValid = link ? /^https?:\/\/\S+$/i.test(link.href.trim()) : false;
  const nearLimit = value.length > COMMENT_TEXT_MAX_LENGTH * 0.9;

  return (
    <div className={styles.field}>
      <label className={styles.label} htmlFor={id}>
        Text <em>*</em>
      </label>

      <div className={`${styles.editor} ${error ? styles.editorInvalid : ''}`}>
        <div className={styles.editorToolbar} role="toolbar" aria-label={t.editor.toolbar}>
          {BUTTONS.map((button) => {
            const title = t.editor[button.title] as string;
            return (
            <button
              key={button.tag}
              type="button"
              className={`${styles.toolButton} ${link && button.tag === 'a' ? styles.toolButtonActive : ''}`}
              title={`${title} · ${MOD}+${button.key}`}
              aria-label={title}
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => apply(button.tag)}
            >
              {button.icon}
            </button>
            );
          })}
          <span className={styles.toolbarHint}>a · code · i · strong</span>
        </div>

        {link && (
          <div className={styles.linkPanel}>
            <input
              className={styles.linkInput}
              value={link.href}
              onChange={(e) => setLink({ ...link, href: e.target.value })}
              onKeyDown={onLinkKeyDown}
              placeholder="https://example.com"
              aria-label={t.editor.linkUrl}
              autoFocus
            />
            <input
              className={styles.linkInput}
              value={link.title}
              onChange={(e) => setLink({ ...link, title: e.target.value })}
              onKeyDown={onLinkKeyDown}
              placeholder={t.editor.linkTitlePlaceholder}
              aria-label={t.editor.linkTitle}
            />
            <button type="button" className={styles.linkInsert} onClick={insertLink} disabled={!linkValid}>
              {t.editor.insert}
            </button>
            <button type="button" className={styles.link} onClick={() => setLink(null)}>
              {t.editor.cancel}
            </button>
          </div>
        )}

        <textarea
          id={id}
          ref={textareaRef}
          className={styles.editorTextarea}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          onKeyDown={onKeyDown}
          placeholder={t.editor.placeholder}
          maxLength={COMMENT_TEXT_MAX_LENGTH}
          rows={rows}
          aria-invalid={Boolean(error)}
        />

        <div className={styles.editorFooter}>
          <span>{t.editor.hint(MOD)}</span>
          <span className={nearLimit ? styles.counterWarn : ''}>
            {value.length} / {COMMENT_TEXT_MAX_LENGTH}
          </span>
        </div>
      </div>

      {error && <span className={styles.error}>{error}</span>}
    </div>
  );
}
