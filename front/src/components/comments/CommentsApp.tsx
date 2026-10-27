'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { api, ApiError } from '@/lib/api';
import { useI18n } from '@/lib/i18n';
import { getCommentsSocket } from '@/lib/socket';
import { withVoterToken } from '@/lib/voter';
import type { Comment, CommentList, SortBy, SortOrder, VoteCounters, VoteValue } from '@/types/comment';
import { Preferences } from '@/components/preferences/Preferences';
import { CommentForm } from './CommentForm';
import { CommentsTable } from './CommentsTable';
import { Pagination } from './Pagination';
import { SortMenu } from './SortMenu';
import { VotesContext } from './VotesContext';
import styles from './comments.module.css';

type Query = { page: number; sortBy: SortBy; sortOrder: SortOrder };

const DEFAULT_QUERY: Query = { page: 1, sortBy: 'createdAt', sortOrder: 'DESC' };
const SORT_FIELDS: SortBy[] = ['createdAt', 'userName', 'email', 'rating'];

function readQuery(): Query {
  const params = new URLSearchParams(window.location.search);
  const page = Number(params.get('page'));
  const sortBy = params.get('sortBy') as SortBy;
  const sortOrder = params.get('sortOrder') as SortOrder;
  return {
    page: Number.isInteger(page) && page > 0 ? page : 1,
    sortBy: SORT_FIELDS.includes(sortBy) ? sortBy : DEFAULT_QUERY.sortBy,
    sortOrder: sortOrder === 'ASC' || sortOrder === 'DESC' ? sortOrder : DEFAULT_QUERY.sortOrder,
  };
}

function writeQuery(query: Query) {
  const params = new URLSearchParams();
  if (query.page !== 1) params.set('page', String(query.page));
  if (query.sortBy !== DEFAULT_QUERY.sortBy) params.set('sortBy', query.sortBy);
  if (query.sortOrder !== DEFAULT_QUERY.sortOrder) params.set('sortOrder', query.sortOrder);
  const search = params.toString();
  window.history.replaceState(null, '', search ? `?${search}` : window.location.pathname);
}

// «Живой» режим — первая страница в порядке LIFO: новые заглавные комментарии можно вставлять сверху
const isLive = (query: Query) => query.page === 1 && query.sortBy === 'createdAt' && query.sortOrder === 'DESC';

function insertComment(list: CommentList, comment: Comment, live: boolean): CommentList {
  if (!comment.parentUuid) {
    if (!live || list.items.some((item) => item.uuid === comment.uuid)) return list;
    const items = [{ ...comment, replies: [] }, ...list.items].slice(0, list.pageSize);
    const total = list.total + 1;
    return { ...list, items, total, totalPages: Math.max(1, Math.ceil(total / list.pageSize)) };
  }

  return {
    ...list,
    items: list.items.map((item) =>
      item.uuid === comment.rootUuid && !item.replies.some((reply) => reply.uuid === comment.uuid)
        ? { ...item, replies: [...item.replies, comment] }
        : item,
    ),
  };
}

function updateCounters(list: CommentList, commentUuid: string, counters: Pick<VoteCounters, 'likesCount' | 'dislikesCount'>): CommentList {
  const patch = <T extends Comment>(comment: T): T =>
    comment.uuid === commentUuid ? { ...comment, likesCount: counters.likesCount, dislikesCount: counters.dislikesCount } : comment;
  return { ...list, items: list.items.map((item) => ({ ...patch(item), replies: item.replies.map(patch) })) };
}

// Сервер принимает не больше 1000 uuid за запрос, а на странице с длинными ветками их бывает больше
const MY_VOTES_BATCH = 1000;

function fetchMyVotes(uuids: string[]): Promise<Record<string, VoteValue>> {
  const batches = Array.from({ length: Math.ceil(uuids.length / MY_VOTES_BATCH) }, (_, i) => uuids.slice(i * MY_VOTES_BATCH, (i + 1) * MY_VOTES_BATCH));
  return withVoterToken((token) => Promise.all(batches.map((batch) => api.myVotes(token, batch)))).then((parts) => Object.assign({}, ...parts));
}

const allUuids = (list: CommentList) => list.items.flatMap((item) => [item.uuid, ...item.replies.map((reply) => reply.uuid)]);

function findComment(list: CommentList, uuid: string): Comment | undefined {
  for (const item of list.items) {
    if (item.uuid === uuid) return item;
    const reply = item.replies.find((r) => r.uuid === uuid);
    if (reply) return reply;
  }
}

