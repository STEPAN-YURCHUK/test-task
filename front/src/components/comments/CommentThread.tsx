'use client';

import { useState } from 'react';
import { toSafeHtml } from '@/lib/comment-html';
import { formatDate, formatRelative } from '@/lib/format';
import { useI18n } from '@/lib/i18n';
import type { Comment } from '@/types/comment';
import { Attachment } from './Attachment';
import { Avatar } from './Avatar';
import { CommentForm } from './CommentForm';
import { commentDomId, jumpToComment } from './jumpToComment';
import { VoteControl } from './VoteControl';
import styles from './comments.module.css';

type Props = {
  comment: Comment;
  childrenByParent: Map<string, Comment[]>;
  depth: number;
  replyTo: string | null;
  freshUuids: Set<string>;
  onReply: (uuid: string | null) => void;
  onCreated: (comment: Comment) => void;
  byUuid: Map<string, Comment>;
  isRoot?: boolean;
  flat?: boolean;
};

// До этой глубины ответы вкладываются; глубже вся ветка идёт плоским списком с пометкой «в ответ …»
const MAX_NEST_DEPTH = 2;
const FLAT_PAGE = 10;

// Все потомки в порядке обхода в глубину — без рекурсии, чтобы ветка в 1000 уровней не упиралась в стек
function collectDescendants(uuid: string, childrenByParent: Map<string, Comment[]>): Comment[] {
  const result: Comment[] = [];
  const stack = [...(childrenByParent.get(uuid) ?? [])].reverse();
  while (stack.length) {
    const next = stack.pop()!;
    result.push(next);
    const kids = childrenByParent.get(next.uuid);
    if (kids) for (let i = kids.length - 1; i >= 0; i--) stack.push(kids[i]);
  }
  return result;
}

type FlatRepliesProps = Omit<Props, 'comment' | 'depth' | 'isRoot' | 'flat'> & { items: Comment[] };

function FlatReplies({ items, ...rest }: FlatRepliesProps) {
  const [visible, setVisible] = useState(FLAT_PAGE);
  const { t } = useI18n();
  const hidden = items.length - visible;

  return (
    <div className={`${styles.children} ${styles.flat}`}>
      {items.slice(0, visible).map((item) => (
        <CommentThread key={item.uuid} comment={item} depth={MAX_NEST_DEPTH} flat {...rest} />
      ))}
      {hidden > 0 && (
        <div className={styles.moreReplies}>
          <button type="button" className={styles.secondary} onClick={() => setVisible((v) => v + FLAT_PAGE)}>
            {t.thread.showMore(Math.min(FLAT_PAGE, hidden))}
          </button>
          <button type="button" className={styles.link} onClick={() => setVisible(items.length)}>
            {t.thread.showAll(hidden)}
          </button>
        </div>
      )}
    </div>
  );
}

function siteHost(url: string): string {
  try {
    return new URL(url).host.replace(/^www\./, '');
  } catch {
    return url;
  }
}

// Аватар + имя (с чипом сайта, если указан Home page) + e-mail строкой ниже
export function AuthorBlock({ comment, size = 'md', hideEmailFromA11y = false }: { comment: Comment; size?: 'sm' | 'md'; hideEmailFromA11y?: boolean }) {
  const { userName, email, homePage } = comment.user;
  return (
    <div className={`${styles.author} ${size === 'sm' ? styles.authorSm : ''}`}>
      <Avatar name={userName} size={size} />
      <div className={styles.authorText}>
        <div className={styles.authorLine}>
          <span className={styles.userName}>{userName}</span>
          {homePage && (
            <a className={styles.siteChip} href={homePage} target="_blank" rel="nofollow noopener noreferrer ugc" title={homePage}>
              {siteHost(homePage)}
              <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" aria-hidden>
                <path d="M7 17 17 7M9 7h8v8" />
              </svg>
            </a>
          )}
        </div>
        <span className={styles.authorEmail} aria-hidden={hideEmailFromA11y || undefined}>
          {email}
        </span>
      </div>
    </div>
  );
}

