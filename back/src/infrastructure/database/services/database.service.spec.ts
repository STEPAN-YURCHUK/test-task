import { DatabaseService } from './database.service';

describe('DatabaseService.withTransaction', () => {
    it('с переданной транзакцией не открывает новую', async () => {
        const sequelize: any = { transaction: jest.fn() };
        const trx: any = { id: 'outer' };
        const result = await new DatabaseService(sequelize).withTransaction({ transaction: trx }, async (t) => t);
        expect(result).toBe(trx);
        expect(sequelize.transaction).not.toHaveBeenCalled();
    });

    it('без транзакции открывает managed-транзакцию', async () => {
        const inner: any = { id: 'inner' };
        const sequelize: any = { transaction: jest.fn((fn) => fn(inner)) };
        const result = await new DatabaseService(sequelize).withTransaction({}, async (t: any) => t.id);
        expect(result).toBe('inner');
        expect(sequelize.transaction).toHaveBeenCalledTimes(1);
    });
});
