import { col, fn, Op } from 'sequelize';
import { User } from 'src/modules/user-manager/user/models/user.model';
import { File } from 'src/shared/file/models/file.model';
import { SortFieldCommentEnum } from '../enums/sort-field-comment.enum';
import { SortOrderEnum } from '../enums/sort-order.enum';
import { ClientCommentRepository } from './client.comment.repository';

describe('ClientCommentRepository', () => {
    const model = {
        create: jest.fn().mockResolvedValue('created'),
        findOne: jest.fn().mockResolvedValue('one'),
        findAll: jest.fn().mockResolvedValue(['all']),
        count: jest.fn().mockResolvedValue(0),
    };
    const repository = new ClientCommentRepository(model as any);
    const trx: any = { id: 'trx' };

    beforeEach(() => jest.clearAllMocks());

    it('create', async () => {
        expect(await repository.create({ text: 'x' } as any, trx)).toBe('created');
        expect(model.create).toHaveBeenCalledWith({ text: 'x' }, { transaction: trx });
    });

    it('findOne подключает user и file (без служебных полей файла)', async () => {
        await repository.findOne('c1', trx);
        const options = model.findOne.mock.calls[0][0];
        expect(options.where).toEqual({ uuid: 'c1' });
        expect(options.transaction).toBe(trx);
        expect(options.include).toEqual([
            expect.objectContaining({ model: User, as: 'user', required: true }),
            expect.objectContaining({ model: File, as: 'file', required: false }),
        ]);
        expect(options.include[1].attributes).not.toContain('modelUuid');
        expect(options.attributes).toEqual(expect.arrayContaining(['likesCount', 'dislikesCount', 'rating']));
    });

    it('findOneForReply берёт только uuid и rootUuid', async () => {
        await repository.findOneForReply('c1');
        expect(model.findOne).toHaveBeenCalledWith({ attributes: ['uuid', 'rootUuid'], where: { uuid: 'c1' }, transaction: undefined });
    });

    it.each([
        [SortFieldCommentEnum.CREATED_AT, SortOrderEnum.DESC, [['createdAt', 'DESC']]],
        [SortFieldCommentEnum.CREATED_AT, SortOrderEnum.ASC, [['createdAt', 'ASC']]],
        [
            SortFieldCommentEnum.RATING,
            SortOrderEnum.DESC,
            [
                ['rating', 'DESC'],
                ['createdAt', 'DESC'],
            ],
        ],
        [
            SortFieldCommentEnum.USER_NAME,
            SortOrderEnum.ASC,
            [
                [fn('lower', col('user.user_name')), 'ASC'],
                ['createdAt', 'DESC'],
            ],
        ],
        [
            SortFieldCommentEnum.EMAIL,
            SortOrderEnum.DESC,
            [
                [fn('lower', col('user.email')), 'DESC'],
                ['createdAt', 'DESC'],
            ],
        ],
    ])('findAllTopLevel: сортировка %s %s', async (sortBy, sortOrder, order) => {
        model.findAll.mockResolvedValueOnce([{ uuid: 'c1' }]);
        model.count.mockResolvedValueOnce(51);

        expect(await repository.findAllTopLevel({ limit: 25, offset: 50, sortBy, sortOrder })).toEqual({
            rows: [{ uuid: 'c1' }],
            count: 51,
        });
        expect(model.findAll).toHaveBeenCalledWith(expect.objectContaining({ where: { parentUuid: null }, order, limit: 25, offset: 50 }));
        // подсчёт — отдельным запросом без джойнов users/files (иначе на 1M строк в 6 раз медленнее)
        expect(model.count).toHaveBeenCalledWith({ where: { parentUuid: null } });
    });

    it('findAllByRootUuids: пустой список — без запроса', async () => {
        expect(await repository.findAllByRootUuids([])).toEqual([]);
        expect(model.findAll).not.toHaveBeenCalled();
    });

    it('findAllByRootUuids: IN по rootUuid, по возрастанию даты', async () => {
        await repository.findAllByRootUuids(['a', 'b']);
        expect(model.findAll).toHaveBeenCalledWith(
            expect.objectContaining({ where: { rootUuid: { [Op.in]: ['a', 'b'] } }, order: [['createdAt', 'ASC']] }),
        );
    });

    it('findAllForMeilisearch: первая страница — без условия, стабильный порядок, без OFFSET', async () => {
        await repository.findAllForMeilisearch(null, 500);
        const options = model.findAll.mock.calls[0][0];
        expect(options).toMatchObject({
            where: {},
            order: [['uuid', 'ASC']],
            limit: 500,
        });
        expect(options).not.toHaveProperty('offset');
    });

    // курсор по PK, а не по created_at: в Postgres он с микросекундами, в JS Date — с мс, курсор зацикливался (регрессия)
    it('findAllForMeilisearch: keyset — строго после uuid последней строки', async () => {
        await repository.findAllForMeilisearch('u-last', 500);
        expect(model.findAll.mock.calls[0][0].where).toEqual({ uuid: { [Op.gt]: 'u-last' } });
    });
});
