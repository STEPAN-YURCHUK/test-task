import { ClientCommentVoteCounters } from './client.comment-vote-counters.type';

export type CommentVotedEvent = ClientCommentVoteCounters & {
    commentUuid: string;
};
