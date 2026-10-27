import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/sequelize';
import { Transaction } from 'sequelize';
import { User } from '../models/user.model';
import { ClientUpsertUserData } from '../types/client.upsert-user-data.type';

@Injectable()
export class ClientUserRepository {
    constructor(@InjectModel(User) private readonly userModel: typeof User) {}

    async upsert(data: ClientUpsertUserData, transaction: Transaction) {
        const [user] = await this.userModel.upsert(data, {
            // conflictFields уходят в ON CONFLICT как есть — нужны имена колонок, а не атрибутов
            conflictFields: ['email', 'user_name'] as any,
            returning: true,
            transaction,
        });
        return user;
    }
}
