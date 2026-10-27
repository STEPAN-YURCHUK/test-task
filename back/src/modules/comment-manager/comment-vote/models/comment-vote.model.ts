import { BelongsTo, Column, DataType, ForeignKey, Model, Table } from 'sequelize-typescript';
import { Comment } from '../../comment/models/comment.model';
import { ValueCommentVoteEnum } from '../enums/value-comment-vote.enum';
import { ICommentVoteAttrs } from '../interfaces/comment-vote.interface';

// Один голос на (комментарий, голосующий). voterId — случайный id из JWT голосующего, не пользователь.
@Table({
    tableName: 'comment_votes',
    indexes: [
        { name: 'comment_votes_comment_uuid_voter_id_uq', unique: true, fields: ['comment_uuid', 'voter_id'] },
        { name: 'comment_votes_voter_id_idx', fields: ['voter_id'] },
    ],
})
export class CommentVote extends Model<CommentVote, ICommentVoteAttrs> {
    @Column({ type: DataType.UUID, defaultValue: DataType.UUIDV4, primaryKey: true })
    uuid: string;

    @ForeignKey(() => Comment)
    @Column({ type: DataType.UUID, allowNull: false, onDelete: 'CASCADE' })
    commentUuid: string;

    @Column({ type: DataType.UUID, allowNull: false })
    voterId: string;

    @Column({ type: DataType.SMALLINT, allowNull: false })
    value: ValueCommentVoteEnum;

    @BelongsTo(() => Comment)
    comment: Comment;
}
