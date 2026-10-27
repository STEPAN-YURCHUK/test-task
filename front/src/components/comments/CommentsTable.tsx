'use client';

import { useMemo } from 'react';
import { useI18n } from '@/lib/i18n';
import type { Comment, SortBy, SortOrder, TopLevelComment } from '@/types/comment';
import { AuthorBlock, CommentThread, TimeAgo } from './CommentThread';
import { commentDomId } from './jumpToComment';
import styles from './comments.module.css';

type Props = {
  items: TopLevelComment[];
  sortBy: SortBy;
  sortOrder: SortOrder;
  replyTo: string | null;
  freshUuids: Set<string>;
  onReply: (uuid: string | null) => void;
  onCreated: (comment: Comment) => void;
};


function groupByParent(replies: Comment[]) {
  const map = new Map<string, Comment[]>();
  for (const reply of replies) {
    if (!reply.parentUuid) continue;
    const list = map.get(reply.parentUuid) ?? [];
    list.push(reply);
    map.set(reply.parentUuid, list);
  }
  return map;
}

// Таблица заглавных комментариев (требование ТЗ): каждый комментарий — отдельный <tbody>-карточка
export function CommentsTable({ items, sortBy, sortOrder, replyTo, freshUuids, onReply, onCreated }: Props) {
  const trees = useMemo(() => new Map(items.map((item) => [item.uuid, groupByParent(item.replies)])), [items]);
  const { t } = useI18n();
  const columns: { field: SortBy; label: string }[] = [
    { field: 'userName', label: 'User Name' },
    { field: 'email', label: 'E-mail' },
    { field: 'createdAt', label: t.table.date },
  ];
  const byUuid = useMemo(() => new Map(items.flatMap((item) => [item, ...item.replies]).map((c) => [c.uuid, c as Comment])), [items]);

  return (
    <table className={styles.table}>
      {/* Колонки таблицы остаются для доступности; сортировка — в SortMenu над списком */}
      <thead className={styles.visuallyHidden}>
        <tr>
          {columns.map(({ field, label }) => (
            <th key={field} scope="col" aria-sort={sortBy === field ? (sortOrder === 'ASC' ? 'ascending' : 'descending') : 'none'}>
              {label}
            </th>
          ))}
        </tr>
      </thead>

      {items.map((item) => (
        <tbody key={item.uuid} id={commentDomId(item.uuid)} tabIndex={-1} className={`${styles.entry} ${freshUuids.has(item.uuid) ? styles.fresh : ''}`}>
          <tr className={styles.entryHead}>
            <td className={styles.authorCell}>
              <AuthorBlock comment={item} hideEmailFromA11y />
            </td>
            {/* колонка E-mail для семантики таблицы; визуально e-mail показан под именем */}
            <td className={styles.visuallyHidden}>{item.user.email}</td>
            <td className={styles.date}>
              <TimeAgo iso={item.createdAt} />
            </td>
          </tr>
          <tr className={styles.entryBody}>
            <td colSpan={3}>
              <CommentThread
                comment={item}
                childrenByParent={trees.get(item.uuid) ?? new Map()}
                depth={0}
                replyTo={replyTo}
                freshUuids={freshUuids}
                onReply={onReply}
                onCreated={onCreated}
                byUuid={byUuid}
                isRoot
              />
            </td>
          </tr>
        </tbody>
      ))}
    </table>
  );
}
