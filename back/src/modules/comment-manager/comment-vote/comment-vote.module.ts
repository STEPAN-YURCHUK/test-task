import { Module } from '@nestjs/common';
import { SequelizeModule } from '@nestjs/sequelize';
import { Comment } from '../comment/models/comment.model';
import { CommentErrorModule } from '../comment-error/comment-error.module';
import { ClientCommentVoteController } from './controllers/client.comment-vote.controller';
import { VoterAuthGuard } from './guards/voter-auth.guard';
import { CommentVote } from './models/comment-vote.model';
import { ClientCommentVoteRepository } from './repositories/client.comment-vote.repository';
import { ClientCommentVoteService } from './services/client.comment-vote.service';

@Module({
    imports: [SequelizeModule.forFeature([CommentVote, Comment]), CommentErrorModule],
    controllers: [ClientCommentVoteController],
    providers: [ClientCommentVoteService, ClientCommentVoteRepository, VoterAuthGuard],
})
export class CommentVoteModule {}
