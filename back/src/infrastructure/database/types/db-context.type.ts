import { Transaction } from 'sequelize';

export interface DbContextData {
    transaction?: Transaction;
}
