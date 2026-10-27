import { Comment } from '../models/comment.model';

export type CommentCreatedEvent = {
    comment: Comment;
};
