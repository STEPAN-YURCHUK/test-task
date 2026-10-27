import { Column, DataType, HasMany, Model, Table } from 'sequelize-typescript';
import { Comment } from 'src/modules/comment-manager/comment/models/comment.model';
import { IUserAttrs } from '../interfaces/user.interface';

// Автор комментариев идентифицируется парой (email, userName); IP/User-Agent пишутся в каждый комментарий
@Table({
    tableName: 'users',
    indexes: [
        { name: 'users_email_user_name_uq', unique: true, fields: ['email', 'user_name'] },
        { name: 'users_user_name_idx', fields: ['user_name'] },
    ],
})
export class User extends Model<User, IUserAttrs> {
    @Column({ type: DataType.UUID, defaultValue: DataType.UUIDV4, primaryKey: true })
    uuid: string;

    @Column({ type: DataType.STRING(50), allowNull: false })
    userName: string;

    @Column({ type: DataType.STRING(255), allowNull: false })
    email: string;

    @Column({ type: DataType.STRING(2048), allowNull: true })
    homePage: string | null;

    @HasMany(() => Comment)
    comments: Comment[];
}
