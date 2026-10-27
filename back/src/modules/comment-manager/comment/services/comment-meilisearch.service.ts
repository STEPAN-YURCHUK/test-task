import { Injectable, Logger, OnApplicationBootstrap } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { MeiliIndexEnum } from 'src/infrastructure/meilisearch/enums/meili-index.enum';
import { MeiliSearchService } from 'src/infrastructure/meilisearch/services/meilisearch.service';
import { COMMENT_VOTE_EVENTS } from '../../comment-vote/constants/comment-vote-events.const';
import { CommentVotedEvent } from '../../comment-vote/types/comment-voted-event.type';
import { COMMENT_EVENTS } from '../constants/comment.const';
import { SortFieldCommentEnum } from '../enums/sort-field-comment.enum';
import { Comment } from '../models/comment.model';
import { ClientCommentRepository } from '../repositories/client.comment.repository';
import { ClientFindAllCommentsData } from '../types/client.find-all-comments-data.type';
import { CommentCreatedEvent } from '../types/comment-created-event.type';
import { CommentMeilisearchDocument } from '../types/comment-meilisearch-document.type';

const REINDEX_BATCH = 1000;
const MAX_THREAD_REPLIES = 100_000;

const SORT_ATTRIBUTE: Record<SortFieldCommentEnum, string> = {
    [SortFieldCommentEnum.CREATED_AT]: 'createdAtTs',
    [SortFieldCommentEnum.USER_NAME]: 'userNameSort',
    [SortFieldCommentEnum.EMAIL]: 'emailSort',
    [SortFieldCommentEnum.RATING]: 'rating',
};

// Meilisearch — read-model списка комментариев вместо кеша страниц в Redis.
// Запись идёт только в Postgres, индекс догоняет по доменным событиям (создание, голос).
@Injectable()
export class CommentMeilisearchService implements OnApplicationBootstrap {
    private readonly logger = new Logger(CommentMeilisearchService.name);

    constructor(
        private readonly meiliSearchService: MeiliSearchService,
        private readonly clientCommentRepository: ClientCommentRepository,
    ) {}

    // пустой индекс (первый запуск, сброс тома) или MEILI_REINDEX_ON_START=true → полная переиндексация из Postgres
    async onApplicationBootstrap() {
        try {
            const count = await this.meiliSearchService.countDocuments(MeiliIndexEnum.COMMENT);
            if (count === 0 || process.env.MEILI_REINDEX_ON_START === 'true') {
                this.reindexAll().catch((err) => this.logger.error(`Reindex failed: ${err?.message ?? err}`));
            }
        } catch (err) {
            this.logger.warn(`Meilisearch unavailable on start: ${err?.message ?? err}`);
        }
    }

    async reindexAll(): Promise<void> {
        this.logger.log('Reindexing comments into Meilisearch...');
        let afterUuid: string | null = null;
        let total = 0;

        for (;;) {
            const batch = await this.clientCommentRepository.findAllForMeilisearch(afterUuid, REINDEX_BATCH);
            if (!batch.length) break;

            await this.meiliSearchService.add(
                MeiliIndexEnum.COMMENT,
                batch.map((comment) => this.toDocument(comment)),
            );
            total += batch.length;
            afterUuid = batch[batch.length - 1].uuid;
        }

        this.logger.log(`Reindex queued: ${total} comments`);
    }

    @OnEvent(COMMENT_EVENTS.CREATED)
    async handleCommentCreated({ comment }: CommentCreatedEvent) {
        const document = this.toDocument(comment);
        // ждём индексации: поиск документов автора должен видеть и прежние его комментарии, поставленные раньше
        await this.safely('add', () => this.meiliSearchService.addAndWait(MeiliIndexEnum.COMMENT, document));
        await this.safely('author sync', () => this.syncAuthor(document));
    }

