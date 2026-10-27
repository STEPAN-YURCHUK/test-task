import { Column, DataType, Model, Table } from 'sequelize-typescript';
import { TypeFileEnum } from '../enums/type-file.enum';
import { IFileAttrs } from '../interfaces/file.interface';

// Полиморфная таблица файлов: сущность-владелец = modelType + modelUuid,
// modelColumn — какое «поле» сущности это (одна сущность может иметь несколько файлов)
@Table({
    tableName: 'files',
    indexes: [{ name: 'files_model_idx', fields: ['model_type', 'model_uuid', 'model_column'] }],
})
export class File extends Model<File, IFileAttrs> {
    @Column({ type: DataType.UUID, defaultValue: DataType.UUIDV4, primaryKey: true })
    uuid: string;

    @Column({ type: DataType.ENUM(...Object.values(TypeFileEnum)), allowNull: false })
    type: TypeFileEnum;

    // ключ объекта в S3 (для картинки — вариант original); публичный URL = S3_CDN_URL + path
    @Column({ type: DataType.STRING(255), allowNull: false, unique: true })
    path: string;

    @Column({ type: DataType.STRING(255), allowNull: false })
    originalName: string;

    @Column({ type: DataType.STRING(100), allowNull: false })
    mimeType: string;

    @Column({ type: DataType.INTEGER, allowNull: false })
    size: number;

    @Column({ type: DataType.SMALLINT, allowNull: true })
    width: number | null;

    @Column({ type: DataType.SMALLINT, allowNull: true })
    height: number | null;

    // Варианты картинки. У текстовых файлов — NULL
    @Column({ type: DataType.STRING(255), allowNull: true })
    smallPath: string | null;

    @Column({ type: DataType.STRING(255), allowNull: true })
    mediumPath: string | null;

    @Column({ type: DataType.STRING(255), allowNull: true })
    webpSmallPath: string | null;

    @Column({ type: DataType.STRING(255), allowNull: true })
    webpMediumPath: string | null;

    @Column({ type: DataType.STRING(255), allowNull: true })
    webpOriginalPath: string | null;

    @Column({ type: DataType.SMALLINT, allowNull: true })
    smallWidth: number | null;

    @Column({ type: DataType.SMALLINT, allowNull: true })
    smallHeight: number | null;

    @Column({ type: DataType.SMALLINT, allowNull: true })
    mediumWidth: number | null;

    @Column({ type: DataType.SMALLINT, allowNull: true })
    mediumHeight: number | null;

    // Видео: длительность (сек) и постер-кадр. У картинок и текстов — NULL
    @Column({ type: DataType.DECIMAL(10, 2), allowNull: true })
    duration: number | null;

    @Column({ type: DataType.STRING(255), allowNull: true })
    posterPath: string | null;

    @Column({ type: DataType.STRING(255), allowNull: true })
    webpPosterPath: string | null;

    @Column({ type: DataType.UUID, allowNull: false })
    modelUuid: string;

    @Column({ type: DataType.STRING(50), allowNull: false })
    modelType: string;

    @Column({ type: DataType.STRING(50), allowNull: false })
    modelColumn: string;
}