export function CommentsApp() {
  const { t } = useI18n();
  const [query, setQuery] = useState<Query | null>(null);
  const [list, setList] = useState<CommentList | null>(null);
  const [loading, setLoading] = useState(true);
  // message — текст ошибки сервера (уже на языке запроса); без него показываем свой, переводимый при смене языка
  const [error, setError] = useState<{ message?: string } | null>(null);
  const [replyTo, setReplyTo] = useState<string | null>(null);
  const [pendingNew, setPendingNew] = useState(0);
  const [freshUuids, setFreshUuids] = useState<Set<string>>(new Set());
  const [connected, setConnected] = useState(false);
  const [myVotes, setMyVotes] = useState<Record<string, VoteValue>>({});
  const queryRef = useRef<Query | null>(null);
  const listRef = useRef<CommentList | null>(null);
  const myVotesRef = useRef(myVotes);
  // свой заглавный комментарий, отправленный не с «живой» страницы: Meilisearch может ещё не проиндексировать его к перезагрузке списка
  const ownPendingRef = useRef<Comment | null>(null);
  // номер последнего клика по каждому комментарию — ответы на более ранние клики игнорируются
  const voteSeqRef = useRef(new Map<string, number>());

  useEffect(() => {
    listRef.current = list;
    myVotesRef.current = myVotes;
  });

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- параметры страницы/сортировки живут в URL, читаем их после гидрации
    setQuery(readQuery());
  }, []);

  // loading/error сбрасываются здесь, а не в эффекте загрузки — смена запроса всегда идёт через эту функцию
  const changeQuery = useCallback((update: (prev: Query) => Query) => {
    setLoading(true);
    setError(null);
    setQuery((prev) => update(prev ?? DEFAULT_QUERY));
  }, []);

  const markFresh = useCallback((uuid: string) => {
    setFreshUuids((prev) => new Set(prev).add(uuid));
    setTimeout(
      () =>
        setFreshUuids((prev) => {
          const next = new Set(prev);
          next.delete(uuid);
          return next;
        }),
      2500,
    );
  }, []);

  useEffect(() => {
    if (!query) return;
    queryRef.current = query;
    writeQuery(query);

    let cancelled = false;
    api
      .getComments(query)
      .then((data) => {
        if (cancelled) return;
        const own = ownPendingRef.current;
        if (own && isLive(query)) {
          ownPendingRef.current = null;
          data = insertComment(data, own, true);
          markFresh(own.uuid);
        }
        setList(data);
        setPendingNew(0);
        // свои голоса не кешируются вместе со списком — запрашиваем отдельно
        const uuids = allUuids(data);
        if (uuids.length) {
          fetchMyVotes(uuids)
            .then((votes) => !cancelled && setMyVotes(votes))
            .catch(() => {});
        }
      })
      .catch((e) => !cancelled && setError({ message: e instanceof ApiError ? e.message : undefined }))
      .finally(() => !cancelled && setLoading(false));

    return () => {
      cancelled = true;
    };
  }, [query, markFresh]);

  const handleCreated = useCallback(
    (comment: Comment) => {
      const current = queryRef.current;
      if (!current) return;

      if (!comment.parentUuid && !isLive(current)) {
        ownPendingRef.current = comment;
        changeQuery(() => ({ ...DEFAULT_QUERY }));
        return;
      }
      setList((prev) => (prev ? insertComment(prev, comment, isLive(current)) : prev));
      markFresh(comment.uuid);
    },
    [markFresh, changeQuery],
  );

  useEffect(() => {
    const socket = getCommentsSocket();

    const onCreated = (comment: Comment) => {
      const current = queryRef.current;
      if (!current) return;
      if (!comment.parentUuid && !isLive(current)) {
        setPendingNew((count) => count + 1);
        return;
      }
      setList((prev) => (prev ? insertComment(prev, comment, isLive(current)) : prev));
      markFresh(comment.uuid);
    };
    const onVoted = ({ commentUuid, likesCount, dislikesCount }: VoteCounters & { commentUuid: string }) =>
      setList((prev) => (prev ? updateCounters(prev, commentUuid, { likesCount, dislikesCount }) : prev));
    // после обрыва связи события за это время потеряны — перечитываем текущую страницу
    let wasDisconnected = false;
    const onConnect = () => {
      setConnected(true);
      if (wasDisconnected && queryRef.current) changeQuery((prev) => ({ ...prev }));
      wasDisconnected = false;
    };
    const onDisconnect = () => {
      setConnected(false);
      wasDisconnected = true;
    };

    socket.on('comment_created', onCreated);
    socket.on('comment_voted', onVoted);
    socket.on('connect', onConnect);
    socket.on('disconnect', onDisconnect);
    if (socket.connected) onConnect();

    return () => {
      socket.off('comment_created', onCreated);
      socket.off('comment_voted', onVoted);
      socket.off('connect', onConnect);
      socket.off('disconnect', onDisconnect);
    };
  }, [markFresh, changeQuery]);

  const onSortChange = (sortBy: SortBy, sortOrder: SortOrder) => changeQuery(() => ({ page: 1, sortBy, sortOrder }));

  // Оптимистично меняем счётчики и свой голос, затем сверяемся с ответом сервера; при ошибке — откат.
  // Учитывается только ответ на последний клик; откат снимает свою дельту, не затирая пришедшее по сокету
  const vote = useCallback((commentUuid: string, value: VoteValue) => {
    const current = listRef.current && findComment(listRef.current, commentUuid);
    if (!current) return;
    const previous = myVotesRef.current[commentUuid] ?? 0;
    const delta = {
      likes: (value === 1 ? 1 : 0) - (previous === 1 ? 1 : 0),
      dislikes: (value === -1 ? 1 : 0) - (previous === -1 ? 1 : 0),
    };
    const shift = (sign: 1 | -1) => (prev: CommentList | null) => {
      const comment = prev && findComment(prev, commentUuid);
      return comment
        ? updateCounters(prev, commentUuid, {
            likesCount: Math.max(0, comment.likesCount + sign * delta.likes),
            dislikesCount: Math.max(0, comment.dislikesCount + sign * delta.dislikes),
          })
        : prev;
    };

    const seq = (voteSeqRef.current.get(commentUuid) ?? 0) + 1;
    voteSeqRef.current.set(commentUuid, seq);
    const isLatest = () => voteSeqRef.current.get(commentUuid) === seq;

    // ref обновляем сразу: следующий быстрый клик должен видеть этот голос, а не дожидаться рендера
    myVotesRef.current = { ...myVotesRef.current, [commentUuid]: value };
    setMyVotes((prev) => ({ ...prev, [commentUuid]: value }));
    setList(shift(1));

    withVoterToken((token) => api.vote(token, commentUuid, value))
      .then((result) => {
        if (!isLatest()) return;
        myVotesRef.current = { ...myVotesRef.current, [commentUuid]: result.myVote };
        setMyVotes((prev) => ({ ...prev, [commentUuid]: result.myVote }));
        setList((prev) => (prev ? updateCounters(prev, commentUuid, result) : prev));
      })
      .catch(() => {
        if (!isLatest()) return;
        myVotesRef.current = { ...myVotesRef.current, [commentUuid]: previous };
        setMyVotes((prev) => ({ ...prev, [commentUuid]: previous }));
        setList(shift(-1));
      });
  }, []);

  const onPage = (page: number) => {
    changeQuery((prev) => ({ ...prev, page }));
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  return (
    <>
      <header className={styles.topbar}>
        <div className={styles.topbarInner}>
          <div className={styles.brand}>
            <span className={styles.logo} aria-hidden>
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M21 12a8 8 0 0 1-11.6 7.1L4 20l1-4.6A8 8 0 1 1 21 12Z" />
              </svg>
            </span>
            <span className={styles.brandName}>Comments</span>
          </div>
          <div className={styles.topbarActions}>
            <Preferences />
            <span className={`${styles.live} ${connected ? styles.liveOn : ''}`}>{connected ? 'Live' : 'Offline'}</span>
          </div>
        </div>
      </header>

    <main className={styles.page}>
      <section className={styles.hero}>
        <h1>{t.app.heroTitle}</h1>
        <p>{t.app.heroText}</p>
        <div className={styles.stats}>
          <span>
            <strong>{list?.total ?? '—'}</strong> {t.app.discussions}
          </span>
          <span>
            <strong>{list ? list.items.reduce((sum, item) => sum + item.replies.length, 0) : '—'}</strong> {t.app.repliesOnPage}
          </span>
        </div>
      </section>

      <section className={styles.card}>
        <div className={styles.cardHead}>
          <h2 className={styles.cardTitle}>{t.app.newComment}</h2>
          <span className={styles.muted}>{t.app.requiredHint}</span>
        </div>
        <CommentForm onCreated={handleCreated} />
      </section>

      {pendingNew > 0 && (
        <button type="button" className={styles.banner} onClick={() => changeQuery(() => ({ ...DEFAULT_QUERY }))}>
          {t.app.pendingNew(pendingNew)}
        </button>
      )}

      <section className={`${styles.card} ${styles.listCard}`}>
        <div className={`${styles.cardHead} ${styles.listHead}`}>
          <h2 className={styles.cardTitle}>
            {t.app.allComments} {list && <span className={styles.countBadge}>{list.total}</span>}
          </h2>
          {query && <SortMenu sortBy={query.sortBy} sortOrder={query.sortOrder} onChange={onSortChange} />}
        </div>
        {error && <div className={styles.alert}>{error.message ?? t.app.loadFailed}</div>}
        {list && list.items.length > 0 && query && (
          <VotesContext.Provider value={{ myVotes, vote }}>
          <div className={loading ? styles.loading : ''}>
            <CommentsTable
              items={list.items}
              sortBy={query.sortBy}
              sortOrder={query.sortOrder}
              replyTo={replyTo}
              freshUuids={freshUuids}
              onReply={setReplyTo}
              onCreated={handleCreated}
            />
            <Pagination page={list.page} totalPages={list.totalPages} onChange={onPage} />
          </div>
          </VotesContext.Provider>
        )}
        {list && list.items.length === 0 && !loading && <p className={styles.empty}>{t.app.empty}</p>}
        {!list && loading && <p className={styles.empty}>{t.app.loading}</p>}
      </section>
    </main>
    </>
  );
}