export function TimeAgo({ iso }: { iso: string }) {
  const { t } = useI18n();
  return (
    <time className={styles.time} dateTime={iso} title={formatDate(iso, t.format)}>
      <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden>
        <circle cx="12" cy="12" r="9" />
        <path d="M12 7v5l3 2" />
      </svg>
      {formatRelative(iso, t.format)}
    </time>
  );
}

// Каскад: тело комментария + рекурсивно все ответы. У заглавного шапку рисует строка таблицы.
export function CommentThread({ comment, childrenByParent, depth, replyTo, freshUuids, onReply, onCreated, byUuid, isRoot = false, flat = false }: Props) {
  const children = childrenByParent.get(comment.uuid) ?? [];
  const replying = replyTo === comment.uuid;
  const { t } = useI18n();

  const body = (
    <>
      <div className={`${styles.text} ${isRoot ? styles.textRoot : styles.bubble}`} dangerouslySetInnerHTML={{ __html: toSafeHtml(comment.text) }} />

      {comment.file && <Attachment file={comment.file} />}

      <div className={`${styles.commentActions} ${isRoot ? styles.commentActionsRoot : ''}`}>
        <VoteControl comment={comment} compact={!isRoot} />
        <button type="button" className={`${styles.actionButton} ${replying ? styles.actionButtonActive : ''}`} onClick={() => onReply(replying ? null : comment.uuid)}>
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden>
            <path d="M9 14 4 9l5-5" />
            <path d="M4 9h10a6 6 0 0 1 6 6v5" />
          </svg>
          {replying ? t.thread.cancelReply : t.thread.reply}
        </button>
        {children.length > 0 && (
          <span className={styles.replyCount}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
              <path d="M21 12a8 8 0 0 1-11.6 7.1L4 20l1-4.6A8 8 0 1 1 21 12Z" />
            </svg>
            {t.thread.replies(children.length)}
          </span>
        )}
      </div>

      {replying && (
        <CommentForm
          parentUuid={comment.uuid}
          onCancel={() => onReply(null)}
          onCreated={(created) => {
            onReply(null);
            onCreated(created);
          }}
        />
      )}

      {children.length > 0 && !flat && depth + 1 < MAX_NEST_DEPTH && (
        <div className={styles.children}>
          {children.map((child) => (
            <CommentThread
              key={child.uuid}
              comment={child}
              childrenByParent={childrenByParent}
              depth={depth + 1}
              replyTo={replyTo}
              freshUuids={freshUuids}
              onReply={onReply}
              onCreated={onCreated}
              byUuid={byUuid}
            />
          ))}
        </div>
      )}

      {children.length > 0 && !flat && depth + 1 >= MAX_NEST_DEPTH && (
        <FlatReplies
          items={collectDescendants(comment.uuid, childrenByParent)}
          childrenByParent={childrenByParent}
          replyTo={replyTo}
          freshUuids={freshUuids}
          onReply={onReply}
          onCreated={onCreated}
          byUuid={byUuid}
        />
      )}
    </>
  );

  if (isRoot) return <div className={styles.rootBody}>{body}</div>;

  return (
    <article id={commentDomId(comment.uuid)} tabIndex={-1} className={`${styles.reply} ${freshUuids.has(comment.uuid) ? styles.fresh : ''}`}>
      <div className={styles.replyMain}>
        <header className={styles.replyMeta}>
          <AuthorBlock comment={comment} size="sm" />
          <TimeAgo iso={comment.createdAt} />
        </header>
        {comment.parentUuid && byUuid.get(comment.parentUuid) && (
          // клик — прокрутка к комментарию, на который это ответ, и короткая подсветка
          <button
            type="button"
            className={styles.replyTo}
            onClick={() => jumpToComment(comment.parentUuid!)}
            title={t.thread.replyToTitle}
          >
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" aria-hidden>
              <path d="M4 4v7a4 4 0 0 0 4 4h12m0 0-4-4m4 4-4 4" />
            </svg>
            {t.thread.replyTo} <strong>{byUuid.get(comment.parentUuid)!.user.userName}</strong>
          </button>
        )}
        {body}
      </div>
    </article>
  );
}
