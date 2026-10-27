import { Module } from '@nestjs/common';
import { SequelizeModule } from '@nestjs/sequelize';
import { CaptchaModule } from 'src/modules/captcha-manager/captcha/captcha.module';
import { UserModule } from 'src/modules/user-manager/user/user.module';
import { CommentErrorModule } from '../comment-error/comment-error.module';
import { ClientCommentController } from './controllers/client.comment.controller';
import { ClientCommentGateway } from './gateways/client.comment.gateway';
import { TransformResponseClientCommentInterceptor } from './interceptors/client.comment.interceptor';
import { Comment } from './models/comment.model';
import { ClientCommentRepository } from './repositories/client.comment.repository';
import { CommentMeilisearchService } from './services/comment-meilisearch.service';
import { ClientCommentService } from './services/client.comment.service';

@Module({
    imports: [SequelizeModule.forFeature([Comment]), CommentErrorModule, CaptchaModule, UserModule],
    controllers: [ClientCommentController],
    providers: [
        ClientCommentService,
        ClientCommentRepository,
        CommentMeilisearchService,
        ClientCommentGateway,
        TransformResponseClientCommentInterceptor,
    ],
})
export class CommentModule {}
