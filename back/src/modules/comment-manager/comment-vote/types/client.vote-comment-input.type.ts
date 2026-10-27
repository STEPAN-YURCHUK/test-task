export type ClientVoteCommentInput = {
    commentUuid: string;
    voterId: string;
    value: 1 | -1 | 0;
};
