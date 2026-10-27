import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/sequelize';
import { col, fn, Includeable, Op, Order, Transaction } from 'sequelize';
import { User } from 'src/modules/user-manager/user/models/user.model';
import { FILE_PUBLIC_ATTRIBUTES } from 'src/shared/file/constants/file-attributes.const';
import { File } from 'src/shared/file/models/file.model';
import { SortFieldCommentEnum } from '../enums/sort-field-comment.enum';
import { Comment } from '../models/comment.model';
import { ClientCreateCommentData } from '../types/client.create-comment-data.type';
import { ClientFindAllCommentsData } from '../types/client.find-all-comments-data.type';

const COMMENT_ATTRIBUTES = ['uuid', 'parentUuid', 'rootUuid', 'text', 'likesCount', 'dislikesCount', 'rating', 'createdAt'];

@Injectable()
export class ClientCommentRepository {
    constructor(@InjectModel(Comment) private readonly commentModel: typeof Comment) {}

    private getIncludes(): Includeable[] {
        return [
            { model: User, as: 'user', attributes: ['uuid', 'userName', 'email', 'homePage'], required: true },
            { model: File, as: 'file', attributes: FILE_PUBLIC_ATTRIBUTES, required: false },
        ];
    }

    // sortBy/sortOrder приходят только из enum'ов DTO — в ORDER BY не попадает пользовательская строка
    private getOrder(data: ClientFindAllCommentsData): Order {
        const { sortBy, sortOrder } = data;

        if (sortBy === SortFieldCommentEnum.CREATED_AT) {
            return [['createdAt', sortOrder]];
        }

        if (sortBy === SortFieldCommentEnum.RATING) {
            return [
                ['rating', sortOrder],
                ['createdAt', 'DESC'],
            ];
        }

        // без учёта регистра — так же, как Meilisearch сортирует по userNameSort/emailSort
        const column = sortBy === SortFieldCommentEnum.USER_NAME ? 'user_name' : 'email';
        return [
            [fn('lower', col(`user.${column}`)), sortOrder],
            ['createdAt', 'DESC'],
        ];
    }

    async create(data: ClientCreateCommentData, transaction: Transaction) {
        return await this.commentModel.create(data, { transaction });
    }

    async findOne(commentUuid: string, transaction?: Transaction) {
        return await this.commentModel.findOne({
            attributes: COMMENT_ATTRIBUTES,
            where: { uuid: commentUuid },
            include: this.getIncludes(),
            transaction,
        });
    }

    async findOneForReply(commentUuid: string, transaction?: Transaction) {
        return await this.commentModel.findOne({
            attributes: ['uuid', 'rootUuid'],
            where: { uuid: commentUuid },
            transaction,
        });
    }

    // Страница и подсчёт — раздельно: findAndCountAll считал бы с джойнами users/files (на 1M строк ~170 мс),
    // а количество заглавных не зависит от джойнов (автор обязателен, файл — LEFT JOIN) и берётся по индексу (~28 мс)
    async findAllTopLevel(data: ClientFindAllCommentsData) {
        const [rows, count] = await Promise.all([
            this.commentModel.findAll({
                attributes: COMMENT_ATTRIBUTES,
                where: { parentUuid: null },
                include: this.getIncludes(),
                order: this.getOrder(data),
                limit: data.limit,
                offset: data.offset,
            }),
            this.commentModel.count({ where: { parentUuid: null } }),
        ]);
        return { rows, count };
    }

    // все ответы всех веток страницы одним запросом; дерево собирает клиент по parentUuid
    async findAllByRootUuids(rootUuids: string[]) {
        if (!rootUuids.length) return [];

        return await this.commentModel.findAll({
            attributes: COMMENT_ATTRIBUTES,
            where: { rootUuid: { [Op.in]: rootUuids } },
            include: this.getIncludes(),
            order: [['createdAt', 'ASC']],
        });
    }

    // FOR MEILISEARCH REINDEX ONLY: keyset-пагинация по первичному ключу — без OFFSET (на 1M строк квадратично).
    // Не по created_at: в Postgres он с микросекундами, а Date в JS — с миллисекундами, и курсор зацикливался бы
    async findAllForMeilisearch(afterUuid: string | null, limit: number) {
        return await this.commentModel.findAll({
            attributes: COMMENT_ATTRIBUTES,
            where: afterUuid ? { uuid: { [Op.gt]: afterUuid } } : {},
            include: this.getIncludes(),
            order: [['uuid', 'ASC']],
            limit,
        });
    }
}
