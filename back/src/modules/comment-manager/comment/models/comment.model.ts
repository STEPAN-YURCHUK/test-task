import { BelongsTo, Column, DataType, ForeignKey, HasMany, HasOne, Model, Table } from 'sequelize-typescript';
import { User } from 'src/modules/user-manager/user/models/user.model';
import { File } from 'src/shared/file/models/file.model';
import { ICommentAttrs } from '../interfaces/comment.interface';

// Дерево ответов: parentUuid — прямой родитель, rootUuid — заглавный комментарий ветки (NULL у заглавных).
// rootUuid позволяет одним запросом достать всю ветку без рекурсивных CTE.
@Table({
    tableName: 'comments',
    indexes: [
        { name: 'comments_top_level_created_at_idx', fields: ['created_at'], where: { parent_uuid: null } },
        { name: 'comments_top_level_rating_idx', fields: ['rating', 'created_at'], where: { parent_uuid: null } },
        { name: 'comments_root_uuid_created_at_idx', fields: ['root_uuid', 'created_at'] },
        { name: 'comments_parent_uuid_idx', fields: ['parent_uuid'] },
        { name: 'comments_user_uuid_idx', fields: ['user_uuid'] },
    ],
})
export class Comment extends Model<Comment, ICommentAttrs> {
    @Column({ type: DataType.UUID, defaultValue: DataType.UUIDV4, primaryKey: true })
    uuid: string;

    @ForeignKey(() => User)
    @Column({ type: DataType.UUID, allowNull: false })
    userUuid: string;

    @Column({ type: DataType.UUID, allowNull: true })
    parentUuid: string | null;

    @Column({ type: DataType.UUID, allowNull: true })
    rootUuid: string | null;

    // уже очищенный XHTML (sanitizeCommentHtml), отдаётся клиенту как есть
    @Column({ type: DataType.TEXT, allowNull: false })
    text: string;

    // Денормализованные счётчики голосов (истина — comment_votes), обновляются в одной транзакции с голосом
    @Column({ type: DataType.INTEGER, allowNull: false, defaultValue: 0 })
    likesCount: number;

    @Column({ type: DataType.INTEGER, allowNull: false, defaultValue: 0 })
    dislikesCount: number;

    // likes - dislikes, по нему сортировка «Популярные»
    @Column({ type: DataType.INTEGER, allowNull: false, defaultValue: 0 })
    rating: number;

    @Column({ type: DataType.STRING(45), allowNull: true })
    ipAddress: string | null;

    @Column({ type: DataType.STRING(512), allowNull: true })
    userAgent: string | null;

    @BelongsTo(() => User)
    user: User;

    @BelongsTo(() => Comment, { foreignKey: 'parentUuid', onDelete: 'CASCADE' })
    parent: Comment;

    @BelongsTo(() => Comment, { foreignKey: 'rootUuid', onDelete: 'CASCADE' })
    root: Comment;

    @HasMany(() => Comment, { foreignKey: 'parentUuid' })
    children: Comment[];

    // файл из общей таблицы files (полиморфная связь, без FK).
    // В scope — имена колонок: в запросах с LIMIT Sequelize строит подзапрос и не переводит атрибуты в колонки
    @HasOne(() => File, { foreignKey: 'modelUuid', constraints: false, scope: { model_type: 'comments', model_column: 'file' } })
    file: File;
}
