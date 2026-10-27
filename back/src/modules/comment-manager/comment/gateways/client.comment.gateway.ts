import { Logger } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { OnGatewayConnection, OnGatewayDisconnect, WebSocketGateway, WebSocketServer } from '@nestjs/websockets';
import { Server, Socket } from 'socket.io';
import { COMMENT_VOTE_EVENTS } from '../../comment-vote/constants/comment-vote-events.const';
import { CommentVotedEvent } from '../../comment-vote/types/comment-voted-event.type';
import { COMMENT_EVENTS } from '../constants/comment.const';
import { TransformResponseClientCommentInterceptor } from '../interceptors/client.comment.interceptor';
import { CommentCreatedEvent } from '../types/comment-created-event.type';

// Публичная лента: только server → client пуши, клиент ничего не шлёт. Работает на том же порту, что и HTTP.
@WebSocketGateway({
    namespace: '/comments',
    cors: { origin: (process.env.CORS_ORIGINS || 'http://localhost:3000').split(',') },
    pingInterval: 10000,
    pingTimeout: 15000,
})
export class ClientCommentGateway implements OnGatewayConnection, OnGatewayDisconnect {
    private readonly logger = new Logger(ClientCommentGateway.name);

    @WebSocketServer()
    server: Server;

    constructor(private readonly transformResponseClientCommentInterceptor: TransformResponseClientCommentInterceptor) {}

    handleConnection(socket: Socket) {
        this.logger.debug(`Socket connected: ${socket.id}`);
    }

    handleDisconnect(socket: Socket) {
        this.logger.debug(`Socket disconnected: ${socket.id}`);
    }

    @OnEvent(COMMENT_EVENTS.CREATED)
    handleCommentCreated({ comment }: CommentCreatedEvent) {
        this.server.emit('comment_created', this.transformResponseClientCommentInterceptor.transform(comment));
    }

    @OnEvent(COMMENT_VOTE_EVENTS.VOTED)
    handleCommentVoted(event: CommentVotedEvent) {
        this.server.emit('comment_voted', event);
    }
}
