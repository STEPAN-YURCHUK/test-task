import { Injectable } from '@nestjs/common';
import { Transaction } from 'sequelize';
import { Sequelize } from 'sequelize-typescript';
import { DbContextData } from '../types/db-context.type';

@Injectable()
export class DatabaseService {
    constructor(private readonly sequelize: Sequelize) {}

    async withTransaction<T>(dbContextData: DbContextData, fn: (trx: Transaction) => Promise<T>) {
        const { transaction } = dbContextData;
        if (transaction) {
            return await fn(transaction);
        }
        return await this.sequelize.transaction(async (trx) => await fn(trx));
    }
}