    // Автор хранится в каждом документе копией. Новый комментарий мог обновить Home page автора
    // (upsert по email + имени) — переносим её во все его документы, как это видно и через Postgres.
    // Данные автора берём из Postgres заново: обработчик соседнего комментария мог отстать и нести устаревшие
    private async syncAuthor({ uuid, userUuid }: CommentMeilisearchDocument) {
        if (!userUuid) return;
        const fresh = await this.clientCommentRepository.findOne(uuid);
        if (!fresh) return;
        const { user } = this.toDocument(fresh);

        const { hits } = await this.meiliSearchService.search(MeiliIndexEnum.COMMENT, '', {
            filter: `userUuid = "${userUuid}"`,
            attributesToRetrieve: ['uuid', 'user'],
            limit: MAX_THREAD_REPLIES,
        });
        const stale = hits.filter((hit) => hit.user?.homePage !== user.homePage);
        if (stale.length) {
            await this.meiliSearchService.update(
                MeiliIndexEnum.COMMENT,
                stale.map((hit) => ({ uuid: hit.uuid, user })),
            );
        }
    }

    @OnEvent(COMMENT_VOTE_EVENTS.VOTED)
    async handleVoted({ commentUuid, likesCount, dislikesCount, rating }: CommentVotedEvent) {
        await this.safely('vote update', () =>
            this.meiliSearchService.update(MeiliIndexEnum.COMMENT, { uuid: commentUuid, likesCount, dislikesCount, rating }),
        );
    }

    // Страница заглавных + все ответы их веток — та же форма, что отдаёт Postgres-путь
    async findAll(data: ClientFindAllCommentsData) {
        const page = Math.floor(data.offset / data.limit) + 1;
        const sort = [`${SORT_ATTRIBUTE[data.sortBy]}:${data.sortOrder.toLowerCase()}`];
        if (data.sortBy !== SortFieldCommentEnum.CREATED_AT) sort.push('createdAtTs:desc');

        const roots = await this.meiliSearchService.search(MeiliIndexEnum.COMMENT, '', {
            filter: 'isRoot = true',
            sort,
            page,
            hitsPerPage: data.limit,
        });

        const rootUuids = roots.hits.map((hit) => hit.uuid as string);
        const replies = rootUuids.length
            ? await this.meiliSearchService.search(MeiliIndexEnum.COMMENT, '', {
                  // uuid'ы взяты из ответа самого индекса, не из запроса пользователя
                  filter: `rootUuid IN [${rootUuids.map((uuid) => `"${uuid}"`).join(', ')}]`,
                  sort: ['createdAtTs:asc'],
                  limit: MAX_THREAD_REPLIES,
              })
            : { hits: [] };

        return { rows: roots.hits, count: roots.totalHits ?? 0, replies: replies.hits };
    }

    private toDocument(comment: Comment): CommentMeilisearchDocument {
        const json: any = typeof comment.toJSON === 'function' ? comment.toJSON() : comment;
        const createdAt = new Date(json.createdAt);

        return {
            uuid: json.uuid,
            parentUuid: json.parentUuid ?? null,
            rootUuid: json.rootUuid ?? null,
            isRoot: !json.parentUuid,
            text: json.text,
            likesCount: json.likesCount ?? 0,
            dislikesCount: json.dislikesCount ?? 0,
            rating: json.rating ?? 0,
            createdAt: createdAt.toISOString(),
            createdAtTs: createdAt.getTime(),
            userNameSort: json.user.userName.toLowerCase(),
            emailSort: json.user.email.toLowerCase(),
            userUuid: json.user.uuid ?? json.userUuid ?? null,
            user: { userName: json.user.userName, email: json.user.email, homePage: json.user.homePage ?? null },
            file: json.file ?? null,
        };
    }

    private async safely(operation: string, fn: () => Promise<unknown>) {
        try {
            await fn();
        } catch (err) {
            this.logger.error(`Meilisearch ${operation} failed: ${err?.message ?? err}`);
        }
    }
}
