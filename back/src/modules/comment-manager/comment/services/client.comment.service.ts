import { HttpException, HttpStatus, Injectable, Logger } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { DatabaseService } from 'src/infrastructure/database/services/database.service';
import { DisposableEmailService } from 'src/infrastructure/disposable-email/services/disposable-email.service';
import { ClientCaptchaService } from 'src/modules/captcha-manager/captcha/services/client.captcha.service';
import { ClientUserRepository } from 'src/modules/user-manager/user/repositories/client.user.repository';
import { sanitizeCommentHtml } from 'src/shared/utils/comment-html.util';
import { ClientFileService } from 'src/shared/file/services/client.file.service';
import { ClientCommentErrorService } from '../../comment-error/services/client.comment-error.service';
import { COMMENT_EVENTS, COMMENTS_PAGE_SIZE } from '../constants/comment.const';
import { ClientCommentRepository } from '../repositories/client.comment.repository';
import { ClientCommentList } from '../types/client.comment-list.type';
import { ClientCreateCommentInput } from '../types/client.create-comment-input.type';
import { ClientFindAllCommentsInput } from '../types/client.find-all-comments-input.type';
import { CommentCreatedEvent } from '../types/comment-created-event.type';
import { ClientFindAllCommentsData } from '../types/client.find-all-comments-data.type';
import { CommentMeilisearchService } from './comment-meilisearch.service';

@Injectable()
export class ClientCommentService {
    private readonly logger = new Logger(ClientCommentService.name);

    constructor(
        private readonly clientCommentRepository: ClientCommentRepository,
        private readonly clientCommentErrorService: ClientCommentErrorService,
        private readonly clientFileService: ClientFileService,
        private readonly commentMeilisearchService: CommentMeilisearchService,
        private readonly clientCaptchaService: ClientCaptchaService,
        private readonly clientUserRepository: ClientUserRepository,
        private readonly databaseService: DatabaseService,
        private readonly disposableEmailService: DisposableEmailService,
        private readonly eventEmitter: EventEmitter2,
    ) {}

    // Список читается из Meilisearch (read-model); если он недоступен — из Postgres
    async findAll(input: ClientFindAllCommentsInput): Promise<ClientCommentList> {
        const data: ClientFindAllCommentsData = {
            limit: COMMENTS_PAGE_SIZE,
            offset: (input.page - 1) * COMMENTS_PAGE_SIZE,
            sortBy: input.sortBy,
            sortOrder: input.sortOrder,
        };

        let source: { rows: Record<string, any>[]; count: number; replies: Record<string, any>[] };
        try {
            source = await this.commentMeilisearchService.findAll(data);
        } catch (err) {
            this.logger.warn(`Meilisearch unavailable, reading from Postgres: ${err?.message ?? err}`);
            const { rows, count } = await this.clientCommentRepository.findAllTopLevel(data);
            const replies = await this.clientCommentRepository.findAllByRootUuids(rows.map((row) => row.uuid));
            source = { rows: rows.map((row) => row.toJSON()), count, replies: replies.map((reply) => reply.toJSON()) };
        }

        const repliesByRoot = new Map<string, Record<string, any>[]>();
        for (const reply of source.replies) {
            const list = repliesByRoot.get(reply.rootUuid) ?? [];
            list.push(reply);
            repliesByRoot.set(reply.rootUuid, list);
        }

        return {
            items: source.rows.map((row) => ({ ...row, replies: repliesByRoot.get(row.uuid) ?? [] })),
            total: source.count,
            page: input.page,
            pageSize: COMMENTS_PAGE_SIZE,
            totalPages: Math.max(1, Math.ceil(source.count / COMMENTS_PAGE_SIZE)),
        };
    }

    async findOne(commentUuid: string) {
        await this.clientCommentErrorService.checkExists(commentUuid);

        return await this.clientCommentRepository.findOne(commentUuid);
    }

    preview(text: string) {
        return { html: sanitizeCommentHtml(text) };
    }

    async create(input: ClientCreateCommentInput) {
        if (input.file && input.uploadId) throw new HttpException('conflicting_file_sources', HttpStatus.BAD_REQUEST);
        // до капчи: токен капчи одноразовый, не тратим его на заведомо отклонённый адрес
        this.disposableEmailService.checkNotDisposableOrThrow(input.email);

        await this.clientCaptchaService.verify({ token: input.captchaToken, answer: input.captcha });

        const text = sanitizeCommentHtml(input.text);
        let finishUpload: ((attached: boolean) => Promise<void>) | null = null;

        let commentUuid: string;
        try {
            commentUuid = await this.databaseService.withTransaction({}, async (trx) => {
                let rootUuid: string | null = null;

                if (input.parentUuid) {
                    await this.clientCommentErrorService.checkParentExists(input.parentUuid, trx);
                    const parent = await this.clientCommentRepository.findOneForReply(input.parentUuid, trx);
                    rootUuid = parent.rootUuid ?? parent.uuid;
                }

                // homePage не передан — оставляем ранее сохранённый
                const user = await this.clientUserRepository.upsert(
                    { userName: input.userName, email: input.email.toLowerCase(), ...(input.homePage ? { homePage: input.homePage } : {}) },
                    trx,
                );

                const comment = await this.clientCommentRepository.create(
                    {
                        userUuid: user.uuid,
                        parentUuid: input.parentUuid ?? null,
                        rootUuid,
                        text,
                        ipAddress: input.ipAddress ?? null,
                        userAgent: input.userAgent?.slice(0, 512) ?? null,
                    },
                    trx,
                );

                const fileRef = { modelUuid: comment.uuid, modelType: 'comments', modelColumn: 'file' };
                if (input.file) await this.clientFileService.upload(input.file, fileRef, trx);
                if (input.uploadId) finishUpload = (await this.clientFileService.attachUploaded(input.uploadId, fileRef, trx)).finish;

                return comment.uuid;
            });
        } catch (err) {
            await finishUpload?.(false);
            throw err;
        }

        // сессия загрузки одноразовая: после коммита её больше нельзя прикрепить
        await finishUpload?.(true);

        const comment = await this.clientCommentRepository.findOne(commentUuid);
        this.eventEmitter.emit(COMMENT_EVENTS.CREATED, { comment } satisfies CommentCreatedEvent);

        return comment;
    }
}
