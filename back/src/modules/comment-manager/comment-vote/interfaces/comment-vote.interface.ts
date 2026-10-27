import { ValueCommentVoteEnum } from '../enums/value-comment-vote.enum';

export interface ICommentVoteAttrs {
    commentUuid: string;
    voterId: string;
    value: ValueCommentVoteEnum;
}
