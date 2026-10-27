import { Module } from '@nestjs/common';
import { SequelizeModule } from '@nestjs/sequelize';
import { Comment } from '../comment/models/comment.model';
import { ClientCommentErrorRepository } from './repositories/client.comment-error.repository';
import { ClientCommentErrorService } from './services/client.comment-error.service';

@Module({
    imports: [SequelizeModule.forFeature([Comment])],
    providers: [ClientCommentErrorService, ClientCommentErrorRepository],
    exports: [ClientCommentErrorService],
})
export class CommentErrorModule {}
