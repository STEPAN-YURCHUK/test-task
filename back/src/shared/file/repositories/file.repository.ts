import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/sequelize';
import { Transaction } from 'sequelize';
import { File } from '../models/file.model';
import { CreateFileData } from '../types/create-file-data.type';

@Injectable()
export class FileRepository {
    constructor(@InjectModel(File) private readonly fileModel: typeof File) {}

    async create(data: CreateFileData, transaction: Transaction) {
        return await this.fileModel.create(data, { transaction });
    }
}
