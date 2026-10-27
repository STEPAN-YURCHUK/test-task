'use client';

import { useI18n } from '@/lib/i18n';
import type { Comment } from '@/types/comment';
import { useVotes } from './VotesContext';
import styles from './comments.module.css';

const Thumb = ({ down }: { down?: boolean }) => (
  <svg
    width="15"
    height="15"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
    style={down ? { transform: 'scaleY(-1)' } : undefined}
    aria-hidden
  >
    <path d="M7 10v11H4a1 1 0 0 1-1-1v-9a1 1 0 0 1 1-1h3Z" />
    <path d="M7 10l4.5-7.2a1.9 1.9 0 0 1 3.4 1.5L14 9h5.2a2 2 0 0 1 2 2.4l-1.6 7.6a2 2 0 0 1-2 1.6H7" />
  </svg>
);

// Лайк / дизлайк: повторный клик по активной кнопке снимает голос
export function VoteControl({ comment, compact = false }: { comment: Comment; compact?: boolean }) {
  const { myVotes, vote } = useVotes();
  const { t } = useI18n();
  const mine = myVotes[comment.uuid] ?? 0;

  return (
    <div className={`${styles.votes} ${compact ? styles.votesCompact : ''}`} role="group" aria-label={t.votes.group}>
      <button
        type="button"
        className={`${styles.voteButton} ${mine === 1 ? styles.voteLiked : ''}`}
        onClick={() => vote(comment.uuid, mine === 1 ? 0 : 1)}
        aria-pressed={mine === 1}
        title={t.votes.like}
      >
        <Thumb />
        <span key={comment.likesCount} className={styles.voteCount}>
          {comment.likesCount}
        </span>
      </button>
      <span className={styles.voteDivider} aria-hidden />
      <button
        type="button"
        className={`${styles.voteButton} ${mine === -1 ? styles.voteDisliked : ''}`}
        onClick={() => vote(comment.uuid, mine === -1 ? 0 : -1)}
        aria-pressed={mine === -1}
        title={t.votes.dislike}
      >
        <Thumb down />
        <span key={comment.dislikesCount} className={styles.voteCount}>
          {comment.dislikesCount}
        </span>
      </button>
    </div>
  );
}
