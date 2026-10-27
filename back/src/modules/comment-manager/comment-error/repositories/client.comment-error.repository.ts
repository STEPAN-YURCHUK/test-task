import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/sequelize';
import { Transaction } from 'sequelize';
import { Comment } from '../../comment/models/comment.model';

@Injectable()
export class ClientCommentErrorRepository {
    constructor(@InjectModel(Comment) private readonly commentModel: typeof Comment) {}

    async findOneToCheck(commentUuid: string, transaction?: Transaction) {
        return await this.commentModel.findOne({
            attributes: ['uuid'],
            where: { uuid: commentUuid },
            transaction,
        });
    }
}
