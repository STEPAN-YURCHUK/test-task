import { HttpException, HttpStatus, Injectable } from '@nestjs/common';
import { Transaction } from 'sequelize';
import { ClientCommentErrorRepository } from '../repositories/client.comment-error.repository';

@Injectable()
export class ClientCommentErrorService {
    constructor(private readonly clientCommentErrorRepository: ClientCommentErrorRepository) {}

    async checkExists(commentUuid: string, transaction?: Transaction): Promise<void> {
        const comment = await this.clientCommentErrorRepository.findOneToCheck(commentUuid, transaction);

        if (!comment) {
            throw new HttpException('comment_not_found', HttpStatus.NOT_FOUND);
        }
    }

    async checkParentExists(parentUuid: string, transaction?: Transaction): Promise<void> {
        const comment = await this.clientCommentErrorRepository.findOneToCheck(parentUuid, transaction);

        if (!comment) {
            throw new HttpException('parent_comment_not_found', HttpStatus.UNPROCESSABLE_ENTITY);
        }
    }
}
