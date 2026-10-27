import { Module } from '@nestjs/common';
import { CommentErrorModule } from './comment-error/comment-error.module';
import { CommentVoteModule } from './comment-vote/comment-vote.module';
import { CommentModule } from './comment/comment.module';

@Module({
    imports: [CommentModule, CommentErrorModule, CommentVoteModule],
})
export class CommentManagerModule {}
