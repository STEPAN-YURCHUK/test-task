import { Sequelize } from 'sequelize-typescript';
import { CommentVote } from './comment-manager/comment-vote/models/comment-vote.model';
import { Comment } from './comment-manager/comment/models/comment.model';
import { User } from './user-manager/user/models/user.model';
import { File } from 'src/shared/file/models/file.model';

// Регистрация моделей без подключения к БД: проверяем таблицы, связи и индексы
describe('модели Sequelize', () => {
    const sequelize = new Sequelize({ dialect: 'postgres', logging: false, define: { underscored: true } });
    sequelize.addModels([User, Comment, CommentVote, File]);

    afterAll(() => sequelize.close());

    it('таблицы', () => {
        expect([User, Comment, CommentVote, File].map((m) => m.getTableName())).toEqual(['users', 'comments', 'comment_votes', 'files']);
    });

    it('Comment: user, parent/root/children, file — полиморфная связь со scope по колонкам', () => {
        const { user, parent, root, children, file } = Comment.associations as any;
        expect(user.target).toBe(User);
        expect(parent.foreignKey).toBe('parentUuid');
        expect(root.foreignKey).toBe('rootUuid');
        expect(children.foreignKey).toBe('parentUuid');
        expect(file.target).toBe(File);
        expect(file.foreignKey).toBe('modelUuid');
        expect(file.options.constraints).toBe(false);
        expect(file.scope).toEqual({ model_type: 'comments', model_column: 'file' });
    });

    it('User.comments и CommentVote.comment', () => {
        expect((User.associations as any).comments.target).toBe(Comment);
        expect((CommentVote.associations as any).comment.target).toBe(Comment);
    });

    it('уникальные индексы: (email, user_name), (comment_uuid, voter_id), path файла', () => {
        const indexes = (model: any) => model.options.indexes.map((i: any) => i.name);
        expect(indexes(User)).toContain('users_email_user_name_uq');
        expect(indexes(CommentVote)).toContain('comment_votes_comment_uuid_voter_id_uq');
        expect(indexes(Comment)).toEqual(
            expect.arrayContaining([
                'comments_top_level_created_at_idx',
                'comments_top_level_rating_idx',
                'comments_root_uuid_created_at_idx',
            ]),
        );
        expect((File.getAttributes() as any).path.unique).toBe(true);
    });

    it('счётчики голосов по умолчанию 0', () => {
        const attrs: any = Comment.getAttributes();
        expect([attrs.likesCount.defaultValue, attrs.dislikesCount.defaultValue, attrs.rating.defaultValue]).toEqual([0, 0, 0]);
    });
});
