import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/sequelize';
import { Op, Transaction } from 'sequelize';
import { Comment } from '../../comment/models/comment.model';
import { ValueCommentVoteEnum } from '../enums/value-comment-vote.enum';
import { CommentVote } from '../models/comment-vote.model';
import { ClientCommentVoteCounters } from '../types/client.comment-vote-counters.type';

@Injectable()
export class ClientCommentVoteRepository {
    constructor(
        @InjectModel(CommentVote) private readonly commentVoteModel: typeof CommentVote,
        @InjectModel(Comment) private readonly commentModel: typeof Comment,
    ) {}

    // SELECT … FOR UPDATE по строке комментария сериализует голоса за один комментарий
    async lockComment(commentUuid: string, transaction: Transaction) {
        return await this.commentModel.findOne({
            attributes: ['uuid'],
            where: { uuid: commentUuid },
            lock: transaction.LOCK.UPDATE,
            transaction,
        });
    }

    async findOne(commentUuid: string, voterId: string, transaction: Transaction) {
        return await this.commentVoteModel.findOne({
            attributes: ['uuid', 'value'],
            where: { commentUuid, voterId },
            transaction,
        });
    }

    async create(commentUuid: string, voterId: string, value: ValueCommentVoteEnum, transaction: Transaction) {
        return await this.commentVoteModel.create({ commentUuid, voterId, value }, { transaction });
    }

    async update(voteUuid: string, value: ValueCommentVoteEnum, transaction: Transaction) {
        return await this.commentVoteModel.update({ value }, { where: { uuid: voteUuid }, transaction });
    }

    async delete(voteUuid: string, transaction: Transaction) {
        return await this.commentVoteModel.destroy({ where: { uuid: voteUuid }, transaction });
    }

    async incrementCounters(commentUuid: string, deltas: ClientCommentVoteCounters, transaction: Transaction) {
        await this.commentModel.increment(deltas, { where: { uuid: commentUuid }, transaction });
    }

    async findCounters(commentUuid: string, transaction: Transaction) {
        return await this.commentModel.findOne({
            attributes: ['likesCount', 'dislikesCount', 'rating'],
            where: { uuid: commentUuid },
            transaction,
        });
    }

    async findAllByVoter(voterId: string, commentUuids: string[]) {
        if (!commentUuids.length) return [];

        return await this.commentVoteModel.findAll({
            attributes: ['commentUuid', 'value'],
            where: { voterId, commentUuid: { [Op.in]: commentUuids } },
        });
    }
}
